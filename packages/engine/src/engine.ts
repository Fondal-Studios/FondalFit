import { CATALOG, byId } from './catalog';
import type { AssessmentInput, AutonomyLimits, Exercise, Goal, Plan, PlanDay, Prescription, SetResult } from './types';

export const ENGINE_VERSION = '1.0.0';

/** Epley estimated 1RM. Estimate only: never presented as a measured value. */
export function estimate1RM(weight: number, reps: number): number {
  if (weight <= 0 || reps <= 0) return 0;
  return reps === 1 ? weight : Math.round(weight * (1 + reps / 30) * 10) / 10;
}

export function rirFromRpe(rpe: number): number {
  return Math.max(0, Math.min(10, 10 - rpe));
}

export type Safety = { status: 'ok' } | { status: 'refer'; reasons: string[] };

/** Red flags block plan generation until a professional clears the athlete. */
export function screenSafety(a: AssessmentInput): Safety {
  const reasons = Object.entries(a.redFlags).filter(([, v]) => v).map(([k]) => k);
  return reasons.length ? { status: 'refer', reasons } : { status: 'ok' };
}

export function allowedExercises(a: Pick<AssessmentInput, 'equipment' | 'restrictions'>): Exercise[] {
  const eq = new Set([...a.equipment, 'none'] as string[]);
  return CATALOG.filter(
    (e) => e.equipment.some((q) => eq.has(q)) && !e.stresses.some((s) => a.restrictions.includes(s)),
  );
}

const SCHEME: Record<Goal, { sets: number; repMin: number; repMax: number; rir: number }> = {
  strength: { sets: 4, repMin: 3, repMax: 6, rir: 2 },
  hypertrophy: { sets: 3, repMin: 8, repMax: 12, rir: 2 },
  endurance: { sets: 2, repMin: 15, repMax: 20, rir: 3 },
  fat_loss: { sets: 3, repMin: 10, repMax: 15, rir: 2 },
  mobility: { sets: 2, repMin: 8, repMax: 12, rir: 4 },
  general: { sets: 3, repMin: 8, repMax: 12, rir: 3 },
  hybrid: { sets: 3, repMin: 6, repMax: 12, rir: 3 },
};

const DAY_PATTERNS: Exercise['pattern'][][] = [
  ['squat', 'push', 'pull', 'core'],
  ['hinge', 'pull', 'push', 'mobility'],
  ['lunge', 'push', 'pull', 'carry', 'core'],
];

/** Picks the most conservative variant first (fewest stressed areas, bodyweight first for beginners). */
function pick(pool: Exercise[], pattern: Exercise['pattern'], beginner: boolean, used: Set<string>) {
  const c = pool.filter((e) => e.pattern === pattern && (e.level??1) <= (beginner?2:4));
  c.sort((a, b) => (beginner ? (a.level??1)-(b.level??1) : (b.level??1)-(a.level??1)) || (beginner ? a.increment-b.increment : b.increment-a.increment));
  return c.find((e) => !used.has(e.id)) ?? c[0];
}

