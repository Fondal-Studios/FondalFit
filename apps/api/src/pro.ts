import { randomInt } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { byId, DEFAULT_LIMITS, type Plan } from '@fondal/engine';
import type { RouteCtx } from './admin';

type Guard = (req: FastifyRequest, reply: FastifyReply) => Promise<unknown>;
export interface ProCtx extends RouteCtx {
  proOnly: Guard; athleteOnly: Guard;
  hasConsent: (uid: number, scope: string) => Promise<boolean>;
  savePlan: (uid: number, plan: Plan, source: string) => Promise<number>;
}

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I
const newCode = () => Array.from({ length: 8 }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join('');

const itemSchema = z.object({
  exerciseId: z.string().max(60).refine((id) => !!byId(id), 'unknown_exercise'),
  sets: z.number().int().min(1).max(10), repMin: z.number().int().min(1).max(100), repMax: z.number().int().min(1).max(100),
  rirTarget: z.number().min(0).max(10).default(2), restSec: z.number().int().min(0).max(600).optional(), load: z.number().min(0).max(1000).default(0),
}).refine((i) => i.repMax >= i.repMin, 'reps');
const cardioSchema = z.object({
  modality: z.enum(['run', 'bike']), type: z.enum(['zone2', 'intervals', 'tempo', 'long', 'walkrun']), durationMin: z.number().int().min(5).max(360),
  intervals: z.object({ reps: z.number().int().min(1).max(50), workSec: z.number().int().min(10).max(1800), restSec: z.number().int().min(0).max(1800) }).optional(),
});
const daySchema = z.object({ name: z.string().trim().min(1).max(60), kind: z.enum(['strength', 'cardio']).default('strength'), format:z.enum(['standard','superset','circuit']).default('standard'), items: z.array(itemSchema).max(20).default([]), cardio: cardioSchema.optional() })
  .refine((d) => (d.kind === 'cardio' ? !!d.cardio : d.items.length > 0), 'day_content');
export const templateSchema = z.object({ name: z.string().trim().min(1).max(80), goal: z.enum(['hypertrophy', 'strength', 'recomposition', 'fat_loss', 'endurance', 'vo2max', 'general', 'mobility']).default('general'), notes: z.string().max(1000).optional(), days: z.array(daySchema).min(1).max(7) });

export function registerPro(c: ProCtx) {
  const { app, db, proOnly, athleteOnly } = c;

  app.get('/api/pro/code', { preHandler: proOnly }, async (req) => {
    const u = await db.prepare('SELECT pro_code FROM users WHERE id=?').get(req.user!.id) as { pro_code: string | null };
    if (u.pro_code) return { code: u.pro_code };
    for (let i = 0; i < 5; i++) {
      const code = newCode();
      try { await db.prepare('UPDATE users SET pro_code=? WHERE id=?').run(code, req.user!.id); return { code }; } catch { /* collision: retry */ }
    }
    return { code: null };
  });
  app.post('/api/pro/code/rotate', { preHandler: proOnly }, async (req) => {
    const code = newCode();
    await db.prepare('UPDATE users SET pro_code=? WHERE id=?').run(code, req.user!.id);
    await c.audit(req.user!.id, null, 'pro:code_rotate');
    return { code };
  });

  /** The student types the professional's code: consent is the act of entering it, and requires the share_with_pro permission. */
  app.post('/api/links/join-code', { preHandler: athleteOnly, config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req, reply) => {
    const b = c.parse(z.object({ code: z.string().trim().toUpperCase().regex(/^[A-Z0-9]{6,12}$/) }), req.body, reply);
    if (!b) return;
    if (!await c.hasConsent(req.user!.id, 'share_with_pro')) return reply.code(403).send({ error: 'consent_required', scope: 'share_with_pro' });
    const pro = await db.prepare('SELECT id,name FROM users WHERE pro_code=? AND id<>?').get(b.code, req.user!.id) as { id: number; name: string } | undefined;
    if (!pro) return reply.code(404).send({ error: 'invalid_code' });
    await db.prepare("INSERT INTO links(pro_id,athlete_id,status,limits,created_at) VALUES(?,?,'active',?,?) ON CONFLICT(pro_id,athlete_id) DO UPDATE SET status='active'")
      .run(pro.id, req.user!.id, JSON.stringify(DEFAULT_LIMITS), c.now());
    await c.audit(req.user!.id, pro.id, 'link:join_code');
    return { ok: true, proName: pro.name };
  });

  app.get('/api/pro/templates', { preHandler: proOnly }, async (req) =>
    (await db.prepare('SELECT id,name,data,created_at FROM pro_templates WHERE pro_id=? ORDER BY id DESC').all(req.user!.id) as { id: number; name: string; data: string; created_at: string }[])
      .map((r) => ({ id: r.id, name: r.name, createdAt: r.created_at, ...JSON.parse(r.data) })));

  app.post('/api/pro/templates', { preHandler: proOnly }, async (req, reply) => {
    const b = c.parse(templateSchema, req.body, reply);
    if (!b) return;
    const n = (await db.prepare('SELECT CAST(COUNT(*) AS INTEGER) c FROM pro_templates WHERE pro_id=?').get(req.user!.id) as { c: number }).c;
    if (n >= 200) return reply.code(409).send({ error: 'limit' });
    const r = await db.prepare('INSERT INTO pro_templates(pro_id,name,data,created_at) VALUES(?,?,?,?) RETURNING id').get(req.user!.id, b.name, JSON.stringify(b), c.now()) as { id: number };
    return { id: r.id };
  });
  app.put('/api/pro/templates/:id', { preHandler: proOnly }, async (req, reply) => {
    const b = c.parse(templateSchema, req.body, reply);
    if (!b) return;
    const r = await db.prepare('UPDATE pro_templates SET name=?, data=? WHERE id=? AND pro_id=?').run(b.name, JSON.stringify(b), Number((req.params as { id: string }).id), req.user!.id);
    return r.changes ? { ok: true } : reply.code(404).send({ error: 'not_found' });
  });
  app.delete('/api/pro/templates/:id', { preHandler: proOnly }, async (req, reply) => {
    const r = await db.prepare('DELETE FROM pro_templates WHERE id=? AND pro_id=?').run(Number((req.params as { id: string }).id), req.user!.id);
    return r.changes ? { ok: true } : reply.code(404).send({ error: 'not_found' });
  });

  /** Assign a routine to a linked student: becomes their current plan (a new version, history kept). */
  app.post('/api/pro/templates/:id/assign', { preHandler: proOnly }, async (req, reply) => {
    const b = c.parse(z.object({ athleteId: z.number().int() }), req.body, reply);
    if (!b) return;
    const link = await db.prepare("SELECT id FROM links WHERE pro_id=? AND athlete_id=? AND status='active'").get(req.user!.id, b.athleteId);
    if (!link) return reply.code(404).send({ error: 'not_found' });
    const t = await db.prepare('SELECT data FROM pro_templates WHERE id=? AND pro_id=?').get(Number((req.params as { id: string }).id), req.user!.id) as { data: string } | undefined;
    if (!t) return reply.code(404).send({ error: 'not_found' });
    const tpl = templateSchema.parse(JSON.parse(t.data));
    const plan: Plan = {
      engineVersion: 'pro-template', goal: tpl.goal, weeksSinceDeload: 0,
      days: tpl.days.map((d) => ({ name: d.name, kind: d.kind, format:d.format, items: d.items.map((i) => ({ ...i })), cardio: d.cardio })),
    };
    const version = await c.savePlan(b.athleteId, plan, `pro:${req.user!.id}`);
    await c.audit(req.user!.id, b.athleteId, 'template:assign');
    return { ok: true, planVersion: version };
  });

  /** What the student actually did, for the professional: sessions with their best sets, activities and recovery. */
  app.get('/api/pro/athletes/:id/training-feedback', { preHandler: proOnly }, async (req, reply) => {
    const aid = Number((req.params as { id: string }).id);
    const link = await db.prepare("SELECT id FROM links WHERE pro_id=? AND athlete_id=? AND status='active'").get(req.user!.id, aid);
    if (!link) return reply.code(404).send({ error: 'not_found' });
    await c.audit(req.user!.id, aid, 'view:feedback');
    const ws = (await db.prepare('SELECT day_index,data,created_at FROM workouts WHERE user_id=? ORDER BY id DESC LIMIT 15').all(aid) as { day_index: number; data: string; created_at: string }[]).map((w) => {
      const d = JSON.parse(w.data) as { fatigue?: number; items: { exerciseId: string; sets: { weight: number; reps: number; rir: number }[] }[] };
      return { date: w.created_at, dayIndex: w.day_index, fatigue: d.fatigue ?? null, exercises: d.items.map((i) => ({ exerciseId: i.exerciseId, sets: i.sets.length, best: i.sets.reduce((b, s) => (s.weight * s.reps > b.weight * b.reps ? s : b), i.sets[0]!) })) };
    });
    const acts = await db.prepare('SELECT sport,started_at,duration_sec,distance_m,avg_pace_sec_km FROM activities WHERE user_id=? ORDER BY id DESC LIMIT 10').all(aid);
    const rec = (await db.prepare('SELECT score,alerts,created_at FROM recovery WHERE user_id=? ORDER BY id DESC LIMIT 7').all(aid) as { score: number; alerts: string; created_at: string }[]).map((r) => ({ score: r.score, alerts: JSON.parse(r.alerts), at: r.created_at }));
    return { workouts: ws, activities: acts, recovery: rec };
  });
}
