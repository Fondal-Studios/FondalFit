import { describe, expect, it } from 'vitest';
import {
  checkAutonomy, DEFAULT_LIMITS, estimate1RM, generatePlan, nextLoad, nutritionTarget, recoveryScore,
  screenSafety, seedLoad, allowedExercises, needsDeload, byId, paceMinPerKm, runningLoadAlert, gamification,
} from '../src';
import type { AssessmentInput } from '../src';

const base: AssessmentInput = {
  goal: 'hypertrophy', daysPerWeek: 3, experience: 'beginner', equipment: ['dumbbells'], restrictions: [],
  redFlags: { chestPain: false, dizziness: false, recentSurgery: false, pregnancy: false, medication: false },
};

describe('estimate1RM', () => {
  it('Epley', () => { expect(estimate1RM(100, 5)).toBe(116.7); expect(estimate1RM(100, 1)).toBe(100); expect(estimate1RM(0, 5)).toBe(0); });
});

describe('safety', () => {
  it('blocks plan with red flags', () => {
    const a = { ...base, redFlags: { ...base.redFlags, chestPain: true } };
    expect(screenSafety(a)).toEqual({ status: 'refer', reasons: ['chestPain'] });
    expect(() => generatePlan(a)).toThrow(/REFERRAL_REQUIRED/);
  });
});

describe('generatePlan', () => {
  it('respects restrictions and equipment', () => {
    const p = generatePlan({ ...base, restrictions: ['knee', 'shoulder'] });
    const ids = p.days.flatMap((d) => d.items.map((i) => i.exerciseId));
    for (const id of ids) {
      const ex = byId(id)!;
      expect(ex.stresses).not.toContain('knee');
      expect(ex.stresses).not.toContain('shoulder');
    }
    expect(p.days).toHaveLength(3);
  });
  it('is deterministic', () => { expect(generatePlan(base)).toEqual(generatePlan(base)); });
  it('bodyweight only when no equipment', () => {
    expect(allowedExercises({ equipment: [], restrictions: [] }).every((e) => e.equipment.includes('none'))).toBe(true);
  });
});

describe('progression', () => {
  const p = { exerciseId: 'dumbbell_press', sets: 3, repMin: 8, repMax: 12, rirTarget: 2, load: 10 };
  it('increases at top of range', () => {
    expect(nextLoad(p, [{ weight: 10, reps: 12, rir: 2 }, { weight: 10, reps: 12, rir: 3 }])).toMatchObject({ action: 'increase', load: 12 });
  });
  it('holds within range', () => { expect(nextLoad(p, [{ weight: 10, reps: 10, rir: 2 }]).action).toBe('hold'); });
  it('decreases on failure below range', () => {
    expect(nextLoad(p, [{ weight: 10, reps: 5, rir: 0 }])).toMatchObject({ action: 'decrease', load: 8 });
  });
  it('bodyweight never gets load', () => {
    expect(nextLoad({ ...p, exerciseId: 'push_up', load: 0 }, [{ weight: 0, reps: 12, rir: 3 }]).load).toBe(0);
  });
  it('seeds a conservative load', () => {
    const s = seedLoad({ weight: 20, reps: 10, rir: 2 }, p);
    expect(s).toBeGreaterThan(0); expect(s).toBeLessThanOrEqual(20);
  });
});

describe('autonomy limits', () => {
  it('allows within limits', () => {
    expect(checkAutonomy(DEFAULT_LIMITS, { loadIncreasePct: 5, weeklyVolumeDeltaPct: 10, sessionsPerWeek: 4 })).toEqual({ allowed: true });
  });
  it('flags every violation', () => {
    const r = checkAutonomy(DEFAULT_LIMITS, { loadIncreasePct: 8, weeklyVolumeDeltaPct: -20, sessionsPerWeek: 6 });
    expect(r).toEqual({ allowed: false, violations: ['load_increase', 'weekly_volume', 'sessions_per_week'] });
  });
  it('deload requires permission', () => {
    const l = { ...DEFAULT_LIMITS, allowAutoDeload: false };
    expect(checkAutonomy(l, { loadIncreasePct: 0, weeklyVolumeDeltaPct: -40, sessionsPerWeek: 3, isDeload: true }).allowed).toBe(false);
    expect(needsDeload(6, 5, l)).toBe(false);
    expect(needsDeload(6, 5)).toBe(true);
  });
});

describe('nutrition', () => {
  const n = { sex: 'f' as const, weightKg: 55, heightCm: 160, age: 30, activity: 1.2 as const, goal: 'fat_loss' as const };
  it('never goes below floor', () => {
    const t = nutritionTarget(n);
    expect(t.kcal).toBeGreaterThanOrEqual(1200);
    expect(t.proteinG).toBe(88);
  });
  it('macros add up approximately', () => {
    const t = nutritionTarget({ ...n, sex: 'm', weightKg: 80, heightCm: 180, activity: 1.55, goal: 'hypertrophy' });
    expect(Math.abs(t.proteinG * 4 + t.carbsG * 4 + t.fatG * 9 - t.kcal)).toBeLessThan(15);
  });
});

describe('recovery', () => {
  it('alerts', () => {
    const r = recoveryScore({ sleepHours: 4, fatigue: 9, stress: 8, pain: 8 });
    expect(r.alerts).toEqual(['low_sleep', 'high_fatigue', 'high_pain']);
    expect(r.score).toBeLessThan(50);
    expect(recoveryScore({ sleepHours: 8, fatigue: 1, stress: 1, pain: 0 }).score).toBe(100);
  });
});

describe('running', () => {
  it('pace', () => { expect(paceMinPerKm(10, 55)).toBe(5.5); expect(paceMinPerKm(0, 10)).toBe(0); });
  it('flags jumps only', () => {
    expect(runningLoadAlert(20, 21)).toEqual([]);
    expect(runningLoadAlert(20, 30)).toEqual(['run_volume_jump']);
    expect(runningLoadAlert(0, 25)).toEqual(['run_volume_jump']);
  });
});

describe('gamification', () => {
  it('caps XP at one activity per day and tracks streak', () => {
    const g = gamification([{ date: '2026-10-05', sessions: 3, runs: 2 }, { date: '2026-10-12', sessions: 1, runs: 0 }, { date: '2026-10-19', sessions: 1, runs: 0 }, { date: '2026-10-26', sessions: 1, runs: 0 }], 1);
    expect(g.xp).toBe(200);
    expect(g.streakWeeks).toBe(4);
    expect(g.achievements).toEqual(expect.arrayContaining(['first_session', 'first_run', 'streak_4_weeks', 'recovery_logged']));
  });
  it('empty', () => { expect(gamification([], 0)).toMatchObject({ xp: 0, level: 1, streakWeeks: 0, achievements: [] }); });
  it('adds safe consistency challenges and milestone rewards', () => { const g=gamification([{date:'2026-10-19',sessions:1,runs:1}],0);expect(g.challenges.length).toBe(3);expect(g.achievements).toContain('balanced_week');expect(g.rewards.title).toBeTruthy(); });
});