export function generatePlan(a: AssessmentInput): Plan {
  const safety = screenSafety(a);
  if (safety.status === 'refer') throw new Error('REFERRAL_REQUIRED:' + safety.reasons.join(','));
  const nDays = Math.min(6, Math.max(1, Math.round(a.daysPerWeek)));
  const pool = allowedExercises(a);
  const s = SCHEME[a.goal];
  const beginner = a.experience === 'beginner';
  const lowActivity = (a.baseline?.activityMinutesPerWeek !== undefined && a.baseline.activityMinutesPerWeek < 60) || (a.trainingContext?.recentBreakWeeks ?? 0) >= 8;
  const conservativeStart = beginner || lowActivity;
  const sessionMinutes = Math.min(120, Math.max(20, a.sessionMinutes ?? 60));
  const maxExercises = sessionMinutes <= 30 ? 3 : sessionMinutes <= 45 ? 4 : sessionMinutes <= 60 ? 5 : 6;
  const days: PlanDay[] = [];
  for (let d = 0; d < nDays; d++) {
    const used = new Set<string>();
    const items: Prescription[] = [];
    for (const p of DAY_PATTERNS[d % DAY_PATTERNS.length]!) {
      if (items.length >= maxExercises) break;
      const ex = pick(pool, p, beginner, used);
      if (!ex) continue;
      used.add(ex.id);
      const isCore = p === 'core' || p === 'mobility';
      items.push({
        exerciseId: ex.id,
        sets: isCore ? 2 : conservativeStart ? Math.min(s.sets, 2) : s.sets,
        repMin: s.repMin,
        repMax: s.repMax,
        rirTarget: conservativeStart ? Math.max(s.rir, 4) : s.rir,
        load: 0,
      });
    }
    // Three distinct emphasis patterns: avoid repeating an identical full-body session every day.
    const hybridRun = a.goal === 'hybrid' && d % 2 === 1;
    const enduranceRun = a.goal === 'endurance' && a.preferredActivities?.includes('running');
    const run = (hybridRun || enduranceRun) ? { minutes: Math.max(15, Math.min(50, Math.round(sessionMinutes * (hybridRun ? 0.45 : 0.75)))), intensity: 'easy' as const, note: 'Ritmo conversacional; ajustá según el esfuerzo percibido.' } : undefined;
    const emphasis=['Empuje y sentadilla','Tracción y bisagra','Piernas y estabilidad'][d%3];
    days.push({ name: a.goal === 'hybrid' ? (hybridRun ? `Fuerza + carrera · ${emphasis}` : `Fuerza · ${emphasis}`) : `Sesión ${d+1} · ${emphasis}`, items: hybridRun ? items.slice(0, 3) : items, ...(run ? {run} : {}) });
  }
  return { engineVersion: ENGINE_VERSION, goal: a.goal, days, weeksSinceDeload: 0 };
}

export type Decision = { action: 'increase' | 'hold' | 'decrease'; load: number; reason: string };

/** Double progression: add load once top of rep range is hit with RIR at or above target. */
export function nextLoad(p: Prescription, sets: SetResult[]): Decision {
  const ex = byId(p.exerciseId);
  const inc = ex?.increment ?? 0;
  if (!sets.length) return { action: 'hold', load: p.load, reason: 'no_data' };
  const worst = Math.min(...sets.map((s) => s.reps));
  const minRir = Math.min(...sets.map((s) => s.rir));
  if (minRir <= 0 && worst < p.repMin) {
    const load = inc ? Math.max(0, round(p.load - inc, inc)) : 0;
    return { action: 'decrease', load, reason: 'failed_below_range' };
  }
  if (worst >= p.repMax && minRir >= p.rirTarget) {
    return { action: 'increase', load: inc ? p.load + inc : 0, reason: 'top_of_range' };
  }
  return { action: 'hold', load: p.load, reason: 'within_range' };
}

const round = (v: number, step: number) => Math.round(v / step) * step;

/** Seeds an initial working load from a measured set (80% of estimated 1RM-based range midpoint is NOT used: we stay conservative at ~RIR target). */
export function seedLoad(first: SetResult, p: Prescription): number {
  const ex = byId(p.exerciseId);
  if (!ex || !ex.increment) return 0;
  const e1 = estimate1RM(first.weight, first.reps + first.rir);
  const pct = 1 / (1 + (p.repMax + p.rirTarget) / 30);
  return Math.max(0, round(e1 * pct, ex.increment));
}

export function needsDeload(weeksSinceDeload: number, fatigue: number /* 1-10 */, limits?: AutonomyLimits): boolean {
  return weeksSinceDeload >= 5 || fatigue >= 8 ? !limits || limits.allowAutoDeload : false;
}

export interface PlanChange { loadIncreasePct: number; weeklyVolumeDeltaPct: number; sessionsPerWeek: number; isDeload?: boolean }
export type Autonomy = { allowed: true } | { allowed: false; violations: string[] };

