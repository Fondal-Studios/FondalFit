import { byId } from './catalog';
import { allowedExercises, ENGINE_VERSION, screenSafety } from './engine';
import type { AssessmentInput, CardioModality, CardioSession, Exercise, Experience, Goal, Muscle, Plan, PlanDay, Prescription } from './types';

/** Physiological reasoning behind each goal; the UI explains these keys (see Science screen). */
export interface Scheme { sets: number; repMin: number; repMax: number; rir: number; restSec: number; fiber: 'IIx_IIa' | 'IIa' | 'I_IIa' }
const SCHEME: Record<Goal, Scheme> = {
  strength: { sets: 4, repMin: 3, repMax: 6, rir: 2, restSec: 180, fiber: 'IIx_IIa' },
  hypertrophy: { sets: 3, repMin: 6, repMax: 12, rir: 2, restSec: 120, fiber: 'IIa' },
  recomposition: { sets: 3, repMin: 8, repMax: 12, rir: 2, restSec: 90, fiber: 'IIa' },
  fat_loss: { sets: 3, repMin: 6, repMax: 10, rir: 2, restSec: 90, fiber: 'IIx_IIa' },
  endurance: { sets: 2, repMin: 15, repMax: 20, rir: 3, restSec: 60, fiber: 'I_IIa' },
  vo2max: { sets: 3, repMin: 6, repMax: 10, rir: 3, restSec: 90, fiber: 'IIx_IIa' },
  general: { sets: 3, repMin: 8, repMax: 12, rir: 3, restSec: 90, fiber: 'IIa' },
  mobility: { sets: 2, repMin: 8, repMax: 12, rir: 4, restSec: 30, fiber: 'I_IIa' },
};
export const schemeFor = (g: Goal) => SCHEME[g];

type Template = Muscle[];
const UPPER: Template = ['chest', 'back', 'shoulders', 'biceps', 'triceps'];
const LOWER: Template = ['quads', 'hamstrings', 'glutes', 'calves', 'core'];
const FULL_A: Template = ['quads', 'chest', 'back', 'hamstrings', 'core'];
const FULL_B: Template = ['glutes', 'shoulders', 'back', 'chest', 'core'];
const FULL_C: Template = ['quads', 'back', 'chest', 'hamstrings', 'core'];
const PUSH: Template = ['chest', 'shoulders', 'triceps'];
const PULL: Template = ['back', 'back', 'biceps', 'shoulders'];
const LEGS: Template = ['quads', 'hamstrings', 'glutes', 'calves'];

/** Split chosen by number of weekly strength sessions (frequency ≥2×/muscle/week when possible). */
export function splitFor(n: number): Template[] {
  switch (n) {
    case 1: return [FULL_A];
    case 2: return [FULL_A, FULL_B];
    case 3: return [FULL_A, FULL_B, FULL_C];
    case 4: return [UPPER, LOWER, UPPER, LOWER];
    case 5: return [UPPER, LOWER, PUSH, PULL, LEGS];
    case 6: return [PUSH, PULL, LEGS, PUSH, PULL, LEGS];
    default: return [];
  }
}

/** Preferred equipment: beginners start on machines/dumbbells (stable, loadable, easy to progress); others on free weights first. */
const RANK_BEGINNER: Record<string, number> = { machines: 0, dumbbells: 1, bands: 2, bar: 3, none: 3, barbell: 4 };
const RANK_OTHER: Record<string, number> = { barbell: 0, dumbbells: 1, machines: 2, bar: 3, bands: 4, none: 5 };
// compounds before isolation, except for small muscles (arms, calves) where isolation is the exercise
const rank = (e: Exercise, beginner: boolean) =>
  ((beginner ? RANK_BEGINNER : RANK_OTHER)[e.equipment[0]!] ?? 9) + (e.pattern === 'isolation' && !['biceps', 'triceps', 'calves'].includes(e.muscle) ? 10 : 0);

const ISOLATION_MUSCLES = new Set<Muscle>(['biceps', 'triceps', 'calves']);
const LOWER_MUSCLES = new Set<Muscle>(['quads', 'hamstrings', 'glutes']);

function buildStrengthDay(name: string, tpl: Template, pool: Exercise[], a: AssessmentInput, used: Map<string, number>, muscleUses: Map<Muscle, number>): PlanDay {
  const s = SCHEME[a.goal];
  const beginner = a.experience === 'beginner';
  const items: Prescription[] = [];
  const inDay = new Set<string>();
  if (a.goal === 'mobility') {
    for (const id of ['hip_flow', 'thoracic_rotation']) items.push({ exerciseId: id, sets: 2, repMin: 8, repMax: 12, rirTarget: 4, load: 0, restSec: 30 });
    inDay.add('hip_flow'); inDay.add('thoracic_rotation');
  }
  for (const m of tpl) {
    const c = pool.filter((x) => x.muscle === m && !inDay.has(x.id) && x.pattern !== 'mobility');
    if (!c.length) continue;
    // conservative-first for beginners, heavier/loadable first otherwise; rotate across days for variety
    c.sort((x, y) => rank(x, beginner) - rank(y, beginner) || x.id.localeCompare(y.id));
    const occ = muscleUses.get(m) ?? 0;
    const ex = c[occ % c.length]!;
    muscleUses.set(m, occ + 1);
    used.set(ex.id, (used.get(ex.id) ?? 0) + 1);
    inDay.add(ex.id);
    const iso = ISOLATION_MUSCLES.has(m) || ex.pattern === 'isolation';
    const small = m === 'core';
    let sets = small ? 2 : beginner ? Math.min(s.sets, 3) : s.sets;
    if (a.goal === 'hypertrophy' && a.experience === 'advanced' && !small && !iso) sets += 1;
    items.push({
      exerciseId: ex.id, sets,
      repMin: iso && a.goal !== 'strength' ? Math.max(s.repMin, 10) : s.repMin,
      repMax: iso && a.goal !== 'strength' ? Math.max(s.repMax, 15) : s.repMax,
      rirTarget: beginner ? Math.max(s.rir, 3) : s.rir,
      load: 0,
      restSec: iso ? Math.min(s.restSec, 75) : s.restSec,
    });
  }
  return { name, kind: 'strength', items };
}

