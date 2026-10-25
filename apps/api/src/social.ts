import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { challengesForWeek, evaluateChallenge, isoWeekKey, normalizeZone, weekStartUtc, weeklyPoints, type Challenge, type WeekMetrics } from '@fondal/engine';
import type { RouteCtx } from './admin';

type Guard = (req: FastifyRequest, reply: FastifyReply) => Promise<unknown>;
export interface SocialCtx extends RouteCtx { athleteOnly: Guard; hasConsent: (uid: number, scope: string) => Promise<boolean> }

export const MIN_ZONE_SIZE = 3;

export function registerSocial(c: SocialCtx) {
  const { app, db, athleteOnly } = c;

  /** Weekly metrics from the user's own logs. Weeks are ISO weeks in UTC so every user is ranked on the same clock. */
  const weekMetrics = async (uid: number, from: Date): Promise<WeekMetrics & { does: { run: boolean; bike: boolean } }> => {
    const a = from.toISOString(), b = new Date(from.getTime() + 7 * 864e5).toISOString();
    const days = new Set<string>();
    const ws = await db.prepare('SELECT created_at FROM workouts WHERE user_id=? AND created_at>=? AND created_at<?').all(uid, a, b) as { created_at: string }[];
    ws.forEach((w) => days.add(w.created_at.slice(0, 10)));
    const acts = await db.prepare('SELECT sport,started_at,duration_sec,distance_m FROM activities WHERE user_id=? AND started_at>=? AND started_at<?').all(uid, a, b) as { sport: string; started_at: string; duration_sec: number; distance_m: number }[];
    acts.forEach((x) => days.add(x.started_at.slice(0, 10)));
    const blocks = await db.prepare("SELECT created_at,data FROM nutrition WHERE user_id=? AND kind='exercise' AND created_at>=? AND created_at<?").all(uid, a, b) as { created_at: string; data: string }[];
    let blockMin = 0;
    for (const x of blocks) { days.add(x.created_at.slice(0, 10)); for (const bl of (JSON.parse(x.data) as { blocks?: { minutes: number }[] }).blocks ?? []) blockMin += Number(bl.minutes) || 0; }
    const meals = await db.prepare("SELECT created_at FROM nutrition WHERE user_id=? AND kind='log' AND created_at>=? AND created_at<?").all(uid, a, b) as { created_at: string }[];
    const rec = await db.prepare('SELECT created_at FROM recovery WHERE user_id=? AND created_at>=? AND created_at<?').all(uid, a, b) as { created_at: string }[];
    const km = (s: string) => acts.filter((x) => x.sport === s).reduce((n, x) => n + x.distance_m, 0) / 1000;
    const pastRuns = (await db.prepare("SELECT CAST(COUNT(*) AS INTEGER) c FROM activities WHERE user_id=? AND sport='run'").get(uid) as { c: number }).c;
    const pastBikes = (await db.prepare("SELECT CAST(COUNT(*) AS INTEGER) c FROM activities WHERE user_id=? AND sport='bike'").get(uid) as { c: number }).c;
    return {
      sessions: ws.length + acts.length + blocks.length, activeDays: days.size,
      activeMinutes: Math.round(acts.reduce((n, x) => n + x.duration_sec / 60, 0) + blockMin + ws.length * 45),
      runKm: Math.round(km('run') * 10) / 10, bikeKm: Math.round(km('bike') * 10) / 10,
      mealDays: new Set(meals.map((m) => m.created_at.slice(0, 10))).size, recoveryDays: new Set(rec.map((m) => m.created_at.slice(0, 10))).size,
      does: { run: pastRuns > 0, bike: pastBikes > 0 },
    };
  };

  const progressFor = async (uid: number, from: Date) => {
    const m = await weekMetrics(uid, from);
    const week = isoWeekKey(from);
    const ch = challengesForWeek(week, m.does);
    return { week, metrics: m, challenges: ch.map((x: Challenge) => ({ ...x, ...evaluateChallenge(x, m) })), points: weeklyPoints(m, ch) };
  };

  app.get('/api/challenges', { preHandler: athleteOnly }, async (req) => {
    const r = await progressFor(req.user!.id, weekStartUtc(new Date()));
    const { does: _d, ...metrics } = r.metrics; void _d;
    return { ...r, metrics };
  });

  const rankingRow = async (uid: number) => await db.prepare('SELECT alias,zone,enabled FROM ranking WHERE user_id=?').get(uid) as { alias: string; zone: string; enabled: number } | undefined;

  /** Opt-in only. Shows alias and points: never body data, location beyond the coarse zone name, or anything health-related. */
  app.put('/api/ranking', { preHandler: athleteOnly }, async (req, reply) => {
    const b = c.parse(z.object({ enabled: z.boolean(), alias: z.string().trim().regex(/^[A-Za-z0-9_-]{3,20}$/).optional(), zone: z.string().trim().min(2).max(60).optional() }), req.body, reply);
    if (!b) return;
    const uid = req.user!.id;
    if (!b.enabled) { await db.prepare('DELETE FROM ranking WHERE user_id=?').run(uid); return { enabled: false }; }
    if (!b.alias || !b.zone || !normalizeZone(b.zone)) return reply.code(400).send({ error: 'alias_and_zone_required' });
    if (/@|\./.test(b.alias)) return reply.code(400).send({ error: 'alias_invalid' });
    try {
      await db.prepare('INSERT INTO ranking(user_id,alias,zone,enabled,updated_at) VALUES(?,?,?,1,?) ON CONFLICT(user_id) DO UPDATE SET alias=excluded.alias, zone=excluded.zone, enabled=1, updated_at=excluded.updated_at').run(uid, b.alias, normalizeZone(b.zone), c.now());
    } catch { return reply.code(409).send({ error: 'alias_taken' }); }
    return { enabled: true, alias: b.alias, zone: normalizeZone(b.zone) };
  });

  app.get('/api/ranking', { preHandler: athleteOnly }, async (req) => {
    const uid = req.user!.id, me = await rankingRow(uid), from = weekStartUtc(new Date()), week = isoWeekKey(from);
    if (!me?.enabled) return { enabled: false, week, minZoneSize: MIN_ZONE_SIZE };
    const rows = await db.prepare('SELECT user_id,alias FROM ranking WHERE zone=? AND enabled=1 ORDER BY user_id LIMIT 200').all(me.zone) as { user_id: number; alias: string }[];
    if (rows.length < MIN_ZONE_SIZE) return { enabled: true, alias: me.alias, zone: me.zone, week, zoneSize: rows.length, minZoneSize: MIN_ZONE_SIZE, leaderboard: null };
    const scored = await Promise.all(rows.map(async (r) => ({ id: r.user_id, alias: r.alias, points: (await progressFor(r.user_id, from)).points })));
    scored.sort((a, b) => b.points - a.points || a.alias.localeCompare(b.alias));
    const leaderboard = scored.slice(0, 20).map((s, i) => ({ rank: i + 1, alias: s.alias, points: s.points, me: s.id === uid }));
    const myRank = scored.findIndex((s) => s.id === uid) + 1;
    return { enabled: true, alias: me.alias, zone: me.zone, week, zoneSize: rows.length, minZoneSize: MIN_ZONE_SIZE, leaderboard, myRank, myPoints: scored[myRank - 1]?.points ?? 0 };
  });
}