/** The AI coach may auto-apply a change only when every explicit professional limit holds. */
export function checkAutonomy(limits: AutonomyLimits, c: PlanChange): Autonomy {
  const v: string[] = [];
  if (c.isDeload) {
    if (!limits.allowAutoDeload) v.push('deload_not_allowed');
  } else {
    if (c.loadIncreasePct > limits.maxLoadIncreasePct) v.push('load_increase');
    if (Math.abs(c.weeklyVolumeDeltaPct) > limits.maxWeeklyVolumeDeltaPct) v.push('weekly_volume');
  }
  if (c.sessionsPerWeek > limits.maxSessionsPerWeek) v.push('sessions_per_week');
  return v.length ? { allowed: false, violations: v } : { allowed: true };
}

export const DEFAULT_LIMITS: AutonomyLimits = { maxLoadIncreasePct: 5, maxWeeklyVolumeDeltaPct: 10, maxSessionsPerWeek: 5, allowAutoDeload: true };

/* ---------- Nutrition (conservative) ---------- */
export interface NutritionInput { sex: 'f' | 'm'; weightKg: number; heightCm: number; age: number; activity: 1.2 | 1.375 | 1.55 | 1.725; goal: Goal; adjustmentPct?: number }
export interface NutritionTarget { kcal: number; proteinG: number; fatG: number; carbsG: number; waterMl: number; floored: boolean; bmr: number; tdee: number; adjustmentPct: number; rawKcal: number }

export function nutritionTarget(n: NutritionInput): NutritionTarget {
  const bmr = 10 * n.weightKg + 6.25 * n.heightCm - 5 * n.age + (n.sex === 'm' ? 5 : -161);
  const tdee = bmr * n.activity;
  const adjustmentPct = n.adjustmentPct ?? (n.goal === 'fat_loss' ? -15 : n.goal === 'hypertrophy' ? 8 : 0);
  const adj = 1 + adjustmentPct / 100;
  // never below BMR nor below an absolute floor: no extreme restriction
  const floor = Math.max(bmr, n.sex === 'm' ? 1500 : 1200);
  const raw = tdee * adj;
  const kcal = Math.round(Math.max(raw, floor));
  const proteinG = Math.round(n.weightKg * (n.goal === 'strength' || n.goal === 'hypertrophy' ? 1.8 : 1.6));
  const fatG = Math.round((kcal * 0.27) / 9);
  const carbsG = Math.max(0, Math.round((kcal - proteinG * 4 - fatG * 9) / 4));
  return { kcal, proteinG, fatG, carbsG, waterMl: Math.round(n.weightKg * 35), floored: raw < floor, bmr: Math.round(bmr), tdee: Math.round(tdee), adjustmentPct, rawKcal: Math.round(raw) };
}

/* ---------- Recovery ---------- */
export interface RecoveryInput { sleepHours: number; fatigue: number; stress: number; pain: number /*0-10*/ }
export interface RecoveryResult { score: number; alerts: string[] }

export function recoveryScore(r: RecoveryInput): RecoveryResult {
  const sleep = Math.min(1, r.sleepHours / 8);
  const score = Math.round(100 * (0.4 * sleep + 0.25 * (1 - (r.fatigue - 1) / 9) + 0.2 * (1 - (r.stress - 1) / 9) + 0.15 * (1 - r.pain / 10)));
  const alerts: string[] = [];
  if (r.sleepHours < 5) alerts.push('low_sleep');
  if (r.fatigue >= 8) alerts.push('high_fatigue');
  if (r.pain >= 7) alerts.push('high_pain');
  return { score, alerts };
}

/* ---------- Running ---------- */
export const paceMinPerKm = (km: number, minutes: number) => (km > 0 ? Math.round((minutes / km) * 100) / 100 : 0);

export interface RunWeek { km: number }
/** Flags weekly distance jumps above 10% (and any jump >5 km from a low base): never rewarded, only warned. */
export function runningLoadAlert(prevWeekKm: number, thisWeekKm: number): string[] {
  const a: string[] = [];
  if (prevWeekKm > 0 && thisWeekKm > prevWeekKm * 1.1 && thisWeekKm - prevWeekKm > 2) a.push('run_volume_jump');
  if (prevWeekKm === 0 && thisWeekKm > 15) a.push('run_volume_jump');
  return a;
}

