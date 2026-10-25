import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { foodById, foodName, plateMacros, macrosFor, type Macros } from '@fondal/engine';
import type { RouteCtx } from './admin';

type Guard = (req: FastifyRequest, reply: FastifyReply) => Promise<unknown>;
export interface FoodCtx extends RouteCtx {
  athleteOnly: Guard;
  needHealth: (req: FastifyRequest, reply: FastifyReply) => Promise<boolean>;
  profileWeight: (uid: number) => Promise<number | null>;
  activityEnergy: (sport: string, meters: number, seconds: number, weightKg: number) => number;
}

const MEAL_TYPES = ['breakfast', 'lunch', 'snack', 'dinner'] as const;
const tzOffset = z.coerce.number().int().min(-840).max(840).default(0);
const localDay = (offset: number, at = Date.now()) => new Date(at - offset * 60000).toISOString().slice(0, 10);
const dayRange = (date: string, offset: number) => {
  const start = Date.parse(date + 'T00:00:00Z') + offset * 60000;
  return [new Date(start).toISOString(), new Date(start + 864e5).toISOString()] as const;
};
const mealTypeForHour = (h: number) => (h < 11 ? 'breakfast' : h < 16 ? 'lunch' : h < 20 ? 'snack' : 'dinner');

export function registerFood(c: FoodCtx) {
  const { app, db, athleteOnly } = c;

  /** Log food. With `items` (foodId + grams) the server recomputes kcal/macros from the reference table. */
  app.post('/api/nutrition/log', { preHandler: athleteOnly }, async (req, reply) => {
    if (!await c.needHealth(req, reply)) return;
    const b = c.parse(z.object({
      meal: z.string().trim().max(120).optional(),
      mealType: z.enum(MEAL_TYPES).optional(),
      items: z.array(z.object({ foodId: z.string().max(60), grams: z.number().min(1).max(5000) })).max(40).optional(),
      kcal: z.number().min(0).max(5000).optional(), proteinG: z.number().min(0).max(500).optional(), carbsG: z.number().min(0).max(1000).optional(), fatG: z.number().min(0).max(500).optional(),
      waterMl: z.number().min(0).max(10000).default(0),
      at: z.string().datetime().optional(), timezoneOffset: tzOffset,
    }).refine((x) => (x.items && x.items.length > 0) || x.kcal !== undefined || x.waterMl > 0, { message: 'empty' }), req.body, reply);
    if (!b) return;
    let m: Macros = { kcal: b.kcal ?? 0, p: b.proteinG ?? 0, c: b.carbsG ?? 0, f: b.fatG ?? 0 };
    let detail: { foodId: string; grams: number; kcal: number }[] = [];
    if (b.items?.length) {
      const valid = b.items.filter((i) => foodById(i.foodId));
      if (!valid.length) return reply.code(400).send({ error: 'unknown_food' });
      m = plateMacros(valid);
      detail = valid.map((i) => ({ ...i, kcal: macrosFor(foodById(i.foodId)!, i.grams).kcal }));
    }
    let when = new Date();
    if (b.at) {
      const t = new Date(b.at);
      if (t.getTime() > Date.now() + 3600e3 || t.getTime() < Date.now() - 90 * 864e5) return reply.code(400).send({ error: 'invalid_date' });
      when = t;
    }
    const mealType = b.mealType ?? mealTypeForHour(new Date(when.getTime() - b.timezoneOffset * 60000).getUTCHours());
    const name = b.meal || (detail.length ? detail.map((d) => foodName(foodById(d.foodId)!, 'es')).slice(0, 3).join(', ') : 'water');
    const data = { meal: name, mealType, kcal: m.kcal, proteinG: m.p, carbsG: m.c, fatG: m.f, waterMl: b.waterMl, items: detail };
    const r = await db.prepare("INSERT INTO nutrition(user_id,kind,data,created_at) VALUES(?,'log',?,?) RETURNING id").get(req.user!.id, JSON.stringify(data), when.toISOString()) as { id: number };
    return { id: r.id, ...data };
  });

  app.delete('/api/nutrition/log/:id', { preHandler: athleteOnly }, async (req, reply) => {
    const r = await db.prepare("DELETE FROM nutrition WHERE id=? AND user_id=? AND kind='log'").run(Number((req.params as { id: string }).id), req.user!.id);
    return r.changes ? { ok: true } : reply.code(404).send({ error: 'not_found' });
  });

  const readTarget = async (uid: number) => {
    const t = await db.prepare("SELECT data FROM nutrition WHERE user_id=? AND kind='target' ORDER BY id DESC LIMIT 1").get(uid) as { data: string } | undefined;
    return t ? JSON.parse(t.data) as { kcal: number; proteinG: number; carbsG: number; fatG: number; waterMl: number; floored: boolean; explain?: { bmr: number; lifeKcal: number; lifeFactor: number; tdee: number } } : null;
  };

  interface LogRow { id: number; created_at: string; data: string }
  const dayLogs = async (uid: number, from: string, to: string) =>
    (await db.prepare("SELECT id,created_at,data FROM nutrition WHERE user_id=? AND kind='log' AND created_at>=? AND created_at<? ORDER BY created_at, id").all(uid, from, to) as unknown as LogRow[])
      .map((r) => ({ id: r.id, at: r.created_at, ...(JSON.parse(r.data) as Record<string, unknown>) })) as { id: number; at: string; kcal: number; proteinG: number; carbsG: number; fatG: number; waterMl: number; meal: string; mealType?: string; items?: unknown[] }[];

  /** Everything the Home and Food screens need for one local day: intake, activity, estimated expenditure and balance. */
  app.get('/api/day', { preHandler: athleteOnly }, async (req, reply) => {
    const q = c.parse(z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), timezoneOffset: tzOffset }), req.query, reply);
    if (!q) return;
    const uid = req.user!.id, date = q.date ?? localDay(q.timezoneOffset);
    const [from, to] = dayRange(date, q.timezoneOffset);
    const target = await readTarget(uid);
    const logs = await dayLogs(uid, from, to);
    const sum = (k: 'kcal' | 'proteinG' | 'carbsG' | 'fatG' | 'waterMl') => logs.reduce((a, l) => a + (Number(l[k]) || 0), 0);
    const weight = await c.profileWeight(uid);
    const exercise: { kind: string; name: string; kcal: number | null }[] = [];
    const acts = await db.prepare('SELECT id,sport,duration_sec,distance_m FROM activities WHERE user_id=? AND started_at>=? AND started_at<?').all(uid, from, to) as { id: number; sport: string; duration_sec: number; distance_m: number }[];
    for (const a of acts) exercise.push({ kind: 'gps', name: a.sport, kcal: weight ? c.activityEnergy(a.sport, a.distance_m, a.duration_sec, weight) : null });
    const blocks = await db.prepare("SELECT data FROM nutrition WHERE user_id=? AND kind='exercise' AND created_at>=? AND created_at<?").all(uid, from, to) as { data: string }[];
    for (const b of blocks) { const d = JSON.parse(b.data) as { kind?: string; kcal?: number; blocks?: { name: string }[] }; if (d.kind === 'blocks') exercise.push({ kind: 'blocks', name: (d.blocks ?? []).map((x) => x.name).join(', '), kcal: Number(d.kcal) || 0 }); }
    const wk = (await db.prepare('SELECT CAST(COUNT(*) AS INTEGER) c FROM workouts WHERE user_id=? AND created_at>=? AND created_at<?').get(uid, from, to) as { c: number }).c;
    // strength session ≈ 45 min at ~4.5 MET (above resting): a stated assumption, not a measurement
    for (let i = 0; i < wk; i++) exercise.push({ kind: 'strength', name: 'strength', kcal: weight ? Math.round((4.5 - 1) * 3.5 * weight / 200 * 45) : null });
    const burnedExercise = exercise.reduce((a, e) => a + (e.kcal ?? 0), 0);
    const resting = target?.explain?.lifeKcal ?? null;
    const expenditure = resting === null ? null : Math.round(resting + burnedExercise);
    const intake = Math.round(sum('kcal'));
    const balance = expenditure === null ? null : intake - expenditure;
    const vsTarget = target ? intake - target.kcal : null;
    return {
      date, target, intake: { kcal: intake, proteinG: Math.round(sum('proteinG')), carbsG: Math.round(sum('carbsG')), fatG: Math.round(sum('fatG')), waterMl: Math.round(sum('waterMl')) },
      logs, exercise, burnedExercise, resting, expenditure, balance, vsTarget,
      estimated: true,
      note: 'Estimated energy balance: resting + daily-life expenditure is a formula, exercise is estimated from MET tables; neither is measured.',
    };
  });

  /** Compatibility shape used by earlier clients (today = the user's local day). */
  app.get('/api/nutrition', { preHandler: athleteOnly }, async (req, reply) => {
    const q = c.parse(z.object({ timezoneOffset: tzOffset }), req.query, reply);
    if (!q) return;
    const uid = req.user!.id, [from, to] = dayRange(localDay(q.timezoneOffset), q.timezoneOffset);
    const today = await dayLogs(uid, from, to);
    const sum = (k: 'kcal' | 'proteinG' | 'carbsG' | 'fatG' | 'waterMl') => today.reduce((a, l) => a + (Number(l[k]) || 0), 0);
    const recent = await db.prepare("SELECT created_at,data FROM nutrition WHERE user_id=? AND kind='log' ORDER BY id DESC LIMIT 200").all(uid) as { created_at: string; data: string }[];
    return { target: await readTarget(uid), logs: recent.map((r) => ({ ...JSON.parse(r.data), at: r.created_at })), today: { kcal: sum('kcal'), proteinG: sum('proteinG'), carbsG: sum('carbsG'), fatG: sum('fatG'), waterMl: sum('waterMl') } };
  });

  /** Recently logged distinct meals, for one-tap re-logging. */
  app.get('/api/nutrition/recent', { preHandler: athleteOnly }, async (req) => {
    const rows = await db.prepare("SELECT data FROM nutrition WHERE user_id=? AND kind='log' ORDER BY id DESC LIMIT 120").all(req.user!.id) as { data: string }[];
    const seen = new Set<string>(), out: unknown[] = [];
    for (const r of rows) {
      const d = JSON.parse(r.data) as { meal: string; items?: unknown[]; kcal: number };
      if (!d.items?.length || seen.has(d.meal)) continue;
      seen.add(d.meal); out.push(d);
      if (out.length >= 10) break;
    }
    return { recent: out };
  });
}
