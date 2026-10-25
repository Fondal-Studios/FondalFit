import { describe, expect, it } from 'vitest';
import { byId, ROUTINES, routineById, routineWeekDays } from '../src';

describe('routine library', () => {
  it('has a broad, unique set', () => {
    expect(ROUTINES.length).toBeGreaterThanOrEqual(30);
    expect(new Set(ROUTINES.map((r) => r.id)).size).toBe(ROUTINES.length);
    const tags = new Set(ROUTINES.flatMap((r) => r.tags));
    for (const t of ['strength', 'hypertrophy', 'running', 'cycling', 'hiit', 'mobility', 'hybrid', 'calisthenics', 'health']) expect(tags.has(t as never), t).toBe(true);
  });
  it('every exercise exists, reps are valid and week sizes are sane', () => {
    for (const r of ROUTINES) {
      expect(r.perWeek, r.id).toBeGreaterThanOrEqual(1); expect(r.perWeek, r.id).toBeLessThanOrEqual(6);
      expect(r.program.length, r.id).toBe(r.weeks);
      for (const wk of r.program) for (const d of wk) {
        if (d.kind === 'cardio') { expect(d.cardio, r.id).toBeTruthy(); expect(d.cardio!.durationMin).toBeGreaterThan(10); continue; }
        expect(d.items?.length, `${r.id}/${d.n[1]}`).toBeGreaterThan(0);
        for (const [id, sets, reps] of d.items!) {
          const ex = byId(id);
          expect(ex, `${r.id}: ${id}`).toBeTruthy();
          const [a, b = a] = reps.split('-').map(Number);
          expect(a! >= 1 && b! >= a!, `${r.id}:${id}:${reps}`).toBe(true);
          expect(sets).toBeGreaterThanOrEqual(1); expect(sets).toBeLessThanOrEqual(10);
        }
      }
    }
  });
  it('respects the equipment each routine declares', () => {
    for (const r of ROUTINES) for (const wk of r.program) for (const d of wk) for (const [id] of d.items ?? []) {
      const ex = byId(id)!;
      expect(ex.equipment.some((q) => r.equipment.includes(q) || q === 'none'), `${r.id}: ${id} needs ${ex.equipment}`).toBe(true);
    }
  });
  it('couch-to-5K progresses over 9 weeks to 30 continuous minutes, with beginner-safe sessions', () => {
    const r = routineById('c25k_9w')!;
    expect(r.weeks).toBe(9); expect(r.perWeek).toBe(3);
    expect(r.program[8]!.every((d) => d.cardio!.durationMin === 30 && d.cardio!.type === 'zone2')).toBe(true);
    expect(r.program[0]!.every((d) => d.cardio!.type === 'walkrun')).toBe(true);
  });
  it('running blocks lighten every fourth week and long runs grow', () => {
    const r = routineById('run_10k_10w')!;
    const long = (w: number) => r.program[w]!.find((d) => d.cardio!.type === 'long')!.cardio!.durationMin;
    expect(long(3)).toBeLessThan(long(2)); expect(long(2)).toBeGreaterThan(long(0));
  });
  it('converts a routine week into plan days', () => {
    const days = routineWeekDays(routineById('ul4_gym')!, 0);
    expect(days).toHaveLength(4);
    expect(days[0]!.items[0]).toMatchObject({ exerciseId: 'bench_press', sets: 4, repMin: 6, repMax: 8, restSec: 150 });
    expect(routineWeekDays(routineById('c25k_9w')!, 99)[0]!.kind).toBe('cardio');
  });
});
