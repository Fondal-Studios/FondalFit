import { byId } from './catalog';
import type { Experience, Plan, PlanDay, Ramp } from './types';

export type MesoLabel = 'base' | 'build' | 'peak' | 'deload';
export interface MesoWeek { label: MesoLabel; setsMult: number; rirDelta: number; loadMult: number }

/**
 * 4-week mesocycle: week 1 gets in the groove with reps in reserve, weeks 2–3 add volume and push closer to failure, week 4 is a
 * deload (half the sets, much more reserve, lighter loads) so fatigue dissipates. Beginners never train closer than 2 RIR.
 */
export const mesoWeeks = (exp: Experience): MesoWeek[] => [
  { label: 'base', setsMult: 1, rirDelta: 1, loadMult: 1 },
  { label: 'build', setsMult: 1, rirDelta: 0, loadMult: 1 },
  { label: 'peak', setsMult: exp === 'beginner' ? 1 : 1.25, rirDelta: exp === 'beginner' ? 0 : -1, loadMult: 1 },
  { label: 'deload', setsMult: 0.5, rirDelta: 3, loadMult: 0.9 },
];

const WEEK_MS = 7 * 864e5;
export const weeksSince = (iso: string, now: Date) => Math.max(0, Math.floor((now.getTime() - Date.parse(iso)) / WEEK_MS));

const roundTo = (v: number, step: number) => (step > 0 ? Math.round(v / step) * step : 0);

function modify(days: PlanDay[], sets: number, rir: number, load: number, rirFloor: number): PlanDay[] {
  return days.map((d) => ({
    ...d,
    items: d.items.map((it) => {
      const ex = byId(it.exerciseId);
      return {
        ...it,
        sets: Math.max(1, Math.round(it.sets * sets)),
        rirTarget: Math.max(rirFloor, Math.min(5, it.rirTarget + rir)),
        load: it.load > 0 && ex?.increment ? Math.max(ex.increment, roundTo(it.load * load, ex.increment)) : it.load,
      };
    }),
  }));
}

export interface Materialized { days: PlanDay[]; weekIndex: number; weekCount: number; label: MesoLabel | 'program' | 'plain'; ramp: boolean }

/** The sessions to show *now*: applies the mesocycle week, program week and any post-break ramp to the stored plan. */
export function materialize(plan: Plan, now: Date = new Date(), experience: Experience = 'intermediate'): Materialized {
  if (plan.program) {
    const i = Math.min(plan.program.weeks.length - 1, weeksSince(plan.program.startedAt, now));
    return { days: ramped(plan.program.weeks[i]!, plan.ramp, now), weekIndex: i, weekCount: plan.program.weeks.length, label: 'program', ramp: rampActive(plan.ramp, now) };
  }
  if (plan.meso) {
    const w = weeksSince(plan.meso.startedAt, now) % 4, m = mesoWeeks(experience)[w]!;
    const days = modify(plan.days, m.setsMult, m.rirDelta, m.loadMult, experience === 'beginner' ? 2 : 0);
    return { days: ramped(days, plan.ramp, now), weekIndex: w, weekCount: 4, label: m.label, ramp: rampActive(plan.ramp, now) };
  }
  return { days: ramped(plan.days, plan.ramp, now), weekIndex: 0, weekCount: 1, label: 'plain', ramp: rampActive(plan.ramp, now) };
}
const rampActive = (r: Ramp | undefined, now: Date) => !!r && weeksSince(r.startedAt, now) < r.weeks;
const ramped = (days: PlanDay[], r: Ramp | undefined, now: Date) => (rampActive(r, now) ? modify(days, r!.setsMult, 1, r!.loadMult, 2) : days);

/** Gradual return after a break: more days off = longer and gentler ramp. Not a clinical protocol. */
export function adaptedReturn(gapDays: number): Omit<Ramp, 'startedAt'> | null {
  if (gapDays < 10) return null;
  if (gapDays <= 21) return { weeks: 1, setsMult: 0.8, loadMult: 0.9 };
  if (gapDays <= 60) return { weeks: 2, setsMult: 0.7, loadMult: 0.85 };
  return { weeks: 3, setsMult: 0.6, loadMult: 0.8 };
}

/** Resume the old block exactly where it was: shift the block start forward by the time away. */
export const resumeShift = (startedAt: string, gapDays: number) => new Date(Date.parse(startedAt) + gapDays * 864e5).toISOString();

export interface DayAdvice { mode: 'normal' | 'light' | 'rest'; setsMult: number; reason: 'ok' | 'low_recovery' | 'pain' | 'poor_sleep' }
/** Same-day adjustment from the latest recovery check-in: lighter when recovery is poor, rest suggested with high pain. */
export function adviseDay(score: number | null, alerts: string[] = []): DayAdvice {
  if (alerts.includes('high_pain')) return { mode: 'rest', setsMult: 0, reason: 'pain' };
  if (score === null) return { mode: 'normal', setsMult: 1, reason: 'ok' };
  if (score < 45) return { mode: 'light', setsMult: 0.6, reason: 'low_recovery' };
  if (score < 60 || alerts.includes('low_sleep')) return { mode: 'light', setsMult: 0.8, reason: alerts.includes('low_sleep') ? 'poor_sleep' : 'low_recovery' };
  return { mode: 'normal', setsMult: 1, reason: 'ok' };
}
export const lightenDay = (d: PlanDay, mult: number): PlanDay => ({ ...d, items: d.items.map((i) => ({ ...i, sets: Math.max(1, Math.round(i.sets * mult)), rirTarget: Math.min(5, i.rirTarget + 1) })) });
