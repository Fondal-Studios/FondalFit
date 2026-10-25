export interface WeekMetrics { sessions: number; activeDays: number; activeMinutes: number; runKm: number; bikeKm: number; mealDays: number; recoveryDays: number }
export type Metric = keyof WeekMetrics;
export interface Challenge { id: string; metric: Metric; target: number; points: number }

/** Weekly pool. Targets stay within mainstream guidance (e.g. 150 min of activity per week): no challenge rewards doing more than is healthy. */
const POOL: Challenge[] = [
  { id: 'move_150', metric: 'activeMinutes', target: 150, points: 30 },
  { id: 'train_3', metric: 'sessions', target: 3, points: 25 },
  { id: 'days_4', metric: 'activeDays', target: 4, points: 25 },
  { id: 'run_10', metric: 'runKm', target: 10, points: 25 },
  { id: 'run_5', metric: 'runKm', target: 5, points: 20 },
  { id: 'bike_40', metric: 'bikeKm', target: 40, points: 25 },
  { id: 'meals_5', metric: 'mealDays', target: 5, points: 20 },
  { id: 'recovery_4', metric: 'recoveryDays', target: 4, points: 20 },
];

export const isoWeekKey = (d: Date): string => {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const y0 = Date.UTC(t.getUTCFullYear(), 0, 1);
  return `${t.getUTCFullYear()}-W${String(Math.ceil(((t.getTime() - y0) / 864e5 + 1) / 7)).padStart(2, '0')}`;
};
/** Monday 00:00 UTC of the ISO week containing `d`. */
export const weekStartUtc = (d: Date): Date => { const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())); t.setUTCDate(t.getUTCDate() - ((t.getUTCDay() + 6) % 7)); return t; };

const hash = (s: string) => { let h = 2166136261; for (const c of s) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; };

/** Three challenges per week: the 150-minute anchor plus two rotating ones suited to what the user does. */
export function challengesForWeek(week: string, does: { run: boolean; bike: boolean } = { run: true, bike: false }): Challenge[] {
  const eligible = POOL.filter((c) => c.id !== 'move_150' && (c.metric !== 'runKm' || does.run) && (c.metric !== 'bikeKm' || does.bike));
  const h = hash(week);
  const first = eligible[h % eligible.length]!;
  const rest = eligible.filter((c) => c.metric !== first.metric);
  const second = rest[(h >>> 8) % rest.length]!;
  return [POOL[0]!, first, second];
}

export const evaluateChallenge = (c: Challenge, m: WeekMetrics) => { const value = m[c.metric]; return { value, pct: Math.min(100, Math.round((value / c.target) * 100)), done: value >= c.target }; };

export const WEEKLY_POINTS_CAP = 150;
/**
 * Ranking points reward consistency, not volume: capped active days (≤5), logging habits (≤5 days each) and challenge completions.
 * Training 7 days or running 100 km earns no more than a balanced week.
 */
export function weeklyPoints(m: WeekMetrics, challenges: Challenge[]): number {
  const base = Math.min(m.activeDays, 5) * 10 + Math.min(m.mealDays, 5) * 4 + Math.min(m.recoveryDays, 5) * 3;
  const bonus = challenges.filter((c) => evaluateChallenge(c, m).done).reduce((a, c) => a + c.points, 0);
  return Math.min(WEEKLY_POINTS_CAP, base + bonus);
}

export const normalizeZone = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9\s-]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 40);
