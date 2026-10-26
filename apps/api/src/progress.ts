import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { estimate1RM, nutritionTarget, weekStartUtc, type Goal } from '@fondal/engine';
import type { RouteCtx } from './admin';

type Guard = (req: FastifyRequest, reply: FastifyReply) => Promise<unknown>;
export interface ProgressCtx extends RouteCtx { athleteOnly: Guard; needHealth: (req: FastifyRequest, reply: FastifyReply) => Promise<boolean> }

const measureSchema = z.object({
  day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  weightKg: z.number().min(30).max(300).optional(), bodyFatPct: z.number().min(3).max(60).optional(),
  waistCm: z.number().min(40).max(200).optional(), chestCm: z.number().min(50).max(200).optional(), hipCm: z.number().min(50).max(200).optional(),
  armCm: z.number().min(15).max(70).optional(), thighCm: z.number().min(30).max(120).optional(),
  source: z.enum(['manual', 'scale', 'csv']).default('manual'),
  applyToProfile: z.boolean().optional(),
}).refine((m) => ['weightKg', 'bodyFatPct', 'waistCm', 'chestCm', 'hipCm', 'armCm', 'thighCm'].some((k) => (m as Record<string, unknown>)[k] !== undefined), { message: 'empty' });

export function registerProgress(c: ProgressCtx) {
  const { app, db, athleteOnly } = c;

  /** Re-derive calorie targets after a new weight (profile + assessment copy), without regenerating the plan. */
  const applyWeight = async (uid: number, kg: number) => {
    const r = await db.prepare('SELECT data FROM assessments WHERE user_id=? ORDER BY id DESC LIMIT 1').get(uid) as { data: string } | undefined;
    if (!r) return false;
    const a = JSON.parse(r.data) as { profile: { diet?: string[]; weightKg: number } & Record<string, unknown>; goal: Goal; strengthDays: number; cardioDays: number };
    a.profile.weightKg = kg;
    const now = c.now();
    await db.prepare('INSERT INTO assessments(user_id,data,created_at) VALUES(?,?,?)').run(uid, JSON.stringify(a), now);
    await db.prepare('INSERT INTO profiles(user_id,data,updated_at) VALUES(?,?,?) ON CONFLICT(user_id) DO UPDATE SET data=excluded.data, updated_at=excluded.updated_at').run(uid, JSON.stringify(a.profile), now);
    const t = nutritionTarget({ ...(a.profile as unknown as Parameters<typeof nutritionTarget>[0]), strengthDays: a.strengthDays, cardioDays: a.cardioDays, goal: a.goal });
    await db.prepare("INSERT INTO nutrition(user_id,kind,data,created_at) VALUES(?,'target',?,?)").run(uid, JSON.stringify({ ...t, diet: a.profile.diet ?? [] }), now);
    return true;
  };

  /* ----- body measurements (manual, Bluetooth scale or CSV import) ----- */
  app.post('/api/measurements', { preHandler: athleteOnly }, async (req, reply) => {
    if (!await c.needHealth(req, reply)) return;
    const b = c.parse(measureSchema, req.body, reply);
    if (!b) return;
    const { applyToProfile, day, ...data } = b;
    const d = day ?? c.now().slice(0, 10);
    const r = await db.prepare('INSERT INTO measurements(user_id,day,data,created_at) VALUES(?,?,?,?) RETURNING id').get(req.user!.id, d, JSON.stringify(data), c.now()) as { id: number };
    let targetUpdated = false;
    if (applyToProfile && data.weightKg) targetUpdated = await applyWeight(req.user!.id, data.weightKg);
    return { id: r.id, targetUpdated };
  });
  app.post('/api/measurements/bulk', { preHandler: athleteOnly }, async (req, reply) => {
    if (!await c.needHealth(req, reply)) return;
    const b = c.parse(z.object({ rows: z.array(z.object({ day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), weightKg: z.number().min(30).max(300) })).min(1).max(400) }), req.body, reply);
    if (!b) return;
    const have = new Set((await db.prepare('SELECT day,data FROM measurements WHERE user_id=?').all(req.user!.id) as { day: string; data: string }[]).filter((m) => JSON.parse(m.data).weightKg !== undefined).map((m) => m.day));
    let added = 0;
    for (const row of b.rows) {
      if (have.has(row.day)) continue;
      await db.prepare('INSERT INTO measurements(user_id,day,data,created_at) VALUES(?,?,?,?)').run(req.user!.id, row.day, JSON.stringify({ weightKg: row.weightKg, source: 'csv' }), c.now());
      have.add(row.day); added++;
    }
    return { added, skipped: b.rows.length - added };
  });
  app.get('/api/measurements', { preHandler: athleteOnly }, async (req) => {
    const rows = (await db.prepare('SELECT id,day,data FROM measurements WHERE user_id=? ORDER BY day, id').all(req.user!.id) as { id: number; day: string; data: string }[]).map((r): Record<string, number | string> => ({ id: r.id, day: r.day, ...(JSON.parse(r.data) as Record<string, number | string>) }));
    const latest: Record<string, number> = {};
    for (const r of rows) for (const k of ['weightKg', 'bodyFatPct', 'waistCm', 'chestCm', 'hipCm', 'armCm', 'thighCm']) if (typeof r[k] === 'number') latest[k] = r[k] as number;
    return { entries: rows, latest };
  });
  app.delete('/api/measurements/:id', { preHandler: athleteOnly }, async (req, reply) => {
    const r = await db.prepare('DELETE FROM measurements WHERE id=? AND user_id=?').run(Number((req.params as { id: string }).id), req.user!.id);
    return r.changes ? { ok: true } : reply.code(404).send({ error: 'not_found' });
  });

  /* ----- lift progress ----- */
  interface Wk { created_at: string; data: string }
  const workouts = async (uid: number) => (await db.prepare('SELECT created_at,data FROM workouts WHERE user_id=? ORDER BY id DESC LIMIT 500').all(uid) as Wk[]).reverse()
    .map((w) => ({ at: w.created_at, items: (JSON.parse(w.data) as { items: { exerciseId: string; sets: { weight: number; reps: number; rir: number }[] }[] }).items }));

  app.get('/api/progress/exercises', { preHandler: athleteOnly }, async (req) => {
    const by = new Map<string, { id: string; sessions: number; last: string; bestE1rm: number }>();
    for (const w of await workouts(req.user!.id)) for (const it of w.items) {
      const e = by.get(it.exerciseId) ?? { id: it.exerciseId, sessions: 0, last: w.at, bestE1rm: 0 };
      e.sessions++; e.last = w.at;
      for (const s of it.sets) if (s.reps >= 1 && s.reps <= 12) e.bestE1rm = Math.max(e.bestE1rm, estimate1RM(s.weight, s.reps));
      by.set(it.exerciseId, e);
    }
    return { exercises: [...by.values()].sort((a, b) => b.sessions - a.sessions) };
  });
  app.get('/api/progress/exercise/:id', { preHandler: athleteOnly }, async (req) => {
    const id = (req.params as { id: string }).id;
    const series = (await workouts(req.user!.id)).flatMap((w) => {
      const it = w.items.find((x) => x.exerciseId === id);
      if (!it) return [];
      const top = it.sets.reduce((b, s) => (s.weight > b.weight || (s.weight === b.weight && s.reps > b.reps) ? s : b), it.sets[0]!);
      const e1rm = Math.max(0, ...it.sets.filter((s) => s.reps >= 1 && s.reps <= 12).map((s) => estimate1RM(s.weight, s.reps)));
      return [{ date: w.at, topWeight: top.weight, topReps: top.reps, e1rm, volume: Math.round(it.sets.reduce((a, s) => a + s.weight * s.reps, 0)), sets: it.sets.length }];
    });
    return { exerciseId: id, series };
  });

  /** Last logged sets per exercise ("last time: 40 kg × 8") for the session screen. */
  app.get('/api/progress/last', { preHandler: athleteOnly }, async (req, reply) => {
    const q = c.parse(z.object({ ids: z.string().max(1500) }), req.query, reply);
    if (!q) return;
    const want = new Set(q.ids.split(',').filter(Boolean).slice(0, 40));
    const out: Record<string, { at: string; sets: { weight: number; reps: number; rir: number }[] }> = {};
    for (const w of (await workouts(req.user!.id)).reverse()) for (const it of w.items) if (want.has(it.exerciseId) && !out[it.exerciseId]) out[it.exerciseId] = { at: w.at, sets: it.sets };
    return { last: out };
  });

  /** Progress toward the measurable targets chosen in the assessment (all values are estimates, labelled as such in the UI). */
  app.get('/api/goals', { preHandler: athleteOnly }, async (req) => {
    const uid = req.user!.id;
    const a = await db.prepare('SELECT data FROM assessments WHERE user_id=? ORDER BY id ASC LIMIT 1').get(uid) as { data: string } | undefined;
    const latestA = await db.prepare('SELECT data FROM assessments WHERE user_id=? ORDER BY id DESC LIMIT 1').get(uid) as { data: string } | undefined;
    if (!latestA) return { goal: null, secondary: [], targets: [] };
    const cur = JSON.parse(latestA.data) as { goal: string; secondaryGoals?: string[]; targets?: ({ metric: 'weight'; targetKg: number; byDate?: string } | { metric: 'run5k'; targetSec: number; byDate?: string } | { metric: 'lift'; exerciseId: string; targetKg: number; byDate?: string })[]; profile: { weightKg: number } };
    const first = a ? (JSON.parse(a.data) as { profile: { weightKg: number } }) : cur;
    const ms = (await db.prepare('SELECT day,data FROM measurements WHERE user_id=? ORDER BY day, id').all(uid) as { day: string; data: string }[]).map((m) => ({ day: m.day, ...(JSON.parse(m.data) as { weightKg?: number }) })).filter((m) => m.weightKg !== undefined);
    const weights = ms.map((m) => m.weightKg!);
    const startW = first.profile.weightKg, nowW = weights[weights.length - 1] ?? cur.profile.weightKg;
    const runs = await db.prepare("SELECT distance_m,duration_sec FROM activities WHERE user_id=? AND sport='run' AND distance_m>=5000").all(uid) as { distance_m: number; duration_sec: number }[];
    const best5k = runs.length ? Math.min(...runs.map((r) => Math.round((r.duration_sec * 5000) / r.distance_m))) : null;
    const wk = await workouts(uid);
    const out = cur.targets?.map((t) => {
      if (t.metric === 'weight') { const total = startW - t.targetKg; const pct = total === 0 ? 100 : Math.max(0, Math.min(100, Math.round(((startW - nowW) / total) * 100))); return { ...t, current: nowW, start: startW, pct }; }
      if (t.metric === 'run5k') return { ...t, current: best5k, pct: best5k ? Math.min(100, Math.round((t.targetSec / best5k) * 100)) : 0, projected: true };
      const e1 = Math.max(0, ...wk.flatMap((w) => w.items.filter((i) => i.exerciseId === t.exerciseId).flatMap((i) => i.sets.filter((s) => s.reps >= 1 && s.reps <= 12).map((s) => estimate1RM(s.weight, s.reps)))));
      return { ...t, current: e1 || null, pct: e1 ? Math.min(100, Math.round((e1 / t.targetKg) * 100)) : 0, projected: true };
    }) ?? [];
    return { goal: cur.goal, secondary: cur.secondaryGoals ?? [], targets: out };
  });

  /* ----- running / cycling weekly series ----- */
  app.get('/api/progress/running', { preHandler: athleteOnly }, async (req) => {
    const rows = await db.prepare('SELECT sport,started_at,moving_sec,duration_sec,distance_m FROM activities WHERE user_id=? ORDER BY started_at').all(req.user!.id) as { sport: string; started_at: string; moving_sec: number; duration_sec: number; distance_m: number }[];
    const weeks = new Map<string, { week: string; runKm: number; runSec: number; runs: number; bikeKm: number }>();
    for (const r of rows) {
      const wk = weekStartUtc(new Date(r.started_at)).toISOString().slice(0, 10);
      const w = weeks.get(wk) ?? { week: wk, runKm: 0, runSec: 0, runs: 0, bikeKm: 0 };
      if (r.sport === 'run') { w.runKm += r.distance_m / 1000; w.runSec += r.duration_sec; w.runs++; } else if (r.sport === 'bike') w.bikeKm += r.distance_m / 1000;
      weeks.set(wk, w);
    }
    const series = [...weeks.values()].slice(-12).map((w) => ({ week: w.week, runKm: Math.round(w.runKm * 10) / 10, runs: w.runs, bikeKm: Math.round(w.bikeKm * 10) / 10, avgPaceSecKm: w.runKm > 0.5 ? Math.round(w.runSec / w.runKm) : 0 }));
    const runs = rows.filter((r) => r.sport === 'run');
    const fast = runs.filter((r) => r.distance_m >= 3000).map((r) => Math.round((r.duration_sec * 1000) / r.distance_m)).sort((a, b) => a - b)[0] ?? null;
    return { series, longestRunKm: Math.round(Math.max(0, ...runs.map((r) => r.distance_m)) / 100) / 10, fastestPaceSecKm: fast, totalRunKm: Math.round(runs.reduce((a, r) => a + r.distance_m, 0) / 100) / 10 };
  });
}