const isLowerDay = (d: PlanDay) => d.kind === 'strength' && d.items.filter((i) => LOWER_MUSCLES.has(byId(i.exerciseId)?.muscle as Muscle)).length >= 2;
const isHard = (c: CardioSession) => c.type === 'intervals' || c.type === 'tempo' || c.type === 'long';

function cardioPlanTypes(goal: Goal): CardioSession['type'][] {
  switch (goal) {
    case 'vo2max': return ['intervals', 'zone2', 'long', 'intervals'];
    case 'endurance': return ['long', 'zone2', 'tempo', 'zone2', 'intervals'];
    case 'fat_loss': case 'recomposition': case 'general': return ['zone2', 'zone2', 'intervals', 'zone2'];
    default: return ['zone2', 'zone2', 'zone2'];
  }
}

export function makeCardio(type: CardioSession['type'], modality: CardioModality, goal: Goal, exp: Experience): CardioSession {
  const bike = modality === 'bike';
  let t = type;
  // beginners: no hard sessions; running starts as run/walk
  if (exp === 'beginner' && (t === 'intervals' || t === 'tempo' || t === 'long')) t = 'zone2';
  if (exp === 'beginner' && t === 'zone2' && modality === 'run') t = 'walkrun';
  const lvl = { beginner: 0, intermediate: 1, advanced: 2 }[exp];
  switch (t) {
    case 'long': return { modality, type: t, durationMin: [60, 75, 90][lvl]! + (bike ? 20 : 0) };
    case 'tempo': return { modality, type: t, durationMin: [30, 35, 40][lvl]! + (bike ? 10 : 0) };
    case 'intervals': {
      const iv = goal === 'vo2max' ? { reps: [3, 4, 4][lvl]!, workSec: 240, restSec: 180 } : { reps: [6, 8, 10][lvl]!, workSec: 30, restSec: 60 };
      return { modality, type: t, durationMin: Math.round((iv.reps * (iv.workSec + iv.restSec)) / 60) + 15, intervals: iv };
    }
    case 'walkrun': return { modality, type: t, durationMin: 25, intervals: { reps: 6, workSec: 60, restSec: 120 } };
    default: return { modality, type: 'zone2', durationMin: [30, 40, 50][lvl]! + (bike ? 10 : 0) };
  }
}

/** Hard cardio never sits next to a lower-body strength day (concurrent-training interference & recovery). */
function enforceInterference(days: PlanDay[], goal: Goal, exp: Experience) {
  days.forEach((d, i) => {
    if (d.kind !== 'cardio' || !d.cardio || !isHard(d.cardio)) return;
    const n = [days[i - 1], days[i + 1]];
    if (n.some((x) => x && isLowerDay(x))) d.cardio = makeCardio('zone2', d.cardio.modality, goal, exp);
  });
}

export function generatePlan(a: AssessmentInput): Plan {
  const safety = screenSafety(a);
  if (safety.status === 'refer') throw new Error('REFERRAL_REQUIRED:' + safety.reasons.join(','));
  const S = Math.max(0, Math.min(6, Math.round(a.strengthDays)));
  const C = Math.max(0, Math.min(6, Math.round(a.cardioDays)));
  if (S + C < 1 || S + C > 6) throw new Error('INVALID_DAYS');
  const pool = allowedExercises(a);
  const used = new Map<string, number>();
  const muscleUses = new Map<Muscle, number>();
  const strength = splitFor(S).map((t, i) => buildStrengthDay('', t, pool, a, used, muscleUses));
  const mods: CardioModality[] = a.cardioModalities.length ? a.cardioModalities : ['run'];
  const types = cardioPlanTypes(a.goal);
  const cardio: PlanDay[] = Array.from({ length: C }, (_, i) => {
    const m = mods[i % mods.length]!;
    return { name: '', kind: 'cardio' as const, items: [], cardio: makeCardio(types[i % types.length]!, m, a.goal, a.experience) };
  });
  // interleave evenly: spread cardio between strength sessions
  const days: PlanDay[] = [];
  let si = 0, ci = 0;
  const total = S + C;
  for (let i = 0; i < total; i++) {
    const wantCardio = ci < C && (si >= S || Math.floor(((i + 1) * C) / total) > ci);
    days.push(wantCardio ? cardio[ci++]! : strength[si++]!);
  }
  enforceInterference(days, a.goal, a.experience);
  days.forEach((d, i) => { d.name = `D${i + 1}`; });
  return { engineVersion: ENGINE_VERSION, goal: a.goal, days, weeksSinceDeload: 0 };
}

export interface VolumeRow { muscle: Muscle; sets: number; status: 'low' | 'ok' | 'high' }
/** Weekly hard sets per muscle. Reference range for hypertrophy: ~10–20 sets/week (dose–response literature). */
export function weeklyVolume(plan: Plan): VolumeRow[] {
  const m = new Map<Muscle, number>();
  for (const d of plan.days) for (const it of d.items) {
    const ex = byId(it.exerciseId);
    if (ex && ex.pattern !== 'mobility') m.set(ex.muscle, (m.get(ex.muscle) ?? 0) + it.sets);
  }
  return [...m.entries()].map(([muscle, sets]) => ({ muscle, sets, status: sets < 6 ? 'low' as const : sets > 20 ? 'high' as const : 'ok' as const }));
}
