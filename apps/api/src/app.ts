import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify';
import rateLimit from '@fastify/rate-limit';
import { z } from 'zod';
import { randomBytes, scryptSync, timingSafeEqual, createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import fastifyStatic from '@fastify/static';
import {
  menusForDay, dayNumberOf, supplementAdvice, simplifyRoute, type DietFlag,
  materialize, gamification, paceMinPerKm, runningLoadAlert, checkAutonomy, DEFAULT_LIMITS, generatePlan, needsDeload, nextLoad, nutritionTarget, recoveryScore, screenSafety, seedLoad,
  type AssessmentInput, type AutonomyLimits, type Plan,
} from '@fondal/engine';
import type { DB } from './db';
import { COACH_SYSTEM, type CoachFn } from './coach';
import { registerAdmin } from './admin';
import { registerFood } from './food';
import { registerPro } from './pro';
import { registerPlans } from './plans';
import { registerProgress } from './progress';
import { registerSocial } from './social';
import { registerMemory, loadMemory, saveMemory, extractMemoryTags, TONE_PROMPT } from './memory';

const now = () => new Date().toISOString();
const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const TRIAL_DAYS = 14;
export const CONSENT_SCOPES = ['terms', 'health_data', 'share_with_pro', 'ai_memory', 'camera_video'] as const;

interface User { id: number; email: string; name: string; role: 'athlete' | 'pro' | 'admin'; lang: string; trial_ends_at: string; plan: string; canceled_at: string | null; pro_enabled: number; mode: string | null; last_seen_at: string | null; pro_code: string | null }

/** One account can be athlete and professional: `mode` is the hat currently worn. Legacy rows (mode NULL) fall back to their role. */
export const modeOf = (u: Pick<User, 'role' | 'mode' | 'pro_enabled'>): 'athlete' | 'pro' => (u.mode === 'pro' && (u.pro_enabled || u.role === 'pro') ? 'pro' : u.mode === 'athlete' ? 'athlete' : u.role === 'pro' ? 'pro' : 'athlete');
export const canPro = (u: Pick<User, 'role' | 'pro_enabled'>) => !!u.pro_enabled || u.role === 'pro' || u.role === 'admin';
declare module 'fastify' { interface FastifyRequest { user?: User } }

const limitsSchema = z.object({
  maxLoadIncreasePct: z.number().min(0).max(25),
  maxWeeklyVolumeDeltaPct: z.number().min(0).max(50),
  maxSessionsPerWeek: z.number().int().min(1).max(7),
  allowAutoDeload: z.boolean(),
});
const DIET_FLAGS = ['vegetarian', 'vegan', 'gluten_free', 'lactose_free', 'nut_free', 'egg_free', 'fish_free'] as const;
const profileSchema = z.object({
  sex: z.enum(['f', 'm']), age: z.number().int().min(16).max(90), weightKg: z.number().min(30).max(300), heightCm: z.number().min(120).max(230),
  bodyFatPct: z.number().min(3).max(60).optional(), waistCm: z.number().min(40).max(200).optional(),
  lifeFactor: z.union([z.literal(1.2), z.literal(1.3), z.literal(1.4)]), diet: z.array(z.enum(DIET_FLAGS)).default([]),
});
const assessmentSchema = z.object({
  profile: profileSchema,
  goal: z.enum(['hypertrophy', 'strength', 'recomposition', 'fat_loss', 'endurance', 'vo2max', 'general', 'mobility']),
  experience: z.enum(['beginner', 'intermediate', 'advanced']),
  strengthDays: z.number().int().min(0).max(6),
  cardioDays: z.number().int().min(0).max(6),
  cardioModalities: z.array(z.enum(['run', 'bike'])),
  equipment: z.array(z.enum(['none', 'dumbbells', 'barbell', 'machines', 'bands', 'bar'])),
  restrictions: z.array(z.enum(['knee', 'shoulder', 'lower_back', 'hip', 'ankle', 'wrist', 'neck'])),
  redFlags: z.object({ chestPain: z.boolean(), dizziness: z.boolean(), recentSurgery: z.boolean(), pregnancy: z.boolean(), medication: z.boolean() }),
}).refine((a) => a.strengthDays + a.cardioDays >= 1 && a.strengthDays + a.cardioDays <= 6, { message: 'days' })
  .refine((a) => a.cardioDays === 0 || a.cardioModalities.length > 0, { message: 'cardio_modality' });

export function buildApp(opts: { db: DB; rateLimitMax?: number; staticDir?: string; coach?: CoachFn; adminEmails?: string[] }) {
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
    void touch(row.id);
  }
  /** Daily-active telemetry: one row per user per day (cached in memory so it costs one query per user per day). */
  const seen = new Set<string>();
  const touch = async (uid: number) => {
    const day = now().slice(0, 10), key = `${uid}:${day}`;
    if (seen.has(key)) return;
    seen.add(key); if (seen.size > 50000) seen.clear();
    try {
      await db.prepare('INSERT INTO daily_active(user_id,day) VALUES(?,?) ON CONFLICT(user_id,day) DO NOTHING').run(uid, day);
      await db.prepare('UPDATE users SET last_seen_at=? WHERE id=?').run(now(), uid);
    } catch { seen.delete(key); }
  };
  const adminSet = new Set((opts.adminEmails ?? []).map((e) => e.trim().toLowerCase()).filter(Boolean));
  const isAdmin = (u: User) => adminSet.has(u.email.toLowerCase()) || u.role === 'admin';
  const adminOnly = async (req: FastifyRequest, reply: FastifyReply) => {
    await auth(req, reply);
    if (reply.sent) return;
    if (!isAdmin(req.user!)) return reply.code(403).send({ error: 'admin_only' });
  };
  const requireRole = (role: 'athlete' | 'pro') => async (req: FastifyRequest, reply: FastifyReply) => {
    await auth(req, reply);
    if (reply.sent) return;
    if (req.user!.role !== 'admin' && modeOf(req.user!) !== role) return reply.code(403).send({ error: 'forbidden', mode: modeOf(req.user!) });
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
      const r = await db.prepare('INSERT INTO users(email,name,role,lang,pass_hash,salt,created_at,trial_ends_at,pro_enabled,mode) VALUES(?,?,?,?,?,?,?,?,?,?) RETURNING id').get(b.email.toLowerCase(), b.name, b.role, b.lang, hash, salt, now(), trial, b.role === 'pro' ? 1 : 0, b.role) as { id: number };
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
    return { id: u.id, email: u.email, name: u.name, role: u.role, mode: modeOf(u), canPro: canPro(u), isAdmin: isAdmin(u), proCode: u.pro_code, lang: u.lang, subscription: { plan: u.plan, trialEndsAt: u.trial_ends_at, active: subscriptionActive(u), canceled: !!u.canceled_at }, consents: await consentsOf(u.id) };
  });
  const consentsOf = async (uid: number) => Object.fromEntries((await db.prepare('SELECT scope,granted FROM consents WHERE user_id=?').all(uid) as { scope: string; granted: number }[]).map((r) => [r.scope, !!r.granted]));

  /** Switch hat. Becoming a professional is self-serve; students only see your data after they accept your link. */
  app.post('/api/me/mode', { preHandler: auth }, async (req, reply) => {
    const b = parse(z.object({ mode: z.enum(['athlete', 'pro']) }), req.body, reply);
    if (!b) return;
    if (b.mode === 'pro' && !canPro(req.user!)) return reply.code(403).send({ error: 'pro_not_enabled' });
    await db.prepare('UPDATE users SET mode=? WHERE id=?').run(b.mode, req.user!.id);
    await audit(req.user!.id, null, `mode:${b.mode}`);
    return { mode: b.mode };
  });
  app.post('/api/me/pro', { preHandler: auth }, async (req) => {
    await db.prepare('UPDATE users SET pro_enabled=1 WHERE id=?').run(req.user!.id);
    await audit(req.user!.id, null, 'pro:enabled');
    return { ok: true };
  });

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
  const latestPlan = async (uid: number) => await db.prepare('SELECT * FROM plans WHERE user_id=? ORDER BY version DESC LIMIT 1').get(uid) as { version: number; data: string; source: string; created_at: string } | undefined;
  const savePlan = async (uid: number, plan: Plan, source: string) => {
    const v = ((await latestPlan(uid))?.version ?? 0) + 1;
    await db.prepare('INSERT INTO plans(user_id,version,data,source,created_at) VALUES(?,?,?,?,?)').run(uid, v, JSON.stringify(plan), source, now());
    return v;
  };

  const latestTarget = async (uid: number) => {
    const r = await db.prepare("SELECT data FROM nutrition WHERE user_id=? AND kind='target' ORDER BY id DESC LIMIT 1").get(uid) as { data: string } | undefined;
    return r ? JSON.parse(r.data) as ReturnType<typeof nutritionTarget> & { diet?: DietFlag[] } : null;
  };
  const saveTarget = async (uid: number, a: z.infer<typeof assessmentSchema>) => {
    const t = nutritionTarget({ ...a.profile, strengthDays: a.strengthDays, cardioDays: a.cardioDays, goal: a.goal });
    await db.prepare("INSERT INTO nutrition(user_id,kind,data,created_at) VALUES(?,'target',?,?)").run(uid, JSON.stringify({ ...t, diet: a.profile.diet }), now());
    return t;
  };

  app.post('/api/assessment', { preHandler: athleteOnly }, async (req, reply) => {
    if (!await needHealth(req, reply)) return;
    const b = parse(assessmentSchema, req.body, reply);
    if (!b) return;
    const uid = req.user!.id;
    await db.prepare('INSERT INTO assessments(user_id,data,created_at) VALUES(?,?,?)').run(uid, JSON.stringify(b), now());
    await db.prepare('INSERT INTO profiles(user_id,data,updated_at) VALUES(?,?,?) ON CONFLICT(user_id) DO UPDATE SET data=excluded.data, updated_at=excluded.updated_at').run(uid, JSON.stringify(b.profile), now());
    const safety = screenSafety(b as unknown as AssessmentInput);
    if (safety.status === 'refer') { await audit(uid, uid, 'assessment:referral'); return { referral: true, reasons: safety.reasons }; }
    const plan = generatePlan(b as unknown as AssessmentInput);
    const version = await savePlan(uid, plan, 'engine');
    const target = await saveTarget(uid, b);
    return { referral: false, planVersion: version, plan, target };
  });

  /** Latest answers, to edit the plan without starting over. */
  app.get('/api/assessment', { preHandler: athleteOnly }, async (req) => {
    const r = await db.prepare('SELECT data FROM assessments WHERE user_id=? ORDER BY id DESC LIMIT 1').get(req.user!.id) as { data: string } | undefined;
    return { assessment: r ? JSON.parse(r.data) : null };
  });

  /** Update weight/body data and recompute calorie targets without regenerating the plan. */
  app.put('/api/profile', { preHandler: athleteOnly }, async (req, reply) => {
    const b = parse(profileSchema, req.body, reply);
    if (!b) return;
    const uid = req.user!.id;
    const r = await db.prepare('SELECT data FROM assessments WHERE user_id=? ORDER BY id DESC LIMIT 1').get(uid) as { data: string } | undefined;
    if (!r) return reply.code(409).send({ error: 'no_assessment' });
    const a = { ...JSON.parse(r.data), profile: b } as z.infer<typeof assessmentSchema>;
    await db.prepare('INSERT INTO assessments(user_id,data,created_at) VALUES(?,?,?)').run(uid, JSON.stringify(a), now());
    await db.prepare('INSERT INTO profiles(user_id,data,updated_at) VALUES(?,?,?) ON CONFLICT(user_id) DO UPDATE SET data=excluded.data, updated_at=excluded.updated_at').run(uid, JSON.stringify(b), now());
    return saveTarget(uid, a);
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
    if (day.kind === 'cardio') return reply.code(400).send({ error: 'cardio_day_use_activities' });
    // Deload weeks, post-break ramps and fixed programs log the work but do not change loads.
    const exp = ((JSON.parse((await db.prepare('SELECT data FROM assessments WHERE user_id=? ORDER BY id DESC LIMIT 1').get(uid) as { data: string } | undefined)?.data ?? '{}') as { experience?: 'beginner' | 'intermediate' | 'advanced' }).experience) ?? 'intermediate';
    const mat = materialize(plan, new Date(), exp);
    if (plan.program || mat.label === 'deload' || mat.ramp) return { applied: true, planVersion: cur.version, decisions: {}, deloadSuggested: false, adaptation: 'paused' };
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
    return { sessions, total: sessions.length };
  });

  /* ---------------- Nutrition ---------------- */
  /** Three menus for the day (30 rotate every 10 days), portions scaled to the saved calorie target and diet. */
  app.get('/api/nutrition/menus', { preHandler: athleteOnly }, async (req, reply) => {
    const q = parse(z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() }), req.query, reply);
    if (!q) return;
    const t = await latestTarget(req.user!.id);
    if (!t) return reply.code(409).send({ error: 'no_target' });
    const day = dayNumberOf(new Date((q.date ?? now().slice(0, 10)) + 'T12:00:00Z'));
    return { kcal: t.kcal, menus: menusForDay(day, t.kcal, t.diet ?? []) };
  });

  /** Rule-based, evidence-ranked supplement advice (works without the AI key). */
  app.get('/api/supplements', { preHandler: athleteOnly }, async (req, reply) => {
    const uid = req.user!.id;
    const r = await db.prepare('SELECT data FROM assessments WHERE user_id=? ORDER BY id DESC LIMIT 1').get(uid) as { data: string } | undefined;
    const t = await latestTarget(uid);
    if (!r || !t) return reply.code(409).send({ error: 'no_assessment' });
    const a = JSON.parse(r.data) as z.infer<typeof assessmentSchema>;
    const since = new Date(Date.now() - 7 * 864e5).toISOString();
    const logs = (await db.prepare("SELECT data,created_at FROM nutrition WHERE user_id=? AND kind='log' AND created_at>?").all(uid, since) as { data: string; created_at: string }[]).map((x) => ({ ...JSON.parse(x.data), day: x.created_at.slice(0, 10) }));
    const days = new Set(logs.map((l) => l.day)).size;
    const avgProtein = days ? logs.reduce((s, l) => s + (l.proteinG ?? 0), 0) / days : null;
    const gap = avgProtein === null ? 0 : Math.max(0, Math.round(t.proteinG - avgProtein));
    return { supplements: supplementAdvice({ goal: a.goal, cardioDays: a.cardioDays, strengthDays: a.strengthDays, diet: a.profile.diet, proteinGapG: gap }), proteinGapG: gap, basedOnLogs: avgProtein !== null };
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

  const activityEnergy = (sport:string,meters:number,seconds:number,weightKg:number) => {
    // Gross estimates, not sensor-measured energy. Running ~1 kcal/kg/km;
    // walking ~0.55 kcal/kg/km; cycling speed-adjusted MET with broad uncertainty.
    const km=meters/1000;
    if(sport==='run')return Math.round(weightKg*km);
    if(sport==='walk')return Math.round(0.55*weightKg*km);
    const speed=seconds>0?meters/seconds*3.6:0;
    const met=speed>=23?8:speed>=16?6.8:4;
    return Math.round(met*3.5*weightKg/200*(seconds/60));
  };
  const profileWeight = async(uid:number) => {
    const profile=await db.prepare('SELECT data FROM profiles WHERE user_id=?').get(uid) as {data:string}|undefined;
    const weight=profile?Number((JSON.parse(profile.data) as {weightKg?:number}).weightKg):0;
    return weight>=30&&weight<=300?weight:null;
  };
  /* ---------------- GPS activities (run / bike / walk) ---------------- */
  app.post('/api/activities', { preHandler: athleteOnly }, async (req, reply) => {
    if (!await needHealth(req, reply)) return;
    const b = parse(z.object({
      sport: z.enum(['run', 'bike', 'walk']), startedAt: z.string().max(40), durationSec: z.number().int().min(1).max(86400), movingSec: z.number().int().min(0).max(86400),
      distanceM: z.number().int().min(0).max(400000), avgPaceSecKm: z.number().int().min(0).max(3600), elevGainM: z.number().int().min(0).max(10000),
      route: z.array(z.tuple([z.number().min(-90).max(90), z.number().min(-180).max(180)])).max(600).default([]),
      recoveredGapM:z.number().int().min(0).max(30000).default(0),
    }), req.body, reply);
    if (!b) return;
    const durationPace=b.distanceM>0?Math.round(b.durationSec*1000/b.distanceM):0;
    const weightKg=await profileWeight(req.user!.id);
    const estimatedKcal=weightKg?activityEnergy(b.sport,b.distanceM,b.durationSec,weightKg):null;
    const r = await db.prepare('INSERT INTO activities(user_id,sport,started_at,duration_sec,moving_sec,distance_m,avg_pace_sec_km,elev_gain_m,route,created_at) VALUES(?,?,?,?,?,?,?,?,?,?) RETURNING id').get(req.user!.id, b.sport, b.startedAt, b.durationSec, b.movingSec, b.distanceM, durationPace, b.elevGainM, JSON.stringify(b.route), now()) as { id: number };
    if(estimatedKcal!==null)await db.prepare("INSERT INTO nutrition(user_id,kind,data,created_at) VALUES(?,'exercise',?,?)").run(req.user!.id,JSON.stringify({kind:'gps',activityId:r.id,kcal:estimatedKcal,sport:b.sport}),now());
    return { id:r.id,estimatedKcal,avgPaceSecKm:durationPace };
  });
  app.get('/api/activities', { preHandler: athleteOnly }, async (req) => {
    const uid = req.user!.id;
    const rows = await db.prepare('SELECT id,sport,started_at,duration_sec,moving_sec,distance_m,avg_pace_sec_km,elev_gain_m FROM activities WHERE user_id=? ORDER BY id DESC LIMIT 30').all(uid) as Record<string, number | string>[];
    const weightKg=await profileWeight(uid);
    const activities=rows.map(r=>{
      const meters=Number(r.distance_m)||0,seconds=Number(r.duration_sec)||0;
      return {...r,avg_pace_sec_km:meters>0?Math.round(seconds*1000/meters):0,estimated_kcal:weightKg?activityEnergy(String(r.sport),meters,seconds,weightKg):null};
    });
    const km = async (from: string, to: string) => ((await db.prepare("SELECT CAST(COALESCE(SUM(distance_m),0) AS DOUBLE PRECISION) k FROM activities WHERE user_id=? AND sport='run' AND created_at>=? AND created_at<?").get(uid, from, to) as { k: number }).k) / 1000;
    const thisWeek = await km(weekStart(0), '9999'), prev = await km(weekStart(1), weekStart(0));
    return { activities, weekRunKm: Math.round(thisWeek * 10) / 10, alerts: runningLoadAlert(prev, thisWeek) };
  });
  app.get('/api/activities/:id', { preHandler: athleteOnly }, async (req, reply) => {
    const r = await db.prepare('SELECT * FROM activities WHERE id=? AND user_id=?').get(Number((req.params as { id: string }).id), req.user!.id) as { route: string } | undefined;
    if (!r) return reply.code(404).send({ error: 'not_found' });
    return { ...r, route: JSON.parse(r.route) };
  });

  app.get('/api/activity/today',{preHandler:athleteOnly},async(req)=>{
    const uid=req.user!.id;
    const q=req.query as {timezoneOffset?:string};
    const offset=Math.max(-840,Math.min(840,Number(q.timezoneOffset)||0));
    const nowLocal=new Date(Date.now()-offset*60000),today=nowLocal.toISOString().slice(0,10);
    const start=new Date(Date.parse(today+'T00:00:00Z')+offset*60000).toISOString();
    const end=new Date(Date.parse(today+'T00:00:00Z')+offset*60000+86400000).toISOString();
    const rows=await db.prepare('SELECT id,sport,started_at,duration_sec,distance_m,moving_sec,elev_gain_m FROM activities WHERE user_id=? AND started_at>=? AND started_at<? ORDER BY id DESC').all(uid,start,end) as {id:number;sport:string;started_at:string;duration_sec:number;distance_m:number;moving_sec:number;elev_gain_m:number}[];
    const weightKg=await profileWeight(uid);
    const activities=rows.map(r=>({...r,avg_pace_sec_km:r.distance_m?Math.round(r.duration_sec*1000/r.distance_m):0,estimated_kcal:weightKg?activityEnergy(r.sport,r.distance_m,r.duration_sec,weightKg):null}));
    const totalKcal=activities.reduce((n,r)=>n+(r.estimated_kcal??0),0);
    return {date:today,activities,totalKcal,estimated:weightKg!==null};
  });

  /** Custom strength / calisthenics blocks: incremental active energy above resting baseline. */
  app.post('/api/activity/blocks',{preHandler:athleteOnly},async(req,reply)=>{
    if(!await needHealth(req,reply))return;
    const b=parse(z.object({blocks:z.array(z.object({name:z.string().trim().min(1).max(100),kind:z.enum(['calisthenics','strength','functional','walk']),minutes:z.number().min(1).max(240),intensity:z.enum(['light','moderate','vigorous'])})).min(1).max(12)}),req.body,reply);
    if(!b)return;
    const weight=await profileWeight(req.user!.id);
    if(!weight)return reply.code(409).send({error:'weight_required'});
    const met:Record<string,Record<string,number>>={calisthenics:{light:2.8,moderate:3.8,vigorous:6},strength:{light:3,moderate:3.5,vigorous:6},functional:{light:3.5,moderate:5,vigorous:7},walk:{light:2.5,moderate:3.5,vigorous:4.8}};
    const blocks=b.blocks.map(item=>({...item,activeKcal:Math.round((met[item.kind]![item.intensity]!-1)*3.5*weight/200*item.minutes)}));
    const kcal=blocks.reduce((n,item)=>n+item.activeKcal,0);
    await db.prepare("INSERT INTO nutrition(user_id,kind,data,created_at) VALUES(?,'exercise',?,?)").run(req.user!.id,JSON.stringify({kind:'blocks',blocks,kcal}),now());
    return {blocks,activeKcal:kcal};
  });
  app.get('/api/energy/calendar',{preHandler:athleteOnly},async(req,reply)=>{
    const q=parse(z.object({month:z.string().regex(/^\d{4}-\d{2}$/),timezoneOffset:z.coerce.number().int().min(-840).max(840).default(0)}),req.query,reply);
    if(!q)return;
    const [y,m]=q.month.split('-').map(Number);const year=y??0,month=m??0;
    if(year<2020||year>2100||month<1||month>12)return reply.code(400).send({error:'invalid_month'});
    const start=new Date(Date.UTC(year,month-1,1)+q.timezoneOffset*60000).toISOString();
    const end=new Date(Date.UTC(year,month,1)+q.timezoneOffset*60000).toISOString();
    const rows=await db.prepare('SELECT kind,data,created_at FROM nutrition WHERE user_id=? AND created_at>=? AND created_at<? ORDER BY created_at').all(req.user!.id,start,end) as {kind:string;data:string;created_at:string}[];
    const activities=await db.prepare('SELECT sport,started_at,duration_sec,distance_m FROM activities WHERE user_id=? AND started_at>=? AND started_at<?').all(req.user!.id,start,end) as {sport:string;started_at:string;duration_sec:number;distance_m:number}[];
    const targetRow=await db.prepare("SELECT data FROM nutrition WHERE user_id=? AND kind='target' ORDER BY id DESC LIMIT 1").get(req.user!.id) as {data:string}|undefined;
    const target=targetRow?JSON.parse(targetRow.data) as {explain?:{bmr:number;lifeKcal:number;trainKcal:number;tdee:number};kcal?:number}:null;
    const weight=await profileWeight(req.user!.id);
    const days=new Map<string,{date:string;intake:number;exerciseKcal:number;meals:{name:string;kcal:number}[];sessions:string[]}>();
    const get=(stamp:string)=>{const date=new Date(Date.parse(stamp)-q.timezoneOffset*60000).toISOString().slice(0,10);let item=days.get(date);if(!item){item={date,intake:0,exerciseKcal:0,meals:[],sessions:[]};days.set(date,item);}return item;};
    for(const row of rows){
      const data=JSON.parse(row.data) as {meal?:string;kcal?:number;kind?:string;blocks?:{name:string}[]};
      const entry=get(row.created_at);
      if(row.kind==='log'){entry.intake+=Number(data.kcal)||0;entry.meals.push({name:data.meal??'Comida',kcal:Number(data.kcal)||0});}
      if(row.kind==='exercise'&&data.kind==='blocks'){entry.exerciseKcal+=Number(data.kcal)||0;entry.sessions.push(...(data.blocks??[]).map(x=>x.name));}
    }
    for(const a of activities){const entry=get(a.started_at);const kcal=weight?activityEnergy(a.sport,a.distance_m,a.duration_sec,weight):0;entry.exerciseKcal+=kcal;entry.sessions.push(a.sport==='run'?'Corrida':a.sport==='bike'?'Bicicleta':'Caminata');}
    const bmr=target?.explain?.bmr??0,base=bmr>0?bmr*1.2:0;
    const summary=[...days.values()].sort((a,b)=>a.date.localeCompare(b.date)).map(item=>{
      const expense=Math.round(base+item.exerciseKcal),balance=base>0?Math.round(item.intake-expense):null;
      const ratio=balance!==null?balance/base:0;
      const band=balance===null?'unknown':ratio>.05?'red':ratio>0?'orange':ratio>=-.05?'yellow':ratio>=-.15?'green':ratio>=-.25?'blue':'violet';
      return {...item,expense,balance,band};
    });
    return {month:q.month,baselineKcal:Math.round(base),days:summary,note:'Calorías y balance provisionales. El NEAT no está medido, el ejercicio puede ser impreciso y el registro alimentario podría estar incompleto.'};
  });
  /** Home energy widget: elapsed baseline, actual registered activity, and full-day budget. */
  app.get('/api/energy/today',{preHandler:athleteOnly},async(req)=>{
    const uid=req.user!.id;
    const query=req.query as {timezoneOffset?:string};
    const offset=Math.max(-840,Math.min(840,Number(query.timezoneOffset)||0));
    const localNow=Date.now()-offset*60000;
    const day=new Date(localNow).toISOString().slice(0,10);
    const midnight=Date.parse(day+'T00:00:00Z')+offset*60000;
    const start=new Date(midnight).toISOString(),end=new Date(midnight+86400000).toISOString();
    const dayFraction=Math.max(0,Math.min(1,(Date.now()-midnight)/86400000));
    const targetRow=await db.prepare("SELECT data FROM nutrition WHERE user_id=? AND kind='target' ORDER BY id DESC LIMIT 1").get(uid) as {data:string}|undefined;
    const target=targetRow?JSON.parse(targetRow.data) as {kcal?:number;explain?:{bmr?:number;lifeKcal?:number;tdee?:number;trainKcal?:number;adjustPct?:number;lifeFactor?:number}}:null;
    const bmr=Math.max(0,target?.explain?.bmr??0);
    const lifeDaily=Math.max(bmr,target?.explain?.lifeKcal??bmr*1.2);
    const neatProxy=Math.max(0,lifeDaily-bmr);
    const mealRows=await db.prepare("SELECT data FROM nutrition WHERE user_id=? AND kind='log' AND created_at>=? AND created_at<?").all(uid,start,end) as {data:string}[];
    const eaten=Math.round(mealRows.reduce((n,r)=>n+Math.max(0,Number((JSON.parse(r.data) as {kcal?:number}).kcal)||0),0));
    const activityRows=await db.prepare('SELECT sport,distance_m,duration_sec FROM activities WHERE user_id=? AND started_at>=? AND started_at<?').all(uid,start,end) as {sport:string;distance_m:number;duration_sec:number}[];
    const weight=await profileWeight(uid);
    const gpsKcal=activityRows.reduce((n,a)=>n+(weight?activityEnergy(a.sport,a.distance_m,a.duration_sec,weight):0),0);
    const blockRows=await db.prepare("SELECT data FROM nutrition WHERE user_id=? AND kind='exercise' AND created_at>=? AND created_at<?").all(uid,start,end) as {data:string}[];
    const blocksKcal=blockRows.reduce((n,r)=>{const d=JSON.parse(r.data) as {kind?:string;kcal?:number};return n+(d.kind==='blocks'?Math.max(0,Number(d.kcal)||0):0);},0);
    const exerciseKcal=Math.round(gpsKcal+blocksKcal);
    const basalSoFar=Math.round(bmr*dayFraction),neatSoFar=Math.round(neatProxy*dayFraction);
    const burnedSoFar=basalSoFar+neatSoFar+exerciseKcal;
    // Replace planned-training average with exercises actually registered; retain goal adjustment.
    const plannedTdee=target?.explain?.tdee??lifeDaily;
    const goalAdjustment=target?Math.round((target.kcal??plannedTdee)-plannedTdee):0;
    const budget=target?Math.max(Math.round(bmr),Math.round(lifeDaily+exerciseKcal+goalAdjustment)):null;
    return {date:day,basalSoFar,neatSoFar,exerciseKcal,burnedSoFar,eaten,
      dailyBmr:Math.round(bmr),dailyNeatProxy:Math.round(neatProxy),
      targetBudget:budget,remaining:budget===null?null:budget-eaten,
      complete:!!target,dayFraction,
      note:'El NEAT no se mide: la cifra representa actividad cotidiana y otros gastos incluidos en el factor de vida. El ejercicio y la comida pueden estar incompletos. No es un gasto calórico medido.'};
  });

  /* ---------------- AI coach ---------------- */
  app.get('/api/coach/status', { preHandler: athleteOnly }, async () => ({ configured: !!opts.coach }));
  app.post('/api/coach', { preHandler: athleteOnly, config: { rateLimit: { max: 12, timeWindow: '1 minute' } } }, async (req, reply) => {
    if (!await needHealth(req, reply)) return;
    if (!opts.coach) return reply.code(503).send({ error: 'coach_not_configured' });
    const b = parse(z.object({ message: z.string().min(1).max(1200), history: z.array(z.object({ role: z.enum(['user', 'assistant']), content: z.string().max(2000) })).max(10).default([]) }), req.body, reply);
    if (!b) return;
    const uid = req.user!.id;
    const used = (await db.prepare("SELECT CAST(COUNT(*) AS INTEGER) c FROM audit WHERE actor_id=? AND action='coach:msg' AND created_at>=?").get(uid, now().slice(0, 10)) as { c: number }).c;
    if (used >= 30) return reply.code(429).send({ error: 'coach_daily_limit' });
    const memory = await loadMemory(db, uid);
    const tone = memory.find((m) => m.key === 'coach_tone')?.value as keyof typeof TONE_PROMPT | undefined;
    const consent = await hasConsent(uid, 'ai_memory');
    // personal context and remembered facts reach the model ONLY with the explicit ai_memory consent; the chosen tone is a setting, not personal data
    let ctx = 'The user has not shared personal data with the coach.';
    let msgs = b.history;
    if (consent) {
      const a = await db.prepare('SELECT data FROM assessments WHERE user_id=? ORDER BY id DESC LIMIT 1').get(uid) as { data: string } | undefined;
      const t = await latestTarget(uid);
      const rec = await db.prepare('SELECT data,score FROM recovery WHERE user_id=? ORDER BY id DESC LIMIT 1').get(uid) as { data: string; score: number } | undefined;
      if (a) { const x = JSON.parse(a.data); ctx = `User data: goal=${x.goal}; experience=${x.experience}; strength days=${x.strengthDays}; cardio days=${x.cardioDays} (${x.cardioModalities.join(',')}); equipment=${x.equipment.join(',')}; restrictions=${x.restrictions.join(',') || 'none'}; sex=${x.profile.sex}; age=${x.profile.age}; weight=${x.profile.weightKg}kg; height=${x.profile.heightCm}cm; diet=${x.profile.diet.join(',') || 'no restrictions'}.`; }
      if (t) ctx += ` Daily target: ${t.kcal} kcal, protein ${t.proteinG} g, carbs ${t.carbsG} g, fat ${t.fatG} g.`;
      if (rec) ctx += ` Latest recovery score: ${rec.score}/100.`;
      const facts = memory.filter((m) => m.key !== 'coach_tone');
      if (facts.length) ctx += `\nKnown decisions and preferences (do NOT ask about these again): ${facts.map((m) => `${m.key}=${m.value}`).join('; ')}.`;
      ctx += '\nWhen the user states a stable preference or decision (injury history, schedule, dislikes, goals), append at the very end of your reply a tag like [[memory: key=value]] (key in snake_case, value short). Never put medical diagnoses in memory.';
      // persistent conversation: the server, not the browser, supplies the recent turns
      const past = (await db.prepare('SELECT role,content FROM coach_messages WHERE user_id=? ORDER BY id DESC LIMIT 8').all(uid) as { role: 'user' | 'assistant'; content: string }[]).reverse();
      msgs = past;
    }
    await audit(uid, null, 'coach:msg');
    try {
      const raw = await opts.coach(`${COACH_SYSTEM}\n${tone && TONE_PROMPT[tone] ? TONE_PROMPT[tone] : TONE_PROMPT.friendly}\n\n${ctx}\nUI language: ${req.user!.lang}`, [...msgs, { role: 'user', content: b.message }]);
      const { text, facts } = extractMemoryTags(raw);
      if (consent) {
        for (const f of facts) await saveMemory(db, uid, f.key, f.value, now());
        await db.prepare('INSERT INTO coach_messages(user_id,role,content,created_at) VALUES(?,?,?,?)').run(uid, 'user', b.message, now());
        await db.prepare('INSERT INTO coach_messages(user_id,role,content,created_at) VALUES(?,?,?,?)').run(uid, 'assistant', text, now());
      }
      return { reply: text, remembered: consent ? facts.map((f) => f.key) : [] };
    } catch { return reply.code(502).send({ error: 'coach_unavailable' }); }
  });

  /* ---------------- Gamification ---------------- */
  app.get('/api/gamification', { preHandler: athleteOnly }, async (req) => {
    const uid = req.user!.id;
    const byDay = new Map<string, { date: string; sessions: number; runs: number }>();
    const bump = (d: string, k: 'sessions' | 'runs') => { const day = d.slice(0, 10); const e = byDay.get(day) ?? { date: day, sessions: 0, runs: 0 }; e[k]++; byDay.set(day, e); };
    for (const r of await db.prepare('SELECT created_at FROM workouts WHERE user_id=?').all(uid) as { created_at: string }[]) bump(r.created_at, 'sessions');
    for (const r of await db.prepare('SELECT created_at FROM runs WHERE user_id=?').all(uid) as { created_at: string }[]) bump(r.created_at, 'runs');
    for (const r of await db.prepare('SELECT created_at FROM activities WHERE user_id=?').all(uid) as { created_at: string }[]) bump(r.created_at, 'runs');
    const rec = (await db.prepare('SELECT CAST(COUNT(*) AS INTEGER) c FROM recovery WHERE user_id=?').get(uid) as { c: number }).c;
    return gamification([...byDay.values()], rec);
  });


  /* ---------------- Professional links ---------------- */
  app.post('/api/pro/invites', { preHandler: proOnly }, async (req, reply) => {
    const b = parse(z.object({ email: z.string().email(), limits: limitsSchema.optional() }), req.body, reply);
    if (!b) return;
    const a = await db.prepare("SELECT id FROM users WHERE email=? AND id<>?").get(b.email.toLowerCase(), req.user!.id) as { id: number } | undefined;
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

  registerAdmin({ app, db, adminOnly, parse, audit, now });
  registerProgress({ app, db, parse, audit, now, athleteOnly, needHealth });
  registerSocial({ app, db, parse, audit, now, athleteOnly, hasConsent });
  registerMemory({ app, db, parse, audit, now, athleteOnly });
  registerPlans({ app, db, parse, audit, now, athleteOnly, needHealth, latestPlan, savePlan });
  registerPro({ app, db, parse, audit, now, proOnly, athleteOnly, hasConsent, savePlan });
  registerFood({ app, db, parse, audit, now, athleteOnly, needHealth, profileWeight, activityEnergy });

  // Serve the built PWA from the same origin (single-service deploy).
  if (opts.staticDir && existsSync(opts.staticDir)) {
    app.register(fastifyStatic, { root: opts.staticDir, wildcard: false });
    app.setNotFoundHandler((req, reply) => (req.url.startsWith('/api/') ? reply.code(404).send({ error: 'not_found' }) : reply.sendFile('index.html')));
  }
  return app;
}
