import { describe, expect, it } from 'vitest';
import { adaptedReturn, adviseDay, generatePlan, lightenDay, materialize, mesoWeeks, resumeShift, routineById, routineWeekDays, weeksSince } from '../src';
import type { AssessmentInput, Plan } from '../src';

const A: AssessmentInput = { goal: 'hypertrophy', experience: 'intermediate', strengthDays: 3, cardioDays: 0, cardioModalities: [], equipment: ['dumbbells', 'barbell', 'machines'], restrictions: [],
  redFlags: { chestPain: false, dizziness: false, recentSurgery: false, pregnancy: false, medication: false } };
const at = (start: string, weeks: number) => new Date(Date.parse(start) + weeks * 7 * 864e5 + 3600e3);
const START = '2026-01-05T09:00:00.000Z';

describe('mesocycle', () => {
  const plan: Plan = { ...generatePlan(A), meso: { startedAt: START } };
  plan.days.forEach((d) => d.items.forEach((i) => { if (i.load === 0 && ['back_squat', 'bench_press', 'goblet_squat', 'dumbbell_press'].includes(i.exerciseId)) i.load = 40; }));
  const total = (days: Plan['days']) => days.reduce((a, d) => a + d.items.reduce((s, i) => s + i.sets, 0), 0);

  it('runs base → build → peak → deload and cycles', () => {
    expect([0, 1, 2, 3, 4, 5].map((w) => materialize(plan, at(START, w)).label)).toEqual(['base', 'build', 'peak', 'deload', 'base', 'build']);
  });
  it('week 3 has the most volume and the least reserve; deload halves sets and adds reserve and lowers load', () => {
    const [w1, , w3, w4] = [0, 1, 2, 3].map((w) => materialize(plan, at(START, w)).days);
    expect(total(w3!)).toBeGreaterThan(total(w1!));
    expect(total(w4!)).toBeLessThan(total(w1!) * 0.65);
    const i = (days: Plan['days']) => days.flatMap((d) => d.items).find((x) => x.exerciseId === 'bench_press' || x.exerciseId === 'dumbbell_press' || x.exerciseId === 'goblet_squat')!;
    expect(i(w3!).rirTarget).toBeLessThan(i(w1!).rirTarget);
    expect(i(w4!).rirTarget).toBeGreaterThan(i(w1!).rirTarget);
    expect(i(w4!).load).toBeLessThan(i(w1!).load);
  });
  it('beginners never train closer than 2 RIR', () => {
    const b = { ...generatePlan({ ...A, experience: 'beginner' }), meso: { startedAt: START } };
    for (let w = 0; w < 4; w++) for (const d of materialize(b, at(START, w), 'beginner').days) for (const it of d.items) expect(it.rirTarget).toBeGreaterThanOrEqual(2);
  });
  it('does not mutate the stored plan', () => {
    const before = JSON.stringify(plan);
    materialize(plan, at(START, 2));
    expect(JSON.stringify(plan)).toBe(before);
  });
  it('mesoWeeks shape', () => { expect(mesoWeeks('advanced').map((m) => m.label)).toEqual(['base', 'build', 'peak', 'deload']); });
});

describe('programs and returning after a break', () => {
  it('serves the right week of a multi-week program and stops at the last week', () => {
    const r = routineById('c25k_9w')!;
    const plan: Plan = { engineVersion: 'x', goal: 'endurance', weeksSinceDeload: 0, days: routineWeekDays(r, 0), program: { routineId: r.id, startedAt: START, weeks: r.program.map((_, i) => routineWeekDays(r, i)) } };
    expect(materialize(plan, at(START, 0)).weekIndex).toBe(0);
    expect(materialize(plan, at(START, 4)).days[0]!.cardio!.durationMin).toBe(routineWeekDays(r, 4)[0]!.cardio!.durationMin);
    const last = materialize(plan, at(START, 30));
    expect(last.weekIndex).toBe(8); expect(last.weekCount).toBe(9);
  });
  it('maps time away to a gentler, longer return', () => {
    expect(adaptedReturn(5)).toBeNull();
    expect(adaptedReturn(15)).toMatchObject({ weeks: 1, setsMult: 0.8 });
    expect(adaptedReturn(40)).toMatchObject({ weeks: 2, setsMult: 0.7 });
    expect(adaptedReturn(120)).toMatchObject({ weeks: 3, loadMult: 0.8 });
  });
  it('a ramp reduces sets and loads only while active; resume keeps the position in the block', () => {
    const base = generatePlan(A); base.days.forEach((d) => d.items.forEach((i) => { if (i.load === 0) i.load = 50; }));
    const plan: Plan = { ...base, meso: { startedAt: START }, ramp: { startedAt: '2026-01-26T09:00:00.000Z', weeks: 2, setsMult: 0.7, loadMult: 0.85 } };
    const normal = materialize({ ...plan, ramp: undefined }, at(START, 3));
    const ramped = materialize(plan, at(START, 3));
    expect(ramped.ramp).toBe(true);
    expect(ramped.days.flatMap((d) => d.items).reduce((a, i) => a + i.sets, 0)).toBeLessThanOrEqual(normal.days.flatMap((d) => d.items).reduce((a, i) => a + i.sets, 0));
    expect(materialize(plan, at(START, 7)).ramp).toBe(false);
    const shifted = resumeShift(START, 21);
    expect(weeksSince(shifted, at(START, 3))).toBe(0);
  });
  it('same-day advice follows recovery and never overrides pain', () => {
    expect(adviseDay(80)).toMatchObject({ mode: 'normal' });
    expect(adviseDay(50)).toMatchObject({ mode: 'light', setsMult: 0.8 });
    expect(adviseDay(30)).toMatchObject({ mode: 'light', setsMult: 0.6 });
    expect(adviseDay(90, ['high_pain'])).toMatchObject({ mode: 'rest' });
    expect(adviseDay(null)).toMatchObject({ mode: 'normal' });
    const d = generatePlan(A).days[0]!;
    expect(lightenDay(d, 0.6).items[0]!.sets).toBeLessThanOrEqual(d.items[0]!.sets);
  });
});
