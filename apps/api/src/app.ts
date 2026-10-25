import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify';
import rateLimit from '@fastify/rate-limit';
import { z } from 'zod';
import { randomBytes, scryptSync, timingSafeEqual, createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import fastifyStatic from '@fastify/static';
import {
  gamification, paceMinPerKm, runningLoadAlert, checkAutonomy, DEFAULT_LIMITS, generatePlan, needsDeload, nextLoad, nutritionTarget, recoveryScore, screenSafety, seedLoad,
  CATALOG, type AssessmentInput, type AutonomyLimits, type Plan,
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
  specificGoals: z.array(z.string().trim().min(2).max(100)).max(12).optional(),
  baseline: z.object({
    age:z.number().int().min(13).max(100).optional(),weightKg:z.number().min(25).max(350).optional(),heightCm:z.number().min(100).max(240).optional(),
    weeklyStrengthSessions:z.number().int().min(0).max(14).optional(),weeklyRunKm:z.number().min(0).max(300).optional(),
    longestComfortableRunKm:z.number().min(0).max(100).optional(),comfortableRunPaceMinKm:z.number().min(2).max(20).optional(),
    walkingMinutes:z.number().min(0).max(240).optional(),pushUps:z.number().int().min(0).max(200).optional(),sitToStand30s:z.number().int().min(0).max(100).optional(),
    restingHeartRate:z.number().min(35).max(180).optional(),perceivedFitness:z.number().int().min(1).max(10).optional(),
    activityMinutesPerWeek:z.number().min(0).max(2000).optional(),sleepHours:z.number().min(0).max(16).optional(),recovery:z.number().int().min(1).max(10).optional()
  }).optional(),
  trainingContext:z.object({strengthDays:z.number().int().min(0).max(7).optional(),cardioDays:z.number().int().min(0).max(7).optional(),recentBreakWeeks:z.number().min(0).max(520).optional(),confidence:z.number().int().min(1).max(10).optional(),preferredReassessmentWeeks:z.number().int().min(2).max(24).optional()}).optional(),
  targetDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  sessionMinutes: z.number().int().min(20).max(120).optional(),
  preferredActivities: z.array(z.enum(['strength', 'running', 'mobility'])).optional(),
  daysPerWeek: z.number().int().min(1).max(6),
  experience: z.enum(['beginner', 'intermediate', 'advanced']),
  equipment: z.array(z.enum(['none', 'dumbbells', 'barbell', 'machines', 'bands', 'bar', 'rings'])),
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
    const current = await latestPlan(req.user!.id);
    if (current?.source.startsWith('pro:')) {
      await audit(req.user!.id, req.user!.id, 'assessment:professional_plan_preserved');
      return { referral:false, professionalPlanPreserved:true, planVersion:current.version };
    }
    const plan = generatePlan(b as AssessmentInput);
    const version = await savePlan(req.user!.id, plan, 'engine');
    await audit(req.user!.id, req.user!.id, 'assessment:completed');
    return { referral: false, planVersion: version, plan };
  });

  app.get('/api/assessments', { preHandler: athleteOnly }, async(req)=>{
    const rows=await db.prepare('SELECT data,created_at FROM assessments WHERE user_id=? ORDER BY id DESC LIMIT 24').all(req.user!.id) as {data:string;created_at:string}[];
    return rows.map(r=>({date:r.created_at,assessment:JSON.parse(r.data)}));
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
      dayIndex: z.number().int().min(0).max(13),
      fatigue: z.number().min(1).max(10).default(5),
      items: z.array(z.object({ exerciseId: z.string(), sets: z.array(z.object({ weight: z.number().min(0).max(1000), reps: z.number().int().min(0).max(200), rir: z.number().min(0).max(10) })).min(1) })).min(1),
    }), req.body, reply);
    if (!b) return;
    const uid = req.user!.id;
    const cur = await latestPlan(uid);
    if (!cur) return reply.code(409).send({ error: 'no_plan' });
    const plan = JSON.parse(cur.data) as Plan;
    const day = plan.days[b.dayIndex];
    if (!day) return reply.code(400).send({ error: 'invalid_day' });
    await db.prepare('INSERT INTO workouts(user_id,day_index,data,created_at) VALUES(?,?,?,?)').run(uid, b.dayIndex, JSON.stringify(b), now());
    if (cur.source.startsWith('pro:')) return { applied: true, professionalPlan: true, message:'workout_recorded' };
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

  /* ---------------- Beta coach: Gemini free-tier, opt-in, server-side only ---------------- */
  const coachDaily = new Map<number, { day: string; count: number }>();
  app.get('/api/coach/status', { preHandler: auth }, async (req) => {
    const day = now().slice(0,10);
    const usage = coachDaily.get(req.user!.id);
    return { available: !!process.env.GEMINI_API_KEY, provider: 'gemini', dailyLimit: 8, remaining: 8 - (usage?.day === day ? usage.count : 0), mode: 'beta' };
  });
  app.post('/api/coach/chat', { preHandler: auth }, async (req, reply) => {
    if (req.user!.role === 'athlete' && !await needHealth(req, reply)) return;
    if (req.user!.role === 'athlete' && !await hasConsent(req.user!.id, 'ai_memory')) return reply.code(403).send({ error: 'ai_consent_required' });
    const parsed = parse(z.object({ message: z.string().trim().min(1).max(450) }),req.body,reply);
    if (!parsed) return;
    const key = process.env.GEMINI_API_KEY;
    if (!key) return reply.code(503).send({ error: 'coach_unconfigured' });
    const uid = req.user!.id, day = now().slice(0,10);
    const usage = coachDaily.get(uid);
    const count = usage?.day === day ? usage.count : 0;
    if (count >= 8) return reply.code(429).send({ error: 'coach_daily_limit' });
    coachDaily.set(uid, { day, count: count + 1 });
    const assessment = await db.prepare('SELECT data FROM assessments WHERE user_id=? ORDER BY id DESC LIMIT 1').get(uid) as { data: string } | undefined;
    const workout = await db.prepare('SELECT COUNT(*) AS n FROM workouts WHERE user_id=?').get(uid) as { n: number };
    const profile = assessment ? JSON.parse(assessment.data) as AssessmentInput : null;
    const context = req.user!.role === 'pro' ? {role:'professional',notice:'No student information shared. Suggestions are educational and must be reviewed by the professional.'} : { primaryGoal: profile?.goal ?? 'general', secondaryGoals: profile?.secondaryGoals ?? [], target: profile?.targetDescription ?? '', availabilityDays: profile?.daysPerWeek ?? 3, sessionMinutes: profile?.sessionMinutes ?? 60, completedSessions: Number(workout.n) };
    try {
      const model = process.env.GEMINI_MODEL || 'gemini-2.5-flash-lite';
      if (!/^[a-zA-Z0-9._-]+$/.test(model)) return reply.code(500).send({ error: 'invalid_coach_model' });
      const response = await fetch('https://generativelanguage.googleapis.com/v1beta/models/' + model + ':generateContent', {
        method:'POST',
        headers:{ 'content-type':'application/json', 'x-goog-api-key':key },
        body:JSON.stringify({
          systemInstruction:{ parts:[{text:'Sos Fondal Coach, asistente educativo de ejercicio físico basado en evidencia. Podés orientar a entrenadores profesionales, pero no afirmes que modificaste rutinas, no prometas un gasto calórico exacto por ejercicio y pedí datos faltantes. Contestá en español claro, breve y con incertidumbre explícita. Personalizá según la meta y los registros; no inventes historial ni cites estudios inexistentes. No indiques esteroides, dosis ni tratamientos. Ante dolor torácico, síncope, síntomas de alarma o lesión grave recomendá suspender actividad y consultar. No generes diagnósticos. Nunca modifiques directamente el plan: solo sugerencias.'}] },
          contents:[{role:'user',parts:[{text:'Contexto limitado: '+JSON.stringify(context)+'\\nConsulta: '+parsed.message}]}],
          generationConfig:{temperature:0.3,maxOutputTokens:420}
        }),
        signal:AbortSignal.timeout(12000)
      });
      if (!response.ok) return reply.code(response.status===429?429:502).send({ error:'coach_provider_unavailable' });
      const body = await response.json() as { candidates?:{ content?:{ parts?:{text?:string}[] } }[] };
      const answer = body.candidates?.[0]?.content?.parts?.map(p=>p.text??'').join('').trim();
      if (!answer) return reply.code(502).send({error:'coach_empty'});
      return {answer:answer.slice(0,2500),remaining:Math.max(0,7-count)};
    } catch {
      return reply.code(503).send({error:'coach_timeout'});
    }
  });

  /* ---------------- Nutrition ---------------- */
  app.post('/api/nutrition/target', { preHandler: athleteOnly }, async (req, reply) => {
    if (!await needHealth(req, reply)) return;
    const b = parse(z.object({ sex: z.enum(['f', 'm']), weightKg: z.number().min(30).max(300), heightCm: z.number().min(120).max(230), age: z.number().int().min(16).max(90), activity: z.union([z.literal(1.2), z.literal(1.375), z.literal(1.55), z.literal(1.725)]), goal: z.enum(['strength', 'hypertrophy', 'endurance', 'fat_loss', 'mobility', 'general', 'hybrid']), adjustmentPct: z.number().min(-25).max(15).optional(), allergies: z.array(z.string()).default([]) }), req.body, reply);
    if (!b) return;
    const { allergies, ...input } = b;
    const t = nutritionTarget(input);
    await db.prepare("INSERT INTO nutrition(user_id,kind,data,created_at) VALUES(?,'target',?,?)").run(req.user!.id, JSON.stringify({ ...t, allergies }), now());
    return t;
  });
  app.post('/api/nutrition/estimate', { preHandler: athleteOnly }, async (req, reply) => {
    if (!await needHealth(req, reply)) return;
    const b = parse(z.object({ description: z.string().trim().min(3).max(500) }), req.body, reply);
    if (!b) return;
    if (!await hasConsent(req.user!.id, 'ai_memory')) return reply.code(403).send({error:'ai_consent_required'});
    const key=process.env.GEMINI_API_KEY;
    if (!key) return reply.code(503).send({error:'coach_unconfigured'});
    const model=process.env.GEMINI_MODEL || 'gemini-2.5-flash-lite';
    if (!/^[a-zA-Z0-9._-]+$/.test(model)) return reply.code(500).send({error:'invalid_coach_model'});
    try {
      const response=await fetch('https://generativelanguage.googleapis.com/v1beta/models/'+model+':generateContent',{
        method:'POST',headers:{'content-type':'application/json','x-goog-api-key':key},
        body:JSON.stringify({systemInstruction:{parts:[{text:'Estimá comida descrita por un adulto. Respondé ÚNICAMENTE JSON válido con campos kcal,proteinG,carbsG,fatG (números no negativos) y explanation (texto breve). No afirmes precisión; explicitá incertidumbre de porciones, aceite y cocción. Si no hay información suficiente, estimá porción habitual y avisá.'}]},contents:[{role:'user',parts:[{text:b.description}]}],generationConfig:{temperature:0.1,maxOutputTokens:240,responseMimeType:'application/json'}}),
        signal:AbortSignal.timeout(12000)
      });
      if(!response.ok)return reply.code(502).send({error:'estimate_unavailable'});
      const raw=await response.json() as {candidates?:{content?:{parts?:{text?:string}[]}}[]};
      const text=raw.candidates?.[0]?.content?.parts?.map(p=>p.text??'').join('')??'';
      const result=z.object({kcal:z.number().min(0).max(5000),proteinG:z.number().min(0).max(500),carbsG:z.number().min(0).max(1000),fatG:z.number().min(0).max(500),explanation:z.string().max(600)}).safeParse(JSON.parse(text));
      if(!result.success)return reply.code(502).send({error:'estimate_invalid'});
      return {...result.data,estimated:true};
    }catch{return reply.code(503).send({error:'estimate_unavailable'});}
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

  /* Calendar: explicit local-time offset; estimated energy balance, not a medical measurement. */
  app.get('/api/energy/calendar', { preHandler: athleteOnly }, async(req,reply)=>{
    const q=parse(z.object({month:z.string().regex(/^\d{4}-\d{2}$/),timezoneOffset:z.coerce.number().int().min(-840).max(840).default(0)}),req.query,reply);
    if(!q)return;
    const [year,month]=q.month.split('-').map(Number);
    if(year<2020||year>2100||month<1||month>12)return reply.code(400).send({error:'invalid_month'});
    const localStart=Date.UTC(year,month-1,1), localEnd=Date.UTC(year,month,1);
    const start=new Date(localStart+q.timezoneOffset*60000).toISOString();
    const end=new Date(localEnd+q.timezoneOffset*60000).toISOString();
    const rows=await db.prepare('SELECT kind,data,created_at FROM nutrition WHERE user_id=? AND created_at>=? AND created_at<? ORDER BY created_at').all(req.user!.id,start,end) as {kind:string;data:string;created_at:string}[];
    const latestTarget=await db.prepare("SELECT data FROM nutrition WHERE user_id=? AND kind='target' ORDER BY id DESC LIMIT 1").get(req.user!.id) as {data:string}|undefined;
    const target=latestTarget?JSON.parse(latestTarget.data) as {kcal?:number;tdee?:number;adjustmentPct?:number}:null;
    const byDay=new Map<string,{intake:number;runKcal:number;meals:{name:string;kcal:number}[];runs:{km:number;kcal:number}[]}>();
    for(const row of rows){
      if(row.kind!=='log'&&row.kind!=='exercise')continue;
      const localDay=new Date(Date.parse(row.created_at)-q.timezoneOffset*60000).toISOString().slice(0,10);
      const item=byDay.get(localDay)??{intake:0,runKcal:0,meals:[],runs:[]};
      const data=JSON.parse(row.data) as {kcal?:number;km?:number;meal?:string};
      const kcal=Math.max(0,Number(data.kcal)||0);
      if(row.kind==='log'){item.intake+=kcal;item.meals.push({name:String(data.meal??'Comida'),kcal});}
      else{item.runKcal+=kcal;item.runs.push({km:Number(data.km)||0,kcal});}
      byDay.set(localDay,item);
    }
    const days=[...byDay].map(([date,item])=>{
      const tdee=Number(target?.tdee)||0;
      const adjustedBudget=tdee+item.runKcal;
      const balance=tdee>0?Math.round(item.intake-adjustedBudget):null;
      const ratio=balance===null?null:balance/tdee;
      const band=ratio===null?'unknown':ratio>0.05?'red':ratio>0?'orange':ratio>=-0.05?'yellow':ratio>=-0.15?'green':ratio>=-0.25?'blue':'violet';
      return {date,...item,intake:Math.round(item.intake),runKcal:Math.round(item.runKcal),estimatedExpenditure:Math.round(adjustedBudget),balance,band,provisional:true};
    });
    return {month:q.month,target:target?{kcal:target.kcal,tdee:target.tdee,adjustmentPct:target.adjustmentPct}:null,days,note:'Estimaciones provisionales. El gasto basal ya puede incluir parte de la actividad; sumar running podría duplicar gasto. Los colores no diagnostican déficit real.'};
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
    const b = parse(z.object({ km: z.number().min(0.1).max(250), minutes: z.number().min(1).max(2000), rpe: z.number().min(1).max(10), weightKg:z.number().min(30).max(250).optional() }), req.body, reply);
    if (!b) return;
    const timestamp=now();
    await db.prepare('INSERT INTO runs(user_id,km,minutes,rpe,created_at) VALUES(?,?,?,?,?)').run(req.user!.id, b.km, b.minutes, b.rpe, timestamp);
    const calorieEstimate=b.weightKg ? Math.round(b.km*b.weightKg) : null;
    if(calorieEstimate!==null) await db.prepare("INSERT INTO nutrition(user_id,kind,data,created_at) VALUES(?,'exercise',?,?)").run(req.user!.id,JSON.stringify({kind:'run',km:b.km,minutes:b.minutes,kcal:calorieEstimate,weightKg:b.weightKg}),timestamp);
    return { pace: paceMinPerKm(b.km, b.minutes),estimatedKcal:calorieEstimate };
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

  app.get('/api/exercises', { preHandler: auth }, async () => CATALOG.map(e=>({id:e.id,name:e.nameEs??e.id,level:e.level??1,skill:e.skill??null,equipment:e.equipment,holdSeconds:!!e.holdSeconds})));

  /* Professional-designed plans: strength and cardio are independent on every day. */
  const professionalDay = z.object({
    name: z.string().trim().min(1).max(80),
    items: z.array(z.object({
      exerciseId: z.string().min(1).max(80), sets:z.number().int().min(1).max(12),
      repMin:z.number().int().min(1).max(100), repMax:z.number().int().min(1).max(150),
      rirTarget:z.number().min(0).max(10), load:z.number().min(0).max(1000),
    }).refine(i=>i.repMax>=i.repMin)).max(25),
    run: z.object({minutes:z.number().min(5).max(240),intensity:z.enum(['easy','moderate']),note:z.string().max(300)}).optional(),
  }).refine(d=>d.items.length>0 || !!d.run);
  const professionalTemplate = z.object({name:z.string().trim().min(2).max(100),days:z.array(professionalDay).min(1).max(14)});
  app.post('/api/pro/ai-plan-draft',{preHandler:proOnly},async(req,reply)=>{
    const b=parse(z.object({instruction:z.string().trim().min(10).max(1500)}),req.body,reply);
    if(!b)return;
    const key=process.env.GEMINI_API_KEY;
    if(!key)return reply.code(503).send({error:'coach_unconfigured'});
    const model=process.env.GEMINI_MODEL||'gemini-2.5-flash-lite';
    if(!/^[a-zA-Z0-9._-]+$/.test(model))return reply.code(500).send({error:'invalid_coach_model'});
    const exerciseList=CATALOG.map(e=>({id:e.id,name:e.nameEs??e.id,pattern:e.pattern,level:e.level??1}));
    try{
      const response=await fetch('https://generativelanguage.googleapis.com/v1beta/models/'+model+':generateContent',{
        method:'POST',headers:{'content-type':'application/json','x-goog-api-key':key},
        body:JSON.stringify({
          systemInstruction:{parts:[{text:'Sos un asistente de planificación de entrenamiento para un profesor. Creá un BORRADOR editable, nunca un plan aprobado. Usá solamente exerciseId de la lista. Respondé exclusivamente JSON: {"name":"...","days":[{"name":"...","items":[{"exerciseId":"...","sets":3,"repMin":8,"repMax":12,"rirTarget":3,"load":0}],"run":{"minutes":30,"intensity":"easy","note":"..."}}]}. El campo run es opcional; si no hay fuerza items puede ser []. Máximo 7 jornadas. Respetá descansos y volumen inicial prudente; nunca garantices calorías quemadas (depende de peso, intensidad y tiempo). Si el usuario pide 600 kcal, explicá en las notas que no puede garantizarse. No inventes condiciones clínicas. Solo borrador que debe aprobar el profesional.'}]},
          contents:[{role:'user',parts:[{text:'Ejercicios permitidos: '+JSON.stringify(exerciseList)+'\nSolicitud del entrenador: '+b.instruction}]}],
          generationConfig:{temperature:0.2,maxOutputTokens:2100,responseMimeType:'application/json'}
        }),signal:AbortSignal.timeout(16000)
      });
      if(!response.ok)return reply.code(502).send({error:'coach_provider_unavailable'});
      const data=await response.json() as {candidates?:{content?:{parts?:{text?:string}[]}}[]};
      const raw=data.candidates?.[0]?.content?.parts?.map(p=>p.text??'').join('')??'';
      const parsed=professionalTemplate.safeParse(JSON.parse(raw));
      if(!parsed.success)return reply.code(502).send({error:'draft_invalid'});
      if(parsed.data.days.some(d=>d.items.some(i=>!CATALOG.some(e=>e.id===i.exerciseId))))return reply.code(502).send({error:'unknown_exercise'});
      return {draft:parsed.data,disclaimer:'Borrador generado por IA. Revisá volumen, progresiones, técnica y objetivos antes de guardar o asignar. El gasto calórico por sesión no puede garantizarse.'};
    }catch{return reply.code(503).send({error:'coach_timeout'});}
  });
  app.get('/api/pro/code',{preHandler:proOnly},async(req)=>{
    const uid=req.user!.id;
    let row=await db.prepare('SELECT code FROM pro_codes WHERE pro_id=?').get(uid) as {code:string}|undefined;
    if(!row){
      // High entropy invitation token: only the professional may view it.
      const code=randomBytes(8).toString('hex').toUpperCase();
      await db.prepare('INSERT INTO pro_codes(code,pro_id,created_at) VALUES(?,?,?)').run(code,uid,now());
      row={code};
    }
    return {code:row.code};
  });
  app.post('/api/links/join-code',{preHandler:athleteOnly},async(req,reply)=>{
    if(!await hasConsent(req.user!.id,'share_with_pro')) return reply.code(403).send({error:'consent_required',scope:'share_with_pro'});
    const body=parse(z.object({code:z.string().trim().min(10).max(32)}),req.body,reply);
    if(!body)return;
    const found=await db.prepare("SELECT c.pro_id,u.name FROM pro_codes c JOIN users u ON u.id=c.pro_id AND u.role='pro' WHERE c.code=?").get(body.code.toUpperCase()) as {pro_id:number;name:string}|undefined;
    if(!found)return reply.code(404).send({error:'invalid_code'});
    await db.prepare("INSERT INTO links(pro_id,athlete_id,status,limits,created_at) VALUES(?,?,'active',?,?) ON CONFLICT(pro_id,athlete_id) DO UPDATE SET status='active'").run(found.pro_id,req.user!.id,JSON.stringify(DEFAULT_LIMITS),now());
    await audit(req.user!.id,found.pro_id,'join:code');
    return {ok:true,professional:found.name};
  });
  app.get('/api/pro/templates',{preHandler:proOnly},async(req)=>{
    const rows=await db.prepare('SELECT id,name,data,created_at FROM pro_templates WHERE pro_id=? ORDER BY id DESC').all(req.user!.id) as {id:number;name:string;data:string;created_at:string}[];
    return rows.map(row=>({id:row.id,name:row.name,days:JSON.parse(row.data).days,createdAt:row.created_at}));
  });
  app.post('/api/pro/templates',{preHandler:proOnly},async(req,reply)=>{
    const body=parse(professionalTemplate,req.body,reply);
    if(!body)return;
    const created=await db.prepare('INSERT INTO pro_templates(pro_id,name,data,created_at) VALUES(?,?,?,?) RETURNING id').get(req.user!.id,body.name,JSON.stringify(body),now()) as {id:number};
    return {id:created.id,name:body.name};
  });
  app.post('/api/pro/templates/:id/assign',{preHandler:proOnly},async(req,reply)=>{
    const body=parse(z.object({athleteId:z.number().int().positive()}),req.body,reply);
    if(!body)return;
    const linked=await db.prepare("SELECT id FROM links WHERE pro_id=? AND athlete_id=? AND status='active'").get(req.user!.id,body.athleteId);
    if(!linked)return reply.code(403).send({error:'not_linked'});
    const template=await db.prepare('SELECT id,name,data FROM pro_templates WHERE id=? AND pro_id=?').get(Number((req.params as {id:string}).id),req.user!.id) as {id:number;name:string;data:string}|undefined;
    if(!template)return reply.code(404).send({error:'not_found'});
    const saved=JSON.parse(template.data) as {days:Plan['days']};
    const plan:Plan={engineVersion:'professional-1',goal:'general',weeksSinceDeload:0,days:saved.days};
    const version=await savePlan(body.athleteId,plan,'pro:'+req.user!.id);
    await audit(req.user!.id,body.athleteId,'professional:assign');
    return {ok:true,version,athleteId:body.athleteId,template:template.name};
  });
  app.get('/api/pro/athletes/:id/training-feedback',{preHandler:proOnly},async(req,reply)=>{
    const aid=Number((req.params as {id:string}).id);
    const linked=await db.prepare("SELECT id FROM links WHERE pro_id=? AND athlete_id=? AND status='active'").get(req.user!.id,aid);
    if(!linked)return reply.code(403).send({error:'not_linked'});
    const workouts=await db.prepare('SELECT data,created_at FROM workouts WHERE user_id=? ORDER BY id DESC LIMIT 30').all(aid) as {data:string;created_at:string}[];
    const runs=await db.prepare('SELECT km,minutes,rpe,created_at FROM runs WHERE user_id=? ORDER BY id DESC LIMIT 30').all(aid);
    return {workouts:workouts.map(r=>({date:r.created_at,...JSON.parse(r.data)})),runs};
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

  /* Admin beta: restart the initial assessment for every athlete without deleting accounts or history. */
  app.post('/api/admin/reset-onboarding', { preHandler: auth }, async (req, reply) => {
    if (req.user!.role !== 'admin') return reply.code(403).send({ error: 'admin_only' });
    const body = parse(z.object({ confirmation: z.literal('REINICIAR EVALUACIONES') }), req.body, reply);
    if (!body) return;
    const count = await db.prepare("SELECT CAST(COUNT(*) AS INTEGER) AS n FROM users WHERE role='athlete'").get() as { n: number };
    // Existing workout and running history, accounts and professional links are intentionally preserved.
    await db.prepare("DELETE FROM plans WHERE user_id IN (SELECT id FROM users WHERE role='athlete')").run();
    await db.prepare("DELETE FROM assessments WHERE user_id IN (SELECT id FROM users WHERE role='athlete')").run();
    await audit(req.user!.id, null, 'admin:reset_onboarding_all');
    return { ok: true, affectedAthletes: count.n, retained: ['accounts','workouts','runs','links'] };
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
