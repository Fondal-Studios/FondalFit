import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify';
import rateLimit from '@fastify/rate-limit';
import { z } from 'zod';
import { randomBytes, scryptSync, timingSafeEqual, createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import fastifyStatic from '@fastify/static';
import {
  gamification, paceMinPerKm, runningLoadAlert, checkAutonomy, DEFAULT_LIMITS, generatePlan, needsDeload, nextLoad, nutritionTarget, recoveryScore, screenSafety, seedLoad,
  type AssessmentInput, type AutonomyLimits, type Plan,
} from '@fondal/engine';
import type { DB } from './db';

const now = () => new Date().toISOString();
const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const TRIAL_DAYS = 14;
export const CONSENT_SCOPES = ['terms', 'health_data', 'share_with_pro', 'ai_memory', 'camera_video'] as const;

interface User { id: number; email: string; name: string; role: 'athlete' | 'pro' | 'admin'; lang: string; trial_ends_at: string; plan: string; canceled_at: string | null }
declare module 'fastify' { interface FastifyRequest { user?: User } }

const limitsSchema = z.object({
  maxLoadIncreasePct: z.number().min(0).max(25),
  maxWeeklyVolumeDeltaPct: z.number().min(0).max(50),
  maxSessionsPerWeek: z.number().int().min(1).max(7),
  allowAutoDeload: z.boolean(),
});
const assessmentSchema = z.object({
  goal: z.enum(['strength', 'hypertrophy', 'endurance', 'fat_loss', 'mobility', 'general', 'hybrid']),
  secondaryGoals: z.array(z.enum(['strength', 'hypertrophy', 'endurance', 'fat_loss', 'mobility', 'general', 'hybrid'])).max(3).optional(),
  targetDescription: z.string().trim().max(200).optional(),
  targetDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  sessionMinutes: z.number().int().min(20).max(120).optional(),
  preferredActivities: z.array(z.enum(['strength', 'running', 'mobility'])).optional(),
  daysPerWeek: z.number().int().min(1).max(6),
  experience: z.enum(['beginner', 'intermediate', 'advanced']),
  equipment: z.array(z.enum(['none', 'dumbbells', 'barbell', 'machines', 'bands', 'bar'])),
  restrictions: z.array(z.enum(['knee', 'shoulder', 'lower_back', 'hip', 'ankle', 'wrist', 'neck'])),
  redFlags: z.object({ chestPain: z.boolean(), dizziness: z.boolean(), recentSurgery: z.boolean(), pregnancy: z.boolean(), medication: z.boolean() }),
});

export function buildApp(opts: { db: DB; rateLimitMax?: number; staticDir?: string }) {
  const db = opts.db;
  const app = Fastify({ logger: false, trustProxy: true });
  app.register(rateLimit, { max: opts.rateLimitMax ?? 300, timeWindow: '1 minute' });

  const audit = async (actor: number | null, subject: number | null, action: string) =>
    db.prepare('INSERT INTO audit(actor_id,subject_id,action,created_at) VALUES(?,?,?,?)').run(actor, subject, action, now());

  const hasConsent = async (uid: number, scope: string) =>
    !!(await db.prepare('SELECT granted FROM consents WHERE user_id=? AND scope=?').get(uid, scope) as { granted: number } | undefined)?.granted;

  const subscriptionActive = (u: User) => {
    if (u.canceled_at && u.plan === 'trial') return new Date(u.trial_ends_at) > new Date();
    if (u.plan === 'trial') return new Date(u.trial_ends_at) > new Date();
    return !u.canceled_at;
  };

  async function auth(req: FastifyRequest, reply: FastifyReply) {
    const h = req.headers.authorization?.replace(/^Bearer /, '');
    const row = h && (await db.prepare('SELECT u.* FROM tokens t JOIN users u ON u.id=t.user_id WHERE t.token_hash=? AND t.expires_at>?').get(sha(h), now()) as unknown as User | undefined);
    if (!row) return reply.code(401).send({ error: 'unauthorized' });
    req.user = row;
  }
  const requireRole = (role: 'athlete' | 'pro') => async (req: FastifyRequest, reply: FastifyReply) => {
    await auth(req, reply);
    if (reply.sent) return;
    if (req.user!.role !== role && req.user!.role !== 'admin') return reply.code(403).send({ error: 'forbidden' });
    if (!subscriptionActive(req.user!)) return reply.code(402).send({ error: 'subscription_required' });
  };
  const athleteOnly = requireRole('athlete');
  const proOnly = requireRole('pro');

  const parse = <T extends z.ZodTypeAny>(s: T, body: unknown, reply: FastifyReply): z.infer<T> | undefined => {
    const r = s.safeParse(body);
    if (!r.success) { reply.code(400).send({ error: 'invalid', issues: r.error.issues }); return undefined; }
    return r.data;
  };

  const newToken = async (uid: number) => {
    const token = randomBytes(32).toString('hex');
    await db.prepare('INSERT INTO tokens VALUES(?,?,?)').run(sha(token), uid, new Date(Date.now() + 30 * 864e5).toISOString());
    return token;
  };

  /* ---------------- Auth ---------------- */
  app.post('/api/auth/register', { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (req, reply) => {
    const b = parse(z.object({ email: z.string().email(), password: z.string().min(8), name: z.string().min(1), role: z.enum(['athlete', 'pro']), lang: z.enum(['es', 'pt', 'en']).default('es') }), req.body, reply);
    if (!b) return;
    const salt = randomBytes(16).toString('hex');
    const hash = scryptSync(b.password, salt, 64).toString('hex');
    const trial = new Date(Date.now() + TRIAL_DAYS * 864e5).toISOString();
    try {
      const r = await db.prepare('INSERT INTO users(email,name,role,lang,pass_hash,salt,created_at,trial_ends_at) VALUES(?,?,?,?,?,?,?,?) RETURNING id').get(b.email.toLowerCase(), b.name, b.role, b.lang, hash, salt, now(), trial) as { id: number };
      await audit(r.id, null, 'register');
      return { token: await newToken(r.id) };
    } catch { return reply.code(409).send({ error: 'email_taken' }); }
  });

  app.post('/api/auth/login', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req, reply) => {
    const b = parse(z.object({ email: z.string().email(), password: z.string() }), req.body, reply);
    if (!b) return;
    const u = await db.prepare('SELECT * FROM users WHERE email=?').get(b.email.toLowerCase()) as { id: number; pass_hash: string; salt: string } | undefined;
    const ok = u && timingSafeEqual(Buffer.from(scryptSync(b.password, u.salt, 64).toString('hex')), Buffer.from(u.pass_hash));
    if (!u || !ok) return reply.code(401).send({ error: 'invalid_credentials' });
    return { token: await newToken(u.id) };
  });

  app.get('/api/me', { preHandler: auth }, async (req) => {
    const u = req.user!;
    return { id: u.id, email: u.email, name: u.name, role: u.role, lang: u.lang, subscription: { plan: u.plan, trialEndsAt: u.trial_ends_at, active: subscriptionActive(u), canceled: !!u.canceled_at }, consents: await consentsOf(u.id) };
  });
  const consentsOf = async (uid: number) => Object.fromEntries((await db.prepare('SELECT scope,granted FROM consents WHERE user_id=?').all(uid) as { scope: string; granted: number }[]).map((r) => [r.scope, !!r.granted]));

  app.patch('/api/me', { preHandler: auth }, async (req, reply) => {
    const b = parse(z.object({ lang: z.enum(['es', 'pt', 'en']).optional(), name: z.string().min(1).optional() }), req.body, reply);
    if (!b) return;
    if (b.lang) await db.prepare('UPDATE users SET lang=? WHERE id=?').run(b.lang, req.user!.id);
    if (b.name) await db.prepare('UPDATE users SET name=? WHERE id=?').run(b.name, req.user!.id);
    return { ok: true };
  });

  /* ---------------- Consents (granular, revocable) ---------------- */
  app.put('/api/consents', { preHandler: auth }, async (req, reply) => {
    const b = parse(z.record(z.enum(CONSENT_SCOPES), z.boolean()), req.body, reply);
    if (!b) return;
    for (const [scope, granted] of Object.entries(b)) {
      await db.prepare('INSERT INTO consents VALUES(?,?,?,?) ON CONFLICT(user_id,scope) DO UPDATE SET granted=excluded.granted, updated_at=excluded.updated_at').run(req.user!.id, scope, granted ? 1 : 0, now());
      await audit(req.user!.id, req.user!.id, `consent:${scope}:${granted}`);
      // revoking pro sharing revokes all active pro links immediately
      if (scope === 'share_with_pro' && !granted) await db.prepare("UPDATE links SET status='revoked' WHERE athlete_id=? AND status IN ('active','pending')").run(req.user!.id);
    }
    return await consentsOf(req.user!.id);
  });

  const needHealth = async (req: FastifyRequest, reply: FastifyReply) => {
    if (!await hasConsent(req.user!.id, 'health_data')) { reply.code(403).send({ error: 'consent_required', scope: 'health_data' }); return false; }
    return true;
  };

  /* ---------------- Assessment & plan ---------------- */
  const latestPlan = async (uid: number) => await db.prepare('SELECT * FROM plans WHERE user_id=? ORDER BY version DESC LIMIT 1').get(uid) as { version: number; data: string; source: string } | undefined;
  const savePlan = async (uid: number, plan: Plan, source: string) => {
    const v = ((await latestPlan(uid))?.version ?? 0) + 1;
    await db.prepare('INSERT INTO plans(user_id,version,data,source,created_at) VALUES(?,?,?,?,?)').run(uid, v, JSON.stringify(plan), source, now());
    return v;
  };

  app.post('/api/assessment', { preHandler: athleteOnly }, async (req, reply) => {
    if (!await needHealth(req, reply)) return;
    const b = parse(assessmentSchema, req.body, reply);
    if (!b) return;
    await db.prepare('INSERT INTO assessments(user_id,data,created_at) VALUES(?,?,?)').run(req.user!.id, JSON.stringify(b), now());
    const safety = screenSafety(b as AssessmentInput);
    if (safety.status === 'refer') { await audit(req.user!.id, req.user!.id, 'assessment:referral'); return { referral: true, reasons: safety.reasons }; }
    const plan = generatePlan(b as AssessmentInput);
    const version = await savePlan(req.user!.id, plan, 'engine');
    return { referral: false, planVersion: version, plan };
  });

  app.get('/api/plan', { preHandler: athleteOnly }, async (req) => {
    const p = await latestPlan(req.user!.id);
    const last = await db.prepare('SELECT COUNT(*) AS n FROM workouts WHERE user_id=?').get(req.user!.id) as { n: number };
    const plan = p ? JSON.parse(p.data) as Plan : null;
    return p ? { version: p.version, source: p.source, plan, recommendedDay: plan && plan.days.length ? Number(last.n) % plan.days.length : 0 } : { plan: null, recommendedDay: 0 };
  });

  /* ---------------- Sessions & adaptation ---------------- */
  const activeLink = async (athleteId: number) =>
    await db.prepare("SELECT * FROM links WHERE athlete_id=? AND status='active'").get(athleteId) as { id: number; pro_id: number; limits: string } | undefined;

  app.post('/api/workouts', { preHandler: athleteOnly }, async (req, reply) => {
    if (!await needHealth(req, reply)) return;
    const b = parse(z.object({
      dayIndex: z.number().int().min(0).max(5),
      fatigue: z.number().min(1).max(10).default(5),
      items: z.array(z.object({ exerciseId: z.string(), sets: z.array(z.object({ weight: z.number().min(0).max(1000), reps: z.number().int().min(0).max(200), rir: z.number().min(0).max(10) })).min(1) })).min(1),
    }), req.body, reply);
    if (!b) return;
    const uid = req.user!.id;
    const cur = await latestPlan(uid);
    if (!cur) return reply.code(409).send({ error: 'no_plan' });
    await db.prepare('INSERT INTO workouts(user_id,day_index,data,created_at) VALUES(?,?,?,?)').run(uid, b.dayIndex, JSON.stringify(b), now());

    const plan = JSON.parse(cur.data) as Plan;
    const day = plan.days[b.dayIndex];
    if (!day) return reply.code(400).send({ error: 'invalid_day' });
    const next: Plan = structuredClone(plan);
    let maxIncPct = 0;
    const decisions: Record<string, string> = {};
    for (const it of b.items) {
      const idx = day.items.findIndex((x) => x.exerciseId === it.exerciseId);
      if (idx < 0) continue;
      const p = day.items[idx]!;
      let load = p.load;
      if (p.load === 0) { load = seedLoad(it.sets[0]!, p); decisions[it.exerciseId] = load ? 'seed' : 'hold'; }
      else {
        const d = nextLoad(p, it.sets);
        load = d.load; decisions[it.exerciseId] = d.action;
        if (d.action === 'increase') maxIncPct = Math.max(maxIncPct, ((d.load - p.load) / p.load) * 100);
      }
      next.days[b.dayIndex]!.items[idx]!.load = load;
    }
    const weeks = plan.weeksSinceDeload + (b.dayIndex === plan.days.length - 1 ? 1 : 0);
    next.weeksSinceDeload = weeks;
    const link = await activeLink(uid);
    const limits: AutonomyLimits = link ? JSON.parse(link.limits) : DEFAULT_LIMITS;
    const deload = needsDeload(weeks, b.fatigue, link ? limits : undefined);
    const change = { loadIncreasePct: Math.round(maxIncPct * 10) / 10, weeklyVolumeDeltaPct: 0, sessionsPerWeek: plan.days.length };
    const verdict = checkAutonomy(limits, change);
    if (!verdict.allowed && link) {
      const r = await db.prepare("INSERT INTO approvals(link_id,athlete_id,change,violations,proposed_plan,status,created_at) VALUES(?,?,?,?,?,'pending',?) RETURNING id").get(link.id, uid, JSON.stringify(change), JSON.stringify(verdict.violations), JSON.stringify(next), now()) as { id: number };
      await audit(uid, link.pro_id, 'approval:requested');
      return { applied: false, approvalId: r.id, violations: verdict.violations, decisions, deloadSuggested: deload };
    }
    // Without a professional the engine's own safe defaults apply (increments are already small).
    const version = await savePlan(uid, next, 'engine:auto');
    return { applied: true, planVersion: version, decisions, deloadSuggested: deload };
  });

  app.get('/api/progress', { preHandler: athleteOnly }, async (req) => {
    const rows = await db.prepare('SELECT day_index,data,created_at FROM workouts WHERE user_id=? ORDER BY id').all(req.user!.id) as { day_index: number; data: string; created_at: string }[];
    const sessions = rows.map((r) => {
      const d = JSON.parse(r.data) as { items: { exerciseId: string; sets: { weight: number; reps: number }[] }[] };
      return { date: r.created_at, dayIndex: r.day_index, volume: d.items.reduce((a, i) => a + i.sets.reduce((s, x) => s + x.weight * x.reps, 0), 0), sets: d.items.reduce((a, i) => a + i.sets.length, 0) };
    });
    const exercises: Record<string, { date: string; weight: number; reps: number; estimated1RM: number }[]> = {};
    rows.forEach((r) => {
      const workout = JSON.parse(r.data) as { items: { exerciseId: string; sets: { weight: number; reps: number }[] }[] };
      for (const item of workout.items) {
        if (!exercises[item.exerciseId]) exercises[item.exerciseId] = [];
        const best = item.sets.reduce((max, set) => Math.max(max, set.weight > 0 && set.reps > 0 ? set.weight * (1 + Math.min(set.reps, 15) / 30) : 0), 0);
        if (best > 0) {
          const peak = item.sets.reduce((max, set) => set.weight * (1 + Math.min(set.reps, 15) / 30) >= max.weight * (1 + Math.min(max.reps, 15) / 30) ? set : max, { weight: 0, reps: 0 });
          exercises[item.exerciseId]!.push({ date: r.created_at, weight: peak.weight, reps: peak.reps, estimated1RM: Math.round(best * 10) / 10 });
        }
      }
    });
    const latestAssessment = await db.prepare('SELECT data FROM assessments WHERE user_id=? ORDER BY id DESC LIMIT 1').get(req.user!.id) as { data: string } | undefined;
    return { sessions, total: sessions.length, exercises, goal: latestAssessment ? JSON.parse(latestAssessment.data) : null };
  });

  /* ---------------- Nutrition ---------------- */
  app.post('/api/nutrition/target', { preHandler: athleteOnly }, async (req, reply) => {
    if (!await needHealth(req, reply)) return;
    const b = parse(z.object({ sex: z.enum(['f', 'm']), weightKg: z.number().min(30).max(300), heightCm: z.number().min(120).max(230), age: z.number().int().min(16).max(90), activity: z.union([z.literal(1.2), z.literal(1.375), z.literal(1.55), z.literal(1.725)]), goal: z.enum(['strength', 'hypertrophy', 'endurance', 'fat_loss', 'mobility', 'general']), allergies: z.array(z.string()).default([]) }), req.body, reply);
    if (!b) return;
    const { allergies, ...input } = b;
    const t = nutritionTarget(input);
    await db.prepare("INSERT INTO nutrition(user_id,kind,data,created_at) VALUES(?,'target',?,?)").run(req.user!.id, JSON.stringify({ ...t, allergies }), now());
    return t;
  });
  app.post('/api/nutrition/log', { preHandler: athleteOnly }, async (req, reply) => {
    if (!await needHealth(req, reply)) return;
    const b = parse(z.object({ meal: z.string().min(1), kcal: z.number().min(0).max(5000), proteinG: z.number().min(0).max(500), carbsG: z.number().min(0).max(1000), fatG: z.number().min(0).max(500), waterMl: z.number().min(0).max(10000).default(0) }), req.body, reply);
    if (!b) return;
    await db.prepare("INSERT INTO nutrition(user_id,kind,data,created_at) VALUES(?,'log',?,?)").run(req.user!.id, JSON.stringify(b), now());
    return { ok: true };
  });
  app.get('/api/nutrition', { preHandler: athleteOnly }, async (req) => {
    const rows = await db.prepare('SELECT kind,data,created_at FROM nutrition WHERE user_id=? ORDER BY id DESC').all(req.user!.id) as { kind: string; data: string; created_at: string }[];
    const target = rows.find((r) => r.kind === 'target');
    const today = now().slice(0, 10);
    const logs = rows.filter((r) => r.kind === 'log').map((r) => ({ ...JSON.parse(r.data), at: r.created_at }));
    const todayLogs = logs.filter((l) => l.at.startsWith(today));
    const sum = (k: string) => todayLogs.reduce((a, l) => a + (l[k] ?? 0), 0);
    return { target: target ? JSON.parse(target.data) : null, logs, today: { kcal: sum('kcal'), proteinG: sum('proteinG'), carbsG: sum('carbsG'), fatG: sum('fatG'), waterMl: sum('waterMl') } };
  });

  /* ---------------- Recovery ---------------- */
  app.post('/api/recovery', { preHandler: athleteOnly }, async (req, reply) => {
    if (!await needHealth(req, reply)) return;
    const b = parse(z.object({ sleepHours: z.number().min(0).max(24), fatigue: z.number().min(1).max(10), stress: z.number().min(1).max(10), pain: z.number().min(0).max(10) }), req.body, reply);
    if (!b) return;
    const r = recoveryScore(b);
    await db.prepare('INSERT INTO recovery(user_id,data,score,alerts,created_at) VALUES(?,?,?,?,?)').run(req.user!.id, JSON.stringify(b), r.score, JSON.stringify(r.alerts), now());
    return r;
  });
  app.get('/api/recovery', { preHandler: athleteOnly }, async (req) =>
    (await db.prepare('SELECT data,score,alerts,created_at FROM recovery WHERE user_id=? ORDER BY id DESC LIMIT 30').all(req.user!.id) as { data: string; score: number; alerts: string; created_at: string }[])
      .map((r) => ({ ...JSON.parse(r.data), score: r.score, alerts: JSON.parse(r.alerts), at: r.created_at })));

  /* ---------------- Running ---------------- */
  const weekStart = (offsetWeeks: number) => { const d = new Date(); d.setUTCHours(0, 0, 0, 0); d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7) - 7 * offsetWeeks); return d.toISOString(); };
  const kmBetween = async (uid: number, from: string, to: string) => (await db.prepare('SELECT CAST(COALESCE(SUM(km),0) AS DOUBLE PRECISION) k FROM runs WHERE user_id=? AND created_at>=? AND created_at<?').get(uid, from, to) as { k: number }).k;
  app.post('/api/runs', { preHandler: athleteOnly }, async (req, reply) => {
    if (!await needHealth(req, reply)) return;
    const b = parse(z.object({ km: z.number().min(0.1).max(250), minutes: z.number().min(1).max(2000), rpe: z.number().min(1).max(10) }), req.body, reply);
    if (!b) return;
    await db.prepare('INSERT INTO runs(user_id,km,minutes,rpe,created_at) VALUES(?,?,?,?,?)').run(req.user!.id, b.km, b.minutes, b.rpe, now());
    return { pace: paceMinPerKm(b.km, b.minutes) };
  });
  app.get('/api/runs', { preHandler: athleteOnly }, async (req) => {
    const uid = req.user!.id;
    const runs = (await db.prepare('SELECT km,minutes,rpe,created_at FROM runs WHERE user_id=? ORDER BY id DESC LIMIT 30').all(uid) as { km: number; minutes: number; rpe: number; created_at: string }[]).map((r) => ({ ...r, pace: paceMinPerKm(r.km, r.minutes) }));
    const thisWeek = await kmBetween(uid, weekStart(0), '9999'), prev = await kmBetween(uid, weekStart(1), weekStart(0));
    return { runs, weekKm: Math.round(thisWeek * 10) / 10, prevWeekKm: Math.round(prev * 10) / 10, alerts: runningLoadAlert(prev, thisWeek) };
  });

  /* ---------------- Gamification ---------------- */
  app.get('/api/gamification', { preHandler: athleteOnly }, async (req) => {
    const uid = req.user!.id;
    const byDay = new Map<string, { date: string; sessions: number; runs: number }>();
    const bump = (d: string, k: 'sessions' | 'runs') => { const day = d.slice(0, 10); const e = byDay.get(day) ?? { date: day, sessions: 0, runs: 0 }; e[k]++; byDay.set(day, e); };
    for (const r of await db.prepare('SELECT created_at FROM workouts WHERE user_id=?').all(uid) as { created_at: string }[]) bump(r.created_at, 'sessions');
    for (const r of await db.prepare('SELECT created_at FROM runs WHERE user_id=?').all(uid) as { created_at: string }[]) bump(r.created_at, 'runs');
    const rec = (await db.prepare('SELECT CAST(COUNT(*) AS INTEGER) c FROM recovery WHERE user_id=?').get(uid) as { c: number }).c;
    return gamification([...byDay.values()], rec);
  });

  /* ---------------- Professional links ---------------- */
  app.post('/api/pro/invites', { preHandler: proOnly }, async (req, reply) => {
    const b = parse(z.object({ email: z.string().email(), limits: limitsSchema.optional() }), req.body, reply);
    if (!b) return;
    const a = await db.prepare("SELECT id FROM users WHERE email=? AND role='athlete'").get(b.email.toLowerCase()) as { id: number } | undefined;
    // Identical response whether or not the athlete exists: no account enumeration.
    if (a) {
      await db.prepare("INSERT INTO links(pro_id,athlete_id,status,limits,created_at) VALUES(?,?,'pending',?,?) ON CONFLICT(pro_id,athlete_id) DO UPDATE SET status=CASE WHEN links.status='revoked' THEN 'pending' ELSE links.status END")
        .run(req.user!.id, a.id, JSON.stringify(b.limits ?? DEFAULT_LIMITS), now());
      await audit(req.user!.id, a.id, 'invite');
    }
    return { ok: true };
  });

  app.get('/api/links', { preHandler: athleteOnly }, async (req) =>
    await db.prepare('SELECT l.id,l.status,u.name AS "proName" FROM links l JOIN users u ON u.id=l.pro_id WHERE l.athlete_id=? ORDER BY l.id DESC').all(req.user!.id));

  app.post('/api/links/:id/accept', { preHandler: athleteOnly }, async (req, reply) => {
    if (!await hasConsent(req.user!.id, 'share_with_pro')) return reply.code(403).send({ error: 'consent_required', scope: 'share_with_pro' });
    const r = await db.prepare("UPDATE links SET status='active' WHERE id=? AND athlete_id=? AND status='pending'").run(Number((req.params as { id: string }).id), req.user!.id);
    if (!r.changes) return reply.code(404).send({ error: 'not_found' });
    await audit(req.user!.id, req.user!.id, 'link:accept');
    return { ok: true };
  });
  app.post('/api/links/:id/revoke', { preHandler: auth }, async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    const r = await db.prepare("UPDATE links SET status='revoked' WHERE id=? AND (athlete_id=? OR pro_id=?)").run(id, req.user!.id, req.user!.id);
    if (!r.changes) return reply.code(404).send({ error: 'not_found' });
    await audit(req.user!.id, null, 'link:revoke');
    return { ok: true };
  });

  const proLink = async (req: FastifyRequest, athleteId: number) =>
    await db.prepare("SELECT * FROM links WHERE pro_id=? AND athlete_id=? AND status='active'").get(req.user!.id, athleteId) as { id: number; limits: string } | undefined;

  app.get('/api/pro/athletes', { preHandler: proOnly }, async (req) => {
    const rows = await db.prepare("SELECT l.id AS \"linkId\",l.limits,u.id,u.name,u.email FROM links l JOIN users u ON u.id=l.athlete_id WHERE l.pro_id=? AND l.status='active'").all(req.user!.id) as { linkId: number; limits: string; id: number; name: string; email: string }[];
    return Promise.all(rows.map(async (r) => {
      const last = await db.prepare('SELECT created_at FROM workouts WHERE user_id=? ORDER BY id DESC LIMIT 1').get(r.id) as { created_at: string } | undefined;
      const rec = await db.prepare('SELECT score,alerts FROM recovery WHERE user_id=? ORDER BY id DESC LIMIT 1').get(r.id) as { score: number; alerts: string } | undefined;
      const sessions30 = (await db.prepare("SELECT CAST(COUNT(*) AS INTEGER) c FROM workouts WHERE user_id=? AND created_at>?").get(r.id, new Date(Date.now() - 30 * 864e5).toISOString()) as { c: number }).c;
      const pending = (await db.prepare("SELECT CAST(COUNT(*) AS INTEGER) c FROM approvals WHERE athlete_id=? AND link_id=? AND status='pending'").get(r.id, r.linkId) as { c: number }).c;
      return { linkId: r.linkId, id: r.id, name: r.name, email: r.email, limits: JSON.parse(r.limits), lastSession: last?.created_at ?? null, sessions30, recovery: rec ? { score: rec.score, alerts: JSON.parse(rec.alerts) } : null, pendingApprovals: pending };
    }));
  });

  app.put('/api/pro/athletes/:id/limits', { preHandler: proOnly }, async (req, reply) => {
    const l = await proLink(req, Number((req.params as { id: string }).id));
    if (!l) return reply.code(404).send({ error: 'not_found' });
    const b = parse(limitsSchema, req.body, reply);
    if (!b) return;
    await db.prepare('UPDATE links SET limits=? WHERE id=?').run(JSON.stringify(b), l.id);
    await audit(req.user!.id, Number((req.params as { id: string }).id), 'limits:update');
    return b;
  });

  app.get('/api/pro/athletes/:id/summary', { preHandler: proOnly }, async (req, reply) => {
    const aid = Number((req.params as { id: string }).id);
    if (!await proLink(req, aid)) return reply.code(404).send({ error: 'not_found' });
    await audit(req.user!.id, aid, 'view:summary');
    const p = await latestPlan(aid);
    const assessment = await db.prepare('SELECT data FROM assessments WHERE user_id=? ORDER BY id DESC LIMIT 1').get(aid) as { data: string } | undefined;
    const workouts = await db.prepare('SELECT day_index,created_at FROM workouts WHERE user_id=? ORDER BY id DESC LIMIT 20').all(aid);
    return { plan: p ? JSON.parse(p.data) : null, assessment: assessment ? JSON.parse(assessment.data) : null, workouts };
  });

  app.get('/api/pro/approvals', { preHandler: proOnly }, async (req) =>
    (await db.prepare("SELECT a.id,a.athlete_id,u.name AS \"athleteName\",a.change,a.violations,a.status,a.created_at FROM approvals a JOIN links l ON l.id=a.link_id JOIN users u ON u.id=a.athlete_id WHERE l.pro_id=? AND l.status='active' ORDER BY a.id DESC").all(req.user!.id) as Record<string, string>[])
      .map((r) => ({ ...r, change: JSON.parse(r.change!), violations: JSON.parse(r.violations!) })));

  app.post('/api/pro/approvals/:id/decide', { preHandler: proOnly }, async (req, reply) => {
    const b = parse(z.object({ approve: z.boolean() }), req.body, reply);
    if (!b) return;
    const a = await db.prepare("SELECT a.* FROM approvals a JOIN links l ON l.id=a.link_id WHERE a.id=? AND l.pro_id=? AND l.status='active' AND a.status='pending'").get(Number((req.params as { id: string }).id), req.user!.id) as { id: number; athlete_id: number; proposed_plan: string } | undefined;
    if (!a) return reply.code(404).send({ error: 'not_found' });
    await db.prepare('UPDATE approvals SET status=? WHERE id=?').run(b.approve ? 'approved' : 'rejected', a.id);
    if (b.approve) await savePlan(a.athlete_id, JSON.parse(a.proposed_plan), `pro:${req.user!.id}`);
    await audit(req.user!.id, a.athlete_id, `approval:${b.approve ? 'approved' : 'rejected'}`);
    return { ok: true };
  });

  /* ---------------- Subscription ---------------- */
  app.post('/api/subscription/cancel', { preHandler: auth }, async (req) => {
    await db.prepare('UPDATE users SET canceled_at=? WHERE id=?').run(now(), req.user!.id);
    await audit(req.user!.id, null, 'subscription:cancel');
    return { ok: true, accessUntil: req.user!.trial_ends_at };
  });

  /* ---------------- Privacy: export & delete ---------------- */
  app.get('/api/export', { preHandler: auth }, async (req) => {
    const id = req.user!.id;
    const all = async (t: string) => db.prepare(`SELECT * FROM ${t} WHERE user_id=?`).all(id);
    return { user: { id, email: req.user!.email, name: req.user!.name, role: req.user!.role }, consents: await all('consents'), assessments: await all('assessments'), plans: await all('plans'), workouts: await all('workouts'), nutrition: await all('nutrition'), recovery: await all('recovery') };
  });
  app.delete('/api/me', { preHandler: auth }, async (req) => {
    await audit(req.user!.id, null, 'account:delete');
    await db.prepare('DELETE FROM users WHERE id=?').run(req.user!.id);
    return { ok: true };
  });

  app.get('/api/health', async () => ({ ok: true }));

  // Serve the built PWA from the same origin (single-service deploy).
  if (opts.staticDir && existsSync(opts.staticDir)) {
    app.register(fastifyStatic, { root: opts.staticDir, wildcard: false });
    app.setNotFoundHandler((req, reply) => (req.url.startsWith('/api/') ? reply.code(404).send({ error: 'not_found' }) : reply.sendFile('index.html')));
  }
  return app;
}