/* ---------- Gamification (moderate, safe) ---------- */
export interface ActivityDay { date: string; sessions: number; runs: number }
export const ACHIEVEMENTS = ['first_session','five_sessions','ten_sessions','twentyfive_sessions','fifty_sessions','first_run','five_runs','ten_runs','streak_4_weeks','streak_8_weeks','recovery_logged','consistent_week','balanced_week'] as const;

/** Rewards consistency, not workout volume or intensity. At most one active day earns XP. */
export function gamification(days: ActivityDay[], recoveryLogs: number) {
  const unique = new Map<string,{sessions:number;runs:number}>();
  for (const d of days) {
    const key=d.date.slice(0,10);
    const previous=unique.get(key)??{sessions:0,runs:0};
    unique.set(key,{sessions:previous.sessions+Math.max(0,d.sessions),runs:previous.runs+Math.max(0,d.runs)});
  }
  const active=[...unique].filter(([,d])=>d.sessions+d.runs>0).sort(([a],[b])=>a.localeCompare(b));
  const xp=active.length*50+Math.min(100,Math.max(0,recoveryLogs))*5;
  const level=Math.floor(Math.sqrt(xp/50))+1;
  const weeks=new Set(active.map(([date])=>isoWeek(date)));
  let streak=0;
  const cur=isoWeekIndex(active.map(([date])=>date).pop()??'');
  for(let w=cur;w>0&&weeks.has(weekKey(w));w--)streak++;
  const totalSessions=[...unique.values()].reduce((n,d)=>n+d.sessions,0);
  const totalRuns=[...unique.values()].reduce((n,d)=>n+d.runs,0);
  const got:string[]=[];
  for(const [n,key] of [[1,'first_session'],[5,'five_sessions'],[10,'ten_sessions'],[25,'twentyfive_sessions'],[50,'fifty_sessions']] as const) if(totalSessions>=n)got.push(key);
  for(const [n,key] of [[1,'first_run'],[5,'five_runs'],[10,'ten_runs']] as const) if(totalRuns>=n)got.push(key);
  if(streak>=4)got.push('streak_4_weeks');
  if(streak>=8)got.push('streak_8_weeks');
  if(recoveryLogs>=1)got.push('recovery_logged');
  const byWeek=new Map<string,{days:number;strength:boolean;run:boolean}>();
  for(const [date,activity] of active){
    const key=isoWeek(date);const week=byWeek.get(key)??{days:0,strength:false,run:false};
    week.days++;week.strength ||=activity.sessions>0;week.run ||=activity.runs>0;byWeek.set(key,week);
  }
  if([...byWeek.values()].some(w=>w.days>=3))got.push('consistent_week');
  if([...byWeek.values()].some(w=>w.strength&&w.run))got.push('balanced_week');
  const challenges=[
    {id:'weekly_consistency',title:'Moverte 3 días distintos esta semana',progress:Math.min(3,[...active].filter(([date])=>isoWeek(date)===isoWeek(new Date().toISOString())).length),target:3},
    {id:'first_strength',title:'Registrar una sesión de fuerza',progress:Math.min(1,totalSessions),target:1},
    {id:'first_cardio',title:'Registrar una carrera',progress:Math.min(1,totalRuns),target:1},
  ];
  return {xp,level,streakWeeks:streak,achievements:got,challenges,rewards:{title:level>=10?'Guardián del hábito':level>=5?'Explorador constante':'Aprendiz del movimiento',unlockedFrames:Math.min(4,Math.floor(level/3))}};
}
const weekNo = (d: string) => Math.floor(Date.parse(d.slice(0, 10) + 'T00:00:00Z') / (7 * 864e5));
const isoWeek = (d: string) => weekKey(weekNo(d));
const isoWeekIndex = (d: string) => (d ? weekNo(d) : 0);
const weekKey = (n: number) => `w${n}`;
