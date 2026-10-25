import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { DB } from './db';

export interface RouteCtx {
  app: FastifyInstance; db: DB; parse: <T extends z.ZodTypeAny>(s: T, body: unknown, reply: FastifyReply) => z.infer<T> | undefined;
  audit: (actor: number | null, subject: number | null, action: string) => Promise<unknown>; now: () => string;
}
type Guard = (req: FastifyRequest, reply: FastifyReply) => Promise<unknown>;

const daysBack = (n: number) => new Date(Date.now() - n * 864e5).toISOString().slice(0, 10);
const num = (v: unknown) => Number(v) || 0;

/**
 * Founder telemetry. Aggregate product metrics + the account list. It deliberately never exposes health,
 * nutrition, location or training content: admins see who signed up and how much the product is used, not people's bodies.
 */
export function registerAdmin(c: RouteCtx & { adminOnly: Guard }) {
  const { app, db, adminOnly } = c;
  const one = async (sql: string, ...p: unknown[]) => num(((await db.prepare(sql).get(...p)) as { c: number } | undefined)?.c);

  app.get('/api/admin/stats', { preHandler: adminOnly }, async (req) => {
    await c.audit((req as unknown as { user: { id: number } }).user.id, null, 'admin:stats');
    const today = daysBack(0), d7 = daysBack(6), d30 = daysBack(29), d60 = daysBack(59);
    const total = await one('SELECT CAST(COUNT(*) AS INTEGER) c FROM users');
    const athletes = await one("SELECT CAST(COUNT(*) AS INTEGER) c FROM users WHERE role='athlete' AND pro_enabled=0");
    const pros = await one("SELECT CAST(COUNT(*) AS INTEGER) c FROM users WHERE role='pro' OR pro_enabled=1");
    const dau = await one('SELECT CAST(COUNT(*) AS INTEGER) c FROM daily_active WHERE day=?', today);
    const wau = await one('SELECT CAST(COUNT(DISTINCT user_id) AS INTEGER) c FROM daily_active WHERE day>=?', d7);
    const mau = await one('SELECT CAST(COUNT(DISTINCT user_id) AS INTEGER) c FROM daily_active WHERE day>=?', d30);
    const signups = (await db.prepare('SELECT substr(created_at,1,10) AS day, CAST(COUNT(*) AS INTEGER) AS c FROM users WHERE created_at>=? GROUP BY substr(created_at,1,10)').all(d30 + 'T00:00:00') as { day: string; c: number }[]);
    const active = (await db.prepare('SELECT day, CAST(COUNT(*) AS INTEGER) AS c FROM daily_active WHERE day>=? GROUP BY day').all(d30) as { day: string; c: number }[]);
    const series = Array.from({ length: 30 }, (_, i) => {
      const day = daysBack(29 - i);
      return { day, signups: num(signups.find((x) => x.day === day)?.c), active: num(active.find((x) => x.day === day)?.c) };
    });
    // retention: of users who signed up ≥N days ago (last 60 days), how many were active on day N after signup
    const cohort = (await db.prepare('SELECT id, substr(created_at,1,10) AS day FROM users WHERE created_at>=?').all(d60 + 'T00:00:00') as { id: number; day: string }[]);
    const act = (await db.prepare('SELECT user_id, day FROM daily_active WHERE day>=?').all(d60) as { user_id: number; day: string }[]);
    const actSet = new Set(act.map((a) => `${a.user_id}:${a.day}`));
    const addDays = (day: string, n: number) => new Date(Date.parse(day + 'T00:00:00Z') + n * 864e5).toISOString().slice(0, 10);
    const retention = (n: number) => {
      const eligible = cohort.filter((u) => addDays(u.day, n) <= today);
      return { eligible: eligible.length, retained: eligible.filter((u) => actSet.has(`${u.id}:${addDays(u.day, n)}`)).length };
    };
    const since30 = d30 + 'T00:00:00';
    return {
      generatedAt: c.now(),
      users: { total, athletes, pros, newToday: await one('SELECT CAST(COUNT(*) AS INTEGER) c FROM users WHERE created_at>=?', today + 'T00:00:00'), new7d: await one('SELECT CAST(COUNT(*) AS INTEGER) c FROM users WHERE created_at>=?', d7 + 'T00:00:00'), new30d: await one('SELECT CAST(COUNT(*) AS INTEGER) c FROM users WHERE created_at>=?', since30) },
      activity: { dau, wau, mau, stickiness: mau ? Math.round((dau / mau) * 100) : 0 },
      retention: { d1: retention(1), d7: retention(7), d30: retention(30) },
      usage30d: {
        workouts: await one('SELECT CAST(COUNT(*) AS INTEGER) c FROM workouts WHERE created_at>=?', since30),
        gpsActivities: await one('SELECT CAST(COUNT(*) AS INTEGER) c FROM activities WHERE created_at>=?', since30),
        gpsKm: Math.round((await one('SELECT CAST(COALESCE(SUM(distance_m),0) AS INTEGER) c FROM activities WHERE created_at>=?', since30)) / 1000),
        foodLogs: await one("SELECT CAST(COUNT(*) AS INTEGER) c FROM nutrition WHERE kind='log' AND created_at>=?", since30),
        coachMessages: await one("SELECT CAST(COUNT(*) AS INTEGER) c FROM audit WHERE action='coach:msg' AND created_at>=?", since30),
        assessments: await one('SELECT CAST(COUNT(*) AS INTEGER) c FROM assessments WHERE created_at>=?', since30),
      },
      pro: { links: await one("SELECT CAST(COUNT(*) AS INTEGER) c FROM links WHERE status='active'"), pending: await one("SELECT CAST(COUNT(*) AS INTEGER) c FROM links WHERE status='pending'"), templates: await one('SELECT CAST(COUNT(*) AS INTEGER) c FROM pro_templates') },
      subscription: {
        trialActive: await one("SELECT CAST(COUNT(*) AS INTEGER) c FROM users WHERE plan='trial' AND trial_ends_at>?", c.now()),
        trialExpired: await one("SELECT CAST(COUNT(*) AS INTEGER) c FROM users WHERE plan='trial' AND trial_ends_at<=?", c.now()),
        canceled: await one('SELECT CAST(COUNT(*) AS INTEGER) c FROM users WHERE canceled_at IS NOT NULL'),
      },
      languages: (await db.prepare('SELECT lang, CAST(COUNT(*) AS INTEGER) AS c FROM users GROUP BY lang').all()) as { lang: string; c: number }[],
      consents: {
        aiMemory: await one("SELECT CAST(COUNT(*) AS INTEGER) c FROM consents WHERE scope='ai_memory' AND granted=1"),
        shareWithPro: await one("SELECT CAST(COUNT(*) AS INTEGER) c FROM consents WHERE scope='share_with_pro' AND granted=1"),
      },
      series,
    };
  });

  app.get('/api/admin/users', { preHandler: adminOnly }, async (req, reply) => {
    const q = c.parse(z.object({ q: z.string().max(80).optional(), page: z.coerce.number().int().min(0).max(10000).default(0) }), req.query, reply);
    if (!q) return;
    await c.audit((req as unknown as { user: { id: number } }).user.id, null, 'admin:users');
    const like = `%${(q.q ?? '').toLowerCase()}%`;
    const rows = await db.prepare('SELECT id,email,name,role,pro_enabled,mode,lang,created_at,last_seen_at,plan,trial_ends_at,canceled_at FROM users WHERE lower(email) LIKE ? OR lower(name) LIKE ? ORDER BY id DESC LIMIT 25 OFFSET ?').all(like, like, q.page * 25);
    const total = await one('SELECT CAST(COUNT(*) AS INTEGER) c FROM users WHERE lower(email) LIKE ? OR lower(name) LIKE ?', like, like);
    return { users: rows, total, page: q.page };
  });
}
