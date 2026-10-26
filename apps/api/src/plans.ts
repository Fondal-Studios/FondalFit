import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { adaptedReturn, adviseDay, materialize, weekStartUtc, resumeShift, routineById, routineWeekDays, type Experience, type Plan } from '@fondal/engine';
import type { RouteCtx } from './admin';

type Guard = (req: FastifyRequest, reply: FastifyReply) => Promise<unknown>;
export interface PlanCtx extends RouteCtx {
  athleteOnly: Guard;
  needHealth: (req: FastifyRequest, reply: FastifyReply) => Promise<boolean>;
  latestPlan: (uid: number) => Promise<{ version: number; data: string; source: string; created_at: string } | undefined>;
  savePlan: (uid: number, plan: Plan, source: string) => Promise<number>;
}

export function registerPlans(c: PlanCtx) {
  const { app, db, athleteOnly } = c;

  const experienceOf = async (uid: number): Promise<Experience> => {
    const r = await db.prepare('SELECT data FROM assessments WHERE user_id=? ORDER BY id DESC LIMIT 1').get(uid) as { data: string } | undefined;
    return (r ? (JSON.parse(r.data) as { experience?: Experience }).experience : undefined) ?? 'intermediate';
  };
  /** Days since the last logged workout or GPS activity (null if nothing logged yet). */
  const lastActivityGap = async (uid: number, since: string) => {
    const w = await db.prepare('SELECT MAX(created_at) AS t FROM workouts WHERE user_id=?').get(uid) as { t: string | null };
    const a = await db.prepare('SELECT MAX(created_at) AS t FROM activities WHERE user_id=?').get(uid) as { t: string | null };
    const last = [w.t, a.t, since].filter(Boolean).sort().pop()!;
    return { last, gapDays: Math.floor((Date.now() - Date.parse(last)) / 864e5) };
  };

  app.get('/api/plan', { preHandler: athleteOnly }, async (req) => {
    const uid = req.user!.id, p = await c.latestPlan(uid);
    if (!p) return { plan: null };
    const stored = JSON.parse(p.data) as Plan;
    const exp = await experienceOf(uid);
    const m = materialize(stored, new Date(), exp);
    const proId = p.source.startsWith('pro:') ? Number(p.source.slice(4)) : 0;
    const pro = proId ? await db.prepare('SELECT name FROM users WHERE id=?').get(proId) as { name: string } | undefined : undefined;
    const rec = await db.prepare('SELECT score,alerts,created_at FROM recovery WHERE user_id=? ORDER BY id DESC LIMIT 1').get(uid) as { score: number; alerts: string; created_at: string } | undefined;
    const fresh = rec && Date.now() - Date.parse(rec.created_at) < 36 * 3600e3;
    const { gapDays } = await lastActivityGap(uid, p.created_at);
    // which sessions of the displayed week are done: strength by day index, cardio by number of GPS activities this week
    const wk = weekStartUtc(new Date()).toISOString();
    const doneStrength = new Set((await db.prepare('SELECT DISTINCT day_index FROM workouts WHERE user_id=? AND created_at>=? AND day_index<99').all(uid, wk) as { day_index: number }[]).map((r) => r.day_index));
    const cardioDone = (await db.prepare('SELECT CAST(COUNT(*) AS INTEGER) c FROM activities WHERE user_id=? AND started_at>=?').get(uid, wk) as { c: number }).c;
    let seenCardio = 0;
    const doneDays = m.days.flatMap((d, i) => (d.kind === 'cardio' ? (seenCardio++ < cardioDone ? [i] : []) : doneStrength.has(i) ? [i] : []));
    const nextIndex = m.days.findIndex((_, i) => !doneDays.includes(i));
    const routineId = stored.program?.routineId ?? (p.source.startsWith('routine:') ? p.source.slice(8) : null);
    return {
      version: p.version, source: p.source, proName: pro?.name ?? null, routineId,
      plan: { ...stored, days: m.days },
      current: { label: m.label, weekIndex: m.weekIndex, weekCount: m.weekCount, ramp: m.ramp },
      advice: fresh ? adviseDay(rec.score, JSON.parse(rec.alerts)) : null,
      away: { gapDays, options: gapDays >= 10 ? adaptedReturn(gapDays) : null },
      week: { doneDays, nextIndex: nextIndex >= 0 ? nextIndex : null },
    };
  });

  /** Adopt a library routine as the current plan: a new plan version, history kept. */
  app.post('/api/plan/adopt', { preHandler: athleteOnly }, async (req, reply) => {
    if (!await c.needHealth(req, reply)) return;
    const b = c.parse(z.object({ routineId: z.string().max(60) }), req.body, reply);
    if (!b) return;
    const r = routineById(b.routineId);
    if (!r) return reply.code(404).send({ error: 'unknown_routine' });
    const startedAt = c.now();
    const days = routineWeekDays(r, 0);
    const plan: Plan = { engineVersion: 'routine', goal: r.goal, days, weeksSinceDeload: 0 };
    if (r.weeks > 1) plan.program = { routineId: r.id, startedAt, weeks: r.program.map((_, i) => routineWeekDays(r, i)) };
    else if (days.some((d) => d.kind === 'strength')) plan.meso = { startedAt };
    const version = await c.savePlan(req.user!.id, plan, `routine:${r.id}`);
    await c.audit(req.user!.id, null, `plan:adopt:${r.id}`);
    return { ok: true, planVersion: version };
  });

  /** After time away: resume where you left off, ramp back gently, or restart the block. */
  app.post('/api/plan/return', { preHandler: athleteOnly }, async (req, reply) => {
    const b = c.parse(z.object({ mode: z.enum(['resume', 'adapted', 'restart']) }), req.body, reply);
    if (!b) return;
    const uid = req.user!.id, p = await c.latestPlan(uid);
    if (!p) return reply.code(409).send({ error: 'no_plan' });
    const plan = JSON.parse(p.data) as Plan;
    const { gapDays } = await lastActivityGap(uid, p.created_at);
    const nowIso = c.now();
    if (b.mode === 'restart') {
      if (plan.meso) plan.meso.startedAt = nowIso;
      if (plan.program) plan.program.startedAt = nowIso;
      delete plan.ramp;
    } else {
      if (plan.meso) plan.meso.startedAt = resumeShift(plan.meso.startedAt, gapDays);
      if (plan.program) plan.program.startedAt = resumeShift(plan.program.startedAt, gapDays);
      const ramp = b.mode === 'adapted' ? adaptedReturn(gapDays) : null;
      if (ramp) plan.ramp = { ...ramp, startedAt: nowIso }; else delete plan.ramp;
    }
    const version = await c.savePlan(uid, plan, `return:${b.mode}`);
    await c.audit(uid, null, `plan:return:${b.mode}`);
    return { ok: true, planVersion: version, gapDays };
  });
}
