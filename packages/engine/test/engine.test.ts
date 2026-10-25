import { describe, expect, it } from 'vitest';
import {
  checkAutonomy, DEFAULT_LIMITS, estimate1RM, generatePlan, nextLoad, nutritionTarget, recoveryScore,
  screenSafety, seedLoad, weeklyVolume, buildMenus, menusForDay, dayNumberOf, avoidList, dishById, dishKcal, haversine, acceptPoint, trackStats, simplifyRoute, supplementAdvice, splitFor, hrZones, allowedExercises, needsDeload, byId, paceMinPerKm, runningLoadAlert, gamification,
} from '../src';
import type { AssessmentInput } from '../src';

const base: AssessmentInput = {
  goal: 'hypertrophy', strengthDays: 3, cardioDays: 0, cardioModalities: [], experience: 'beginner', equipment: ['dumbbells'], restrictions: [],
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
  it('is deterministic', () => { const t = new Date('2026-01-01T00:00:00Z'); expect(generatePlan(base, t)).toEqual(generatePlan(base, t)); });
  it('bodyweight only when no equipment', () => {
    expect(allowedExercises({ equipment: [], restrictions: [] }).every((e) => e.equipment.includes('none'))).toBe(true);
  });
  it('covers every major muscle even with no equipment', () => {
    const p = generatePlan({ ...base, strengthDays: 4, equipment: ['none'] });
    const muscles = new Set(p.days.flatMap((d) => d.items.map((i) => byId(i.exerciseId)!.muscle)));
    for (const m of ['quads', 'hamstrings', 'glutes', 'chest', 'back', 'shoulders', 'triceps']) expect(muscles.has(m as never)).toBe(true);
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
  const n = { sex: 'f' as const, weightKg: 55, heightCm: 160, age: 30, lifeFactor: 1.2 as const, strengthDays: 2, cardioDays: 0, goal: 'fat_loss' as const };
  it('never goes below floor and explains itself', () => {
    const t = nutritionTarget(n);
    expect(t.kcal).toBeGreaterThanOrEqual(1200);
    expect(t.proteinG).toBe(110);
    expect(t.explain.bmr).toBe(1239);
    expect(t.explain.tdee).toBe(Math.round(t.explain.lifeKcal + t.explain.trainKcal));
    expect(t.explain.adjustPct).toBe(-15);
  });
  it('macros add up approximately', () => {
    const t = nutritionTarget({ ...n, sex: 'm', weightKg: 80, heightCm: 180, lifeFactor: 1.3, strengthDays: 4, cardioDays: 2, goal: 'hypertrophy' });
    expect(Math.abs(t.proteinG * 4 + t.carbsG * 4 + t.fatG * 9 - t.kcal)).toBeLessThan(15);
    expect(t.kcal).toBeGreaterThan(t.explain.tdee);
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
  it('empty', () => { expect(gamification([], 0)).toEqual({ xp: 0, level: 1, streakWeeks: 0, achievements: [] }); });
});

describe('exercise selection', () => {
  const gym: AssessmentInput = { ...base, equipment: ['barbell', 'dumbbells', 'machines', 'bar', 'bands', 'none'], strengthDays: 2 };
  it('beginners in a gym start on machines/dumbbells, never barbell squats first', () => {
    const ids = generatePlan(gym).days.flatMap((d) => d.items.map((i) => i.exerciseId));
    expect(ids).toContain('leg_press');
    expect(ids).not.toContain('back_squat');
  });
  it('advanced lifters start on free weights', () => {
    const ids = generatePlan({ ...gym, experience: 'advanced', restrictions: [] }).days.flatMap((d) => d.items.map((i) => i.exerciseId));
    expect(['front_squat', 'back_squat'].some((x) => ids.includes(x))).toBe(true);
    expect(ids).not.toContain('goblet_squat');
  });
});

describe('hybrid planning', () => {
  const hy: AssessmentInput = { ...base, experience: 'intermediate', goal: 'recomposition', strengthDays: 3, cardioDays: 2, cardioModalities: ['run', 'bike'], equipment: ['barbell', 'dumbbells', 'machines', 'bar', 'bands'] };
  it('mixes strength and cardio across the week and alternates modalities', () => {
    const p = generatePlan(hy);
    expect(p.days).toHaveLength(5);
    expect(p.days.filter((d) => d.kind === 'strength')).toHaveLength(3);
    const cardio = p.days.filter((d) => d.kind === 'cardio');
    expect(cardio.map((d) => d.cardio!.modality)).toEqual(['run', 'bike']);
  });
  it('rejects 0 or >6 training days', () => {
    expect(() => generatePlan({ ...hy, strengthDays: 0, cardioDays: 0 })).toThrow(/INVALID_DAYS/);
    expect(() => generatePlan({ ...hy, strengthDays: 5, cardioDays: 2 })).toThrow(/INVALID_DAYS/);
  });
  it('hard cardio is never next to a lower-body day', () => {
    for (const goal of ['vo2max', 'endurance', 'fat_loss'] as const) for (const [s, c] of [[3, 3], [2, 4], [4, 2], [3, 2]]) {
      const p = generatePlan({ ...hy, goal, experience: 'advanced', strengthDays: s!, cardioDays: c! });
      p.days.forEach((d, i) => {
        if (d.kind !== 'cardio' || !['intervals', 'tempo', 'long'].includes(d.cardio!.type)) return;
        for (const n of [p.days[i - 1], p.days[i + 1]]) if (n?.kind === 'strength') {
          const lower = n.items.filter((it) => ['quads', 'hamstrings', 'glutes'].includes(byId(it.exerciseId)!.muscle)).length;
          expect(lower).toBeLessThan(2);
        }
      });
    }
  });
  it('beginners get no hard cardio; running starts as run/walk', () => {
    const p = generatePlan({ ...hy, experience: 'beginner', goal: 'vo2max', cardioDays: 3, strengthDays: 1 });
    const types = p.days.filter((d) => d.kind === 'cardio').map((d) => d.cardio!.type);
    expect(types.every((t) => t === 'zone2' || t === 'walkrun')).toBe(true);
  });
  it('goal changes the prescription (fibre-type reasoning)', () => {
    const rep = (goal: AssessmentInput['goal']) => generatePlan({ ...hy, goal, cardioDays: 0 }).days[0]!.items[0]!;
    expect(rep('strength').repMax).toBeLessThanOrEqual(6);
    expect(rep('strength').restSec).toBeGreaterThanOrEqual(180);
    expect(rep('endurance').repMin).toBeGreaterThanOrEqual(15);
  });
  it('reports weekly volume per muscle', () => {
    const v = weeklyVolume(generatePlan({ ...hy, strengthDays: 4, cardioDays: 0 }));
    expect(v.find((r) => r.muscle === 'quads')!.sets).toBeGreaterThanOrEqual(6);
    expect(splitFor(4)).toHaveLength(4);
  });
});

describe('menus', () => {
  it('builds 30 distinct menus', () => {
    const m = buildMenus();
    expect(m).toHaveLength(30);
    expect(new Set(m.map((x) => x.dishIds.join('|'))).size).toBe(30);
  });
  it('respects every diet filter, even the strictest combination', () => {
    const combos: Parameters<typeof buildMenus>[0][] = [['vegan'], ['vegetarian'], ['gluten_free'], ['lactose_free'], ['nut_free'], ['egg_free'], ['fish_free'], ['vegan', 'gluten_free', 'nut_free']];
    for (const flags of combos) {
      const menus = buildMenus(flags);
      expect(menus.length).toBeGreaterThanOrEqual(30);
      const avoid = avoidList(flags!);
      for (const m of menus) for (const id of m.dishIds) expect(dishById(id)!.contains.some((c) => avoid.has(c))).toBe(false);
    }
  });
  it('shows 3 menus per day that rotate through all 30 in 10 days', () => {
    const seen = new Set<number>();
    for (let d = 0; d < 10; d++) { const day = menusForDay(20000 + d, 2200); expect(day).toHaveLength(3); day.forEach((x) => seen.add(x.index)); }
    expect(seen.size).toBe(30);
    expect(menusForDay(20000, 2200).map((x) => x.index)).not.toEqual(menusForDay(20001, 2200).map((x) => x.index));
    expect(dayNumberOf(new Date('2026-10-25T10:00:00Z'))).toBe(dayNumberOf(new Date('2026-10-25T23:00:00Z')));
  });
  it('scales portions near the target without extreme portions', () => {
    for (const t of [1600, 2200, 3000]) for (const m of menusForDay(20000, t)) { expect(m.factor).toBeGreaterThanOrEqual(0.6); expect(m.factor).toBeLessThanOrEqual(1.8); expect(Math.abs(m.kcal - t) / t).toBeLessThan(0.2); }
  });
  it('dish kcal is consistent with macros', () => { expect(dishKcal({ p: 10, c: 10, f: 10 })).toBe(170); });
});

describe('gps', () => {
  const p = (lat: number, lon: number, t: number, acc = 5) => ({ lat, lon, t, acc });
  it('haversine ≈ 111 m per 0.001° latitude', () => { expect(Math.round(haversine(p(0, 0, 0), p(0.001, 0, 0)))).toBeGreaterThanOrEqual(110); expect(haversine(p(0, 0, 0), p(0.001, 0, 0))).toBeLessThan(112); });
  it('rejects inaccurate fixes, jitter and teleports', () => {
    const a = p(-34.6, -58.4, 0);
    expect(acceptPoint(a, p(-34.6, -58.4, 5000, 80), 'run')).toBe(false);
    expect(acceptPoint(a, p(-34.60001, -58.4, 5000), 'run')).toBe(false); // ~1 m
    expect(acceptPoint(a, p(-34.7, -58.4, 5000), 'run')).toBe(false); // 11 km in 5 s
    expect(acceptPoint(a, p(-34.6001, -58.4, 5000), 'run')).toBe(true);
    expect(acceptPoint(undefined, a, 'run')).toBe(true);
  });
  it('computes distance and pace for a steady 10 km/h run', () => {
    const pts = Array.from({ length: 61 }, (_, i) => p(-34.6 + (i * 2.777) / 111320, -58.4, i * 1000)); // 2.777 m/s
    const s = trackStats(pts);
    expect(s.distanceM).toBeGreaterThan(165); expect(s.distanceM).toBeLessThan(170);
    expect(Math.abs(s.avgPaceSecKm - 360)).toBeLessThan(5);
    expect(Math.abs(s.currentPaceSecKm - 360)).toBeLessThan(5);
    expect(s.avgSpeedKmh).toBeCloseTo(10, 0);
  });
  it('pauses (gaps >30 s) do not count as moving time', () => {
    const s = trackStats([p(0, 0, 0), p(0.0001, 0, 5000), p(0.0002, 0, 600000)]);
    expect(s.movingSec).toBe(5);
  });
  it('simplifies routes', () => { expect(simplifyRoute(Array.from({ length: 1000 }, (_, i) => p(i / 1e4, 0, i)), 100).length).toBeLessThanOrEqual(101); });
});

describe('supplements', () => {
  it('only evidence-based and conditional on need', () => {
    const l = supplementAdvice({ goal: 'hypertrophy', cardioDays: 0, strengthDays: 4, diet: ['vegan'], proteinGapG: 30 });
    const ids = l.map((x) => x.id);
    expect(ids).toEqual(expect.arrayContaining(['creatine', 'whey_or_plant_protein', 'b12']));
    expect(ids).not.toContain('caffeine');
    expect(l.find((x) => x.id === 'vitamin_d_iron')!.evidence).toBe('conditional');
  });
});

describe('hr zones', () => { it('Tanaka estimate', () => { const z = hrZones(30); expect(z.max).toBe(187); expect(z.z2).toEqual([112, 131]); }); });
