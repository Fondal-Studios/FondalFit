import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { FOODS, foodById, foodName, parseMeal, plateMacros, macrosFor, type Macros } from '@fondal/engine';
import type { RouteCtx } from './admin';

type Guard = (req: FastifyRequest, reply: FastifyReply) => Promise<unknown>;
export interface FoodCtx extends RouteCtx {
  athleteOnly: Guard;
  needHealth: (req: FastifyRequest, reply: FastifyReply) => Promise<boolean>;
  profileWeight: (uid: number) => Promise<number | null>;
  activityEnergy: (sport: string, meters: number, seconds: number, weightKg: number) => number;
  /** the configured language model, if any (same one the coach uses) */
  ai?: (system: string, messages: { role: 'user' | 'assistant'; content: string }[]) => Promise<string>;
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
      /** foods that are not in the table (AI-estimated): per-100 g values with sane bounds */
      custom: z.array(z.object({ name: z.string().trim().min(1).max(60), grams: z.number().min(1).max(2000), kcalPer100: z.number().min(0).max(900), proteinPer100: z.number().min(0).max(100), carbsPer100: z.number().min(0).max(100), fatPer100: z.number().min(0).max(100) })).max(10).optional(),
      kcal: z.number().min(0).max(5000).optional(), proteinG: z.number().min(0).max(500).optional(), carbsG: z.number().min(0).max(1000).optional(), fatG: z.number().min(0).max(500).optional(),
      waterMl: z.number().min(0).max(10000).default(0),
      at: z.string().datetime().optional(), timezoneOffset: tzOffset,
    }).refine((x) => (x.items && x.items.length > 0) || (x.custom && x.custom.length > 0) || x.kcal !== undefined || x.waterMl > 0, { message: 'empty' }), req.body, reply);
    if (!b) return;
    let m: Macros = { kcal: b.kcal ?? 0, p: b.proteinG ?? 0, c: b.carbsG ?? 0, f: b.fatG ?? 0 };
    let detail: { foodId?: string; name?: string; custom?: boolean; grams: number; kcal: number }[] = [];
    if (b.items?.length || b.custom?.length) {
      const valid = (b.items ?? []).filter((i) => foodById(i.foodId));
      if ((b.items?.length ?? 0) > 0 && !valid.length && !b.custom?.length) return reply.code(400).send({ error: 'unknown_food' });
      const base = plateMacros(valid);
      const cm = (b.custom ?? []).map((cu) => { const k = cu.grams / 100; return { kcal: Math.round(cu.kcalPer100 * k), p: Math.round(cu.proteinPer100 * k * 10) / 10, c: Math.round(cu.carbsPer100 * k * 10) / 10, f: Math.round(cu.fatPer100 * k * 10) / 10 }; });
      m = { kcal: base.kcal + cm.reduce((a, x) => a + x.kcal, 0), p: Math.round((base.p + cm.reduce((a, x) => a + x.p, 0)) * 10) / 10, c: Math.round((base.c + cm.reduce((a, x) => a + x.c, 0)) * 10) / 10, f: Math.round((base.f + cm.reduce((a, x) => a + x.f, 0)) * 10) / 10 };
      detail = [...valid.map((i) => ({ ...i, kcal: macrosFor(foodById(i.foodId)!, i.grams).kcal })), ...(b.custom ?? []).map((cu, i) => ({ name: cu.name, custom: true, grams: cu.grams, kcal: cm[i]!.kcal }))];
    }
    let when = new Date();
    if (b.at) {
      const t = new Date(b.at);
      if (t.getTime() > Date.now() + 3600e3 || t.getTime() < Date.now() - 90 * 864e5) return reply.code(400).send({ error: 'invalid_date' });
      when = t;
    }
    const mealType = b.mealType ?? mealTypeForHour(new Date(when.getTime() - b.timezoneOffset * 60000).getUTCHours());
    const name = b.meal || (detail.length ? detail.map((d) => (d.foodId ? foodName(foodById(d.foodId)!, 'es') : d.name!)).slice(0, 3).join(', ') : 'water');
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
    const exercise: { kind: string; name: string; kcal: number | null; id?: number; deletable?: boolean; detail?: string }[] = [];
    const acts = await db.prepare('SELECT id,sport,duration_sec,distance_m,kcal_manual FROM activities WHERE user_id=? AND started_at>=? AND started_at<?').all(uid, from, to) as { id: number; sport: string; duration_sec: number; distance_m: number; kcal_manual: number | null }[];
    for (const a of acts) exercise.push({ kind: 'gps', id: a.id, deletable: true, detail: `${(a.distance_m / 1000).toFixed(2)} km · ${Math.round(a.duration_sec / 60)} min`, name: a.sport, kcal: a.kcal_manual !== null && a.kcal_manual !== undefined ? Number(a.kcal_manual) : weight ? c.activityEnergy(a.sport, a.distance_m, a.duration_sec, weight) : null });
    const blocks = await db.prepare("SELECT id,data FROM nutrition WHERE user_id=? AND kind='exercise' AND created_at>=? AND created_at<?").all(uid, from, to) as { id: number; data: string }[];
    for (const b of blocks) { const d = JSON.parse(b.data) as { kind?: string; kcal?: number; blocks?: { name: string }[] }; if (d.kind === 'blocks') exercise.push({ kind: 'blocks', id: b.id, deletable: true, name: (d.blocks ?? []).map((x) => x.name).join(', '), kcal: Number(d.kcal) || 0 }); }
    const wks = await db.prepare('SELECT id,data FROM workouts WHERE user_id=? AND created_at>=? AND created_at<? ORDER BY id').all(uid, from, to) as { id: number; data: string }[];
    // strength session ≈ 45 min at ~4.5 MET (above resting): a stated assumption, not a measurement
    for (const w of wks) {
      const d = JSON.parse(w.data) as { items?: { exerciseId: string; sets: unknown[] }[] };
      exercise.push({ kind: 'strength', id: w.id, deletable: true, name: 'strength', detail: (d.items ?? []).map((i) => `${i.exerciseId}×${i.sets.length}`).join(', '), kcal: weight ? Math.round((4.5 - 1) * 3.5 * weight / 200 * 45) : null });
    }
    const burnedExercise = exercise.reduce((a, e) => a + (e.kcal ?? 0), 0);
    const resting = target?.explain?.lifeKcal ?? null;
    const expenditure = resting === null ? null : Math.round(resting + burnedExercise);
    const intake = Math.round(sum('kcal'));
    const balance = expenditure === null ? null : intake - expenditure;
    const vsTarget = target ? intake - target.kcal : null;
    // The day's food budget, step by step: basal + daily-life movement + exercise actually logged + the goal's adjustment (e.g. −15 % for fat loss).
    const bmr = target?.explain?.bmr ?? null;
    const neat = target?.explain && bmr !== null ? Math.max(0, target.explain.lifeKcal - bmr) : null;
    const goalAdjustment = target?.explain ? Math.round(target.kcal - target.explain.tdee) : null;
    const budget = target?.explain && bmr !== null ? Math.max(Math.round(bmr), Math.round(target.explain.lifeKcal + burnedExercise + (goalAdjustment ?? 0))) : null;
    const isToday = date === localDay(q.timezoneOffset);
    const frac = isToday ? Math.max(0, Math.min(1, (Date.now() - Date.parse(from)) / 864e5)) : 1;
    const waterLogs = logs.filter((l) => l.waterMl > 0).map((l) => ({ id: l.id, ml: l.waterMl, at: l.at }));
    return {
      date, target, intake: { kcal: intake, proteinG: Math.round(sum('proteinG')), carbsG: Math.round(sum('carbsG')), fatG: Math.round(sum('fatG')), waterMl: Math.round(sum('waterMl')) },
      logs, exercise, burnedExercise, resting, expenditure, balance, vsTarget,
      energy: budget === null ? null : { bmr: Math.round(bmr!), neat: Math.round(neat!), exercise: burnedExercise, goalAdjustment, budget, remaining: budget - intake, dayFraction: Math.round(frac * 1000) / 1000, basalSoFar: Math.round(bmr! * frac), neatSoFar: Math.round(neat! * frac), burnedSoFar: Math.round(bmr! * frac + neat! * frac + burnedExercise) },
      waterLogs,
      estimated: true,
      note: 'Estimated energy balance: resting + daily-life expenditure is a formula, exercise is estimated from MET tables; neither is measured.',
    };
  });

  /** Edit a logged meal by hand (name, kcal, macros, meal type): for corrections when the estimate was wrong. */
  app.patch('/api/nutrition/log/:id', { preHandler: athleteOnly }, async (req, reply) => {
    const b = c.parse(z.object({ meal: z.string().trim().min(1).max(120).optional(), mealType: z.enum(MEAL_TYPES).optional(), kcal: z.number().min(0).max(6000).optional(), proteinG: z.number().min(0).max(500).optional(), carbsG: z.number().min(0).max(900).optional(), fatG: z.number().min(0).max(500).optional() }), req.body, reply);
    if (!b) return;
    const id = Number((req.params as { id: string }).id);
    const row = await db.prepare("SELECT data FROM nutrition WHERE id=? AND user_id=? AND kind='log'").get(id, req.user!.id) as { data: string } | undefined;
    if (!row) return reply.code(404).send({ error: 'not_found' });
    const next = { ...(JSON.parse(row.data) as Record<string, unknown>), ...b, edited: true };
    await db.prepare("UPDATE nutrition SET data=? WHERE id=? AND user_id=? AND kind='log'").run(JSON.stringify(next), id, req.user!.id);
    return { id, ...next };
  });

  /** Clear every food/water entry of a day (e.g. a day logged wrongly). Activity and workouts are untouched. */
  app.delete('/api/nutrition/day', { preHandler: athleteOnly }, async (req, reply) => {
    const q = c.parse(z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), timezoneOffset: tzOffset }), req.query, reply);
    if (!q) return;
    const [from, to] = dayRange(q.date, q.timezoneOffset);
    const r = await db.prepare("DELETE FROM nutrition WHERE user_id=? AND kind='log' AND created_at>=? AND created_at<?").run(req.user!.id, from, to);
    return { ok: true, removed: r.changes };
  });

  app.delete('/api/nutrition/exercise/:id', { preHandler: athleteOnly }, async (req, reply) => {
    const r = await db.prepare("DELETE FROM nutrition WHERE id=? AND user_id=? AND kind='exercise'").run(Number((req.params as { id: string }).id), req.user!.id);
    return r.changes ? { ok: true } : reply.code(404).send({ error: 'not_found' });
  });

  /** A logged strength session (mistaken or duplicated). Plan loads already adapted are not rolled back. */
  app.delete('/api/workouts/:id', { preHandler: athleteOnly }, async (req, reply) => {
    const r = await db.prepare('DELETE FROM workouts WHERE id=? AND user_id=?').run(Number((req.params as { id: string }).id), req.user!.id);
    return r.changes ? { ok: true } : reply.code(404).send({ error: 'not_found' });
  });

  /** Month overview for the calendar: per local day intake vs target, water, sessions and activities. Tap a day → /api/day. */
  app.get('/api/calendar', { preHandler: athleteOnly }, async (req, reply) => {
    const q = c.parse(z.object({ month: z.string().regex(/^\d{4}-\d{2}$/), timezoneOffset: tzOffset }), req.query, reply);
    if (!q) return;
    const uid = req.user!.id;
    const [from] = dayRange(q.month + '-01', q.timezoneOffset);
    const y = Number(q.month.slice(0, 4)), m = Number(q.month.slice(5, 7));
    const nextMonth = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
    const [to] = dayRange(nextMonth + '-01', q.timezoneOffset);
    const dayOf = (iso: string) => localDay(q.timezoneOffset, Date.parse(iso));
    const days: Record<string, { date: string; kcal: number; waterMl: number; meals: number; sessions: number; activities: number }> = {};
    const slot = (iso: string) => (days[dayOf(iso)] ??= { date: dayOf(iso), kcal: 0, waterMl: 0, meals: 0, sessions: 0, activities: 0 });
    for (const r of await db.prepare("SELECT created_at,data FROM nutrition WHERE user_id=? AND kind='log' AND created_at>=? AND created_at<?").all(uid, from, to) as { created_at: string; data: string }[]) {
      const d = JSON.parse(r.data) as { kcal?: number; waterMl?: number }; const x = slot(r.created_at);
      x.kcal += Number(d.kcal) || 0; x.waterMl += Number(d.waterMl) || 0; if (Number(d.kcal) > 0) x.meals++;
    }
    for (const r of await db.prepare('SELECT created_at FROM workouts WHERE user_id=? AND created_at>=? AND created_at<?').all(uid, from, to) as { created_at: string }[]) slot(r.created_at).sessions++;
    for (const r of await db.prepare('SELECT started_at FROM activities WHERE user_id=? AND started_at>=? AND started_at<?').all(uid, from, to) as { started_at: string }[]) slot(r.started_at).activities++;
    const target = await readTarget(uid);
    return { month: q.month, targetKcal: target?.kcal ?? null, days: Object.values(days).map((d) => ({ ...d, kcal: Math.round(d.kcal) })).sort((a, b) => a.date.localeCompare(b.date)) };
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

  /**
   * Free-text meal → items. With the AI configured the model interprets the sentence against our food table (and may propose
   * clearly-labelled custom foods); every number is re-validated here and the totals are computed by the engine, never by the model.
   * Without AI (or on any failure) the deterministic rule parser answers, so this endpoint always works.
   */
  app.post('/api/nutrition/interpret', { preHandler: athleteOnly, config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (req, reply) => {
    const b = c.parse(z.object({ text: z.string().trim().min(1).max(600) }), req.body, reply);
    if (!b) return;
    const rules = () => { const r = parseMeal(b.text); return { source: 'rules' as const, ...shape(r.items.map((i) => ({ raw: i.raw, foodId: i.foodId, grams: i.grams, confidence: i.confidence, spread: i.basis === 'grams' ? 0.1 : i.basis === 'measure' ? 0.25 : i.basis === 'unit' ? 0.2 : 0.35, custom: undefined, note: '' }))) }; };
    if (!c.ai) return rules();
    try {
      const table = FOODS.map((f) => `${f.id}|${f.n[0]}|${f.kcal}`).join('\n');
      const raw = await c.ai(`You turn a meal description (Spanish, Portuguese or English) into JSON for a calorie counter.
Food table (id|name|kcal per 100 g/ml):\n${table}
Reply with ONLY JSON: {"items":[{"raw":"the phrase","foodId":"id from the table or null","grams":number,"confidence":"high|medium|low","note":"short, optional","custom":{"name":"...","kcalPer100":n,"proteinPer100":n,"carbsPer100":n,"fatPer100":n} }]}
Rules: prefer a table foodId. Use "custom" (foodId null) ONLY for foods missing from the table, with typical values. Convert household measures to grams realistically (a cup of cooked rice ≈ 160 g, a tablespoon of oil ≈ 13 g, one egg ≈ 50 g, a slice of bread ≈ 30 g, a restaurant plate of pasta ≈ 250 g cooked). confidence is "high" only when the quantity was explicit in grams/ml, "medium" for counts or measures, "low" when you had to assume a portion. Never add foods that were not mentioned. If the text is not food, return {"items":[]}.`, [{ role: 'user', content: b.text }]);
      const json = JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1)) as { items?: unknown[] };
      const itemSchema = z.object({ raw: z.string().max(200).default(''), foodId: z.string().nullable().optional(), grams: z.number().min(1).max(2000), confidence: z.enum(['high', 'medium', 'low']).default('medium'), note: z.string().max(160).optional(),
        custom: z.object({ name: z.string().trim().min(1).max(60), kcalPer100: z.number().min(0).max(900), proteinPer100: z.number().min(0).max(100), carbsPer100: z.number().min(0).max(100), fatPer100: z.number().min(0).max(100) }).optional() });
      const parsed = (json.items ?? []).slice(0, 15).map((i) => itemSchema.safeParse(i)).filter((r) => r.success).map((r) => r.data!);
      if (!parsed.length && parseMeal(b.text).items.length > 0) return rules();
      const spreadOf = (conf: string) => (conf === 'high' ? 0.1 : conf === 'medium' ? 0.2 : 0.35);
      return { source: 'ai' as const, ...shape(parsed.map((i) => ({ raw: i.raw, foodId: i.foodId && foodById(i.foodId) ? i.foodId : null, grams: Math.round(i.grams), confidence: i.confidence, spread: spreadOf(i.confidence) + (i.custom && !(i.foodId && foodById(i.foodId)) ? 0.1 : 0), custom: i.foodId && foodById(i.foodId) ? undefined : i.custom, note: i.note ?? '' }))) };
    } catch { return { ...rules(), source: 'rules_fallback' as const }; }

    function shape(rows: { raw: string; foodId: string | null | undefined; grams: number; confidence: string; spread: number; custom?: { name: string; kcalPer100: number; proteinPer100: number; carbsPer100: number; fatPer100: number }; note: string }[]) {
      const items = rows.map((r) => {
        const food = r.foodId ? foodById(r.foodId) : undefined;
        if (food) { const m = macrosFor(food, r.grams); return { raw: r.raw, foodId: food.id, name: foodName(food, 'es'), grams: r.grams, kcal: m.kcal, p: m.p, c: m.c, f: m.f, low: Math.round(m.kcal * (1 - r.spread)), high: Math.round(m.kcal * (1 + r.spread)), confidence: r.confidence, custom: null, note: r.note }; }
        if (r.custom) { const k = r.grams / 100; const kcal = Math.round(r.custom.kcalPer100 * k); return { raw: r.raw, foodId: null, name: r.custom.name, grams: r.grams, kcal, p: Math.round(r.custom.proteinPer100 * k * 10) / 10, c: Math.round(r.custom.carbsPer100 * k * 10) / 10, f: Math.round(r.custom.fatPer100 * k * 10) / 10, low: Math.round(kcal * (1 - r.spread)), high: Math.round(kcal * (1 + r.spread)), confidence: r.confidence, custom: r.custom, note: r.note }; }
        return { raw: r.raw, foodId: null, name: r.raw, grams: 0, kcal: 0, p: 0, c: 0, f: 0, low: 0, high: 0, confidence: 'low', custom: null, note: '' };
      });
      const ok = items.filter((i) => i.grams > 0);
      return { items, total: { kcal: ok.reduce((a, i) => a + i.kcal, 0), p: Math.round(ok.reduce((a, i) => a + i.p, 0) * 10) / 10, c: Math.round(ok.reduce((a, i) => a + i.c, 0) * 10) / 10, f: Math.round(ok.reduce((a, i) => a + i.f, 0) * 10) / 10 }, low: ok.reduce((a, i) => a + i.low, 0), high: ok.reduce((a, i) => a + i.high, 0) };
    }
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
