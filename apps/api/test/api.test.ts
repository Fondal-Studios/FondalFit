import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app';
import { openDb, type DB } from '../src/db';

// Runs against SQLite by default; set TEST_DATABASE_URL=postgres://… to run the same suite on PostgreSQL.
let app: ReturnType<typeof buildApp>;
let db: DB;
beforeEach(async () => {
  const url = process.env.TEST_DATABASE_URL;
  if (url) {
    const admin = await openDb(url);
    await admin.exec('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
    await admin.close();
  }
  db = await openDb(url ?? ':memory:');
  app = buildApp({ db, rateLimitMax: 100000 });
});
afterEach(async () => { await app.close(); await db.close(); });

async function call(method: string, url: string, token?: string, payload?: unknown) {
  const r = await app.inject({ method: method as 'GET', url, payload: payload as object, headers: token ? { authorization: `Bearer ${token}` } : {} });
  return { status: r.statusCode, body: r.json() };
}
async function reg(email: string, role: 'athlete' | 'pro') {
  const r = await call('POST', '/api/auth/register', undefined, { email, password: 'password123', name: email.split('@')[0], role, lang: 'pt' });
  return r.body.token as string;
}
const allConsents = { terms: true, health_data: true, share_with_pro: true, ai_memory: false, camera_video: false };
const profile = { sex: 'f', age: 30, weightKg: 62, heightCm: 165, lifeFactor: 1.3, diet: [] as string[] };
const assessment = { profile, goal: 'hypertrophy', strengthDays: 3, cardioDays: 0, cardioModalities: [] as string[], experience: 'intermediate', equipment: ['dumbbells'], restrictions: ['knee'], redFlags: { chestPain: false, dizziness: false, recentSurgery: false, pregnancy: false, medication: false } };

async function athleteWithPlan(email = 'ana@x.com') {
  const t = await reg(email, 'athlete');
  await call('PUT', '/api/consents', t, allConsents);
  const a = await call('POST', '/api/assessment', t, assessment);
  return { t, plan: a.body.plan };
}
const sessionFor = (plan: any, reps: number, rir: number, weight = 10) => ({
  dayIndex: 0, fatigue: 4,
  items: plan.days[0].items.map((i: any) => ({ exerciseId: i.exerciseId, sets: [{ weight: i.load || weight, reps, rir }, { weight: i.load || weight, reps, rir }] })),
});

describe('auth & access', () => {
  it('requires auth, rejects duplicates and bad logins', async () => {
    expect((await call('GET', '/api/me')).status).toBe(401);
    await reg('a@x.com', 'athlete');
    expect((await call('POST', '/api/auth/register', undefined, { email: 'a@x.com', password: 'password123', name: 'a', role: 'athlete' })).status).toBe(409);
    expect((await call('POST', '/api/auth/login', undefined, { email: 'a@x.com', password: 'wrongwrong' })).status).toBe(401);
    expect((await call('POST', '/api/auth/login', undefined, { email: 'a@x.com', password: 'password123' })).status).toBe(200);
  });
  it('roles are enforced', async () => {
    const pro = await reg('p@x.com', 'pro');
    expect((await call('GET', '/api/plan', pro)).status).toBe(403);
    const ath = await reg('a@x.com', 'athlete');
    expect((await call('GET', '/api/pro/athletes', ath)).status).toBe(403);
  });
});

describe('athlete flow', () => {
  it('blocks health data without consent', async () => {
    const t = await reg('a@x.com', 'athlete');
    const r = await call('POST', '/api/assessment', t, assessment);
    expect(r.status).toBe(403); expect(r.body.scope).toBe('health_data');
  });
  it('red flags yield referral and no plan', async () => {
    const t = await reg('a@x.com', 'athlete');
    await call('PUT', '/api/consents', t, allConsents);
    const r = await call('POST', '/api/assessment', t, { ...assessment, redFlags: { ...assessment.redFlags, chestPain: true } });
    expect(r.body.referral).toBe(true);
    expect((await call('GET', '/api/plan', t)).body.plan).toBeNull();
  });
  it('assessment → plan → sessions → persisted adaptation', async () => {
    const { t, plan } = await athleteWithPlan();
    expect(plan.days).toHaveLength(3);
    const s1 = await call('POST', '/api/workouts', t, sessionFor(plan, 10, 2));
    expect(s1.body.applied).toBe(true);
    const p1 = (await call('GET', '/api/plan', t)).body;
    expect(p1.version).toBe(2);
    const loaded = p1.plan.days[0].items.filter((i: any) => i.load > 0);
    expect(loaded.length).toBeGreaterThan(0);
    // top of range with spare reps → increase
    const s2 = await call('POST', '/api/workouts', t, sessionFor(p1.plan, 12, 3));
    expect(Object.values(s2.body.decisions)).toContain('increase');
    expect((await call('GET', '/api/progress', t)).body.total).toBe(2);
  });
  it('subscription expired blocks access, cancel keeps trial access', async () => {
    const t = await reg('a@x.com', 'athlete');
    expect((await call('POST', '/api/subscription/cancel', t)).status).toBe(200);
    expect((await call('GET', '/api/plan', t)).status).toBe(200);
  });
});

describe('nutrition & recovery', () => {
  it('assessment saves an explained calorie target; logs aggregate', async () => {
    const { t } = await athleteWithPlan();
    const n0 = (await call('GET', '/api/nutrition', t)).body;
    expect(n0.target.kcal).toBeGreaterThanOrEqual(1200);
    expect(n0.target.explain.formula).toBe('mifflin_st_jeor');
    await call('POST', '/api/nutrition/log', t, { meal: 'x', kcal: 500, proteinG: 30, carbsG: 50, fatG: 10, waterMl: 300 });
    await call('POST', '/api/nutrition/log', t, { meal: 'y', kcal: 300, proteinG: 20, carbsG: 30, fatG: 5, waterMl: 200 });
    const n = (await call('GET', '/api/nutrition', t)).body;
    expect(n.today).toMatchObject({ kcal: 800, waterMl: 500 });
  });
  it('serves 3 rotating menus that respect the diet', async () => {
    const t = await reg('v@x.com', 'athlete');
    await call('PUT', '/api/consents', t, allConsents);
    await call('POST', '/api/assessment', t, { ...assessment, profile: { ...profile, diet: ['vegan', 'gluten_free'] } });
    const d1 = (await call('GET', '/api/nutrition/menus?date=2026-10-25', t)).body;
    const d2 = (await call('GET', '/api/nutrition/menus?date=2026-10-26', t)).body;
    expect(d1.menus).toHaveLength(3);
    expect(d1.menus.map((m: any) => m.index)).not.toEqual(d2.menus.map((m: any) => m.index));
    const text = JSON.stringify(d1.menus);
    for (const banned of ['chicken', 'beef', 'tuna', 'salmon', 'egg', 'yogurt', 'whey', 'pasta', 'toast', 'oats']) expect(text).not.toContain(banned);
    expect((await call('GET', '/api/nutrition/menus', await reg('nt@x.com', 'athlete'))).status).toBe(409);
  });
  it('updating the profile recomputes targets', async () => {
    const { t } = await athleteWithPlan();
    const before = (await call('GET', '/api/nutrition', t)).body.target.kcal;
    const r = await call('PUT', '/api/profile', t, { ...profile, weightKg: 90 });
    expect(r.body.kcal).toBeGreaterThan(before);
  });
  it('supplement advice is rule-based and conditional on logs', async () => {
    const { t } = await athleteWithPlan();
    const s0 = (await call('GET', '/api/supplements', t)).body;
    expect(s0.supplements.map((x: any) => x.id)).toContain('creatine');
    expect(s0.basedOnLogs).toBe(false);
    await call('POST', '/api/nutrition/log', t, { meal: 'x', kcal: 1500, proteinG: 40, carbsG: 150, fatG: 40 });
    const s1 = (await call('GET', '/api/supplements', t)).body;
    expect(s1.proteinGapG).toBeGreaterThan(20);
    expect(s1.supplements.map((x: any) => x.id)).toContain('whey_or_plant_protein');
  });
  it('recovery alerts', async () => {
    const { t } = await athleteWithPlan();
    const r = await call('POST', '/api/recovery', t, { sleepHours: 4, fatigue: 9, stress: 5, pain: 8 });
    expect(r.body.alerts).toContain('high_pain');
  });
});

describe('professional supervision', () => {
  async function linked(limits?: object) {
    const { t, plan } = await athleteWithPlan();
    const pro = await reg('coach@x.com', 'pro');
    await call('POST', '/api/pro/invites', pro, { email: 'ana@x.com', limits });
    const links = (await call('GET', '/api/links', t)).body;
    await call('POST', `/api/links/${links[0].id}/accept`, t);
    return { t, plan, pro, linkId: links[0].id };
  }
  it('pro sees nothing before the athlete accepts', async () => {
    const { t } = await athleteWithPlan();
    const pro = await reg('coach@x.com', 'pro');
    await call('POST', '/api/pro/invites', pro, { email: 'ana@x.com' });
    expect((await call('GET', '/api/pro/athletes', pro)).body).toEqual([]);
    const id = (await call('GET', '/api/links', t)).body[0].id;
    expect((await call('POST', `/api/links/${id}/accept`, t)).status).toBe(200);
    expect((await call('GET', '/api/pro/athletes', pro)).body).toHaveLength(1);
  });
  it('invite does not reveal whether account exists', async () => {
    const pro = await reg('coach@x.com', 'pro');
    const r = await call('POST', '/api/pro/invites', pro, { email: 'ghost@x.com' });
    expect(r.body).toEqual({ ok: true });
  });
  it('accept requires share_with_pro consent', async () => {
    const t = await reg('ana@x.com', 'athlete');
    const pro = await reg('coach@x.com', 'pro');
    await call('POST', '/api/pro/invites', pro, { email: 'ana@x.com' });
    const id = (await call('GET', '/api/links', t)).body[0].id;
    expect((await call('POST', `/api/links/${id}/accept`, t)).status).toBe(403);
  });
  it('out-of-limit changes require professional approval; in-limit auto-apply', async () => {
    const strict = { maxLoadIncreasePct: 1, maxWeeklyVolumeDeltaPct: 10, maxSessionsPerWeek: 5, allowAutoDeload: true };
    const { t, plan, pro } = await linked(strict);
    await call('POST', '/api/workouts', t, sessionFor(plan, 10, 2)); // seed loads (no increase)
    const p1 = (await call('GET', '/api/plan', t)).body;
    const s = await call('POST', '/api/workouts', t, sessionFor(p1.plan, 12, 3));
    expect(s.body.applied).toBe(false);
    expect(s.body.violations).toContain('load_increase');
    expect((await call('GET', '/api/plan', t)).body.version).toBe(p1.version); // unchanged
    const appr = (await call('GET', '/api/pro/approvals', pro)).body;
    expect(appr[0].status).toBe('pending');
    await call('POST', `/api/pro/approvals/${appr[0].id}/decide`, pro, { approve: true });
    expect((await call('GET', '/api/plan', t)).body.version).toBe(p1.version + 1);
  });
  it('revocation cuts pro access immediately', async () => {
    const { t, pro, linkId } = await linked();
    const ath = (await call('GET', '/api/pro/athletes', pro)).body[0];
    expect((await call('GET', `/api/pro/athletes/${ath.id}/summary`, pro)).status).toBe(200);
    await call('POST', `/api/links/${linkId}/revoke`, t);
    expect((await call('GET', `/api/pro/athletes/${ath.id}/summary`, pro)).status).toBe(404);
    expect((await call('GET', '/api/pro/athletes', pro)).body).toEqual([]);
  });
  it('withdrawing consent revokes links', async () => {
    const { t, pro } = await linked();
    await call('PUT', '/api/consents', t, { share_with_pro: false });
    expect((await call('GET', '/api/pro/athletes', pro)).body).toEqual([]);
  });
  it('a pro cannot read an unlinked athlete', async () => {
    const { } = await athleteWithPlan('other@x.com');
    const pro = await reg('coach@x.com', 'pro');
    expect((await call('GET', '/api/pro/athletes/1/summary', pro)).status).toBe(404);
    expect((await call('PUT', '/api/pro/athletes/1/limits', pro, { maxLoadIncreasePct: 5, maxWeeklyVolumeDeltaPct: 10, maxSessionsPerWeek: 5, allowAutoDeload: true })).status).toBe(404);
  });
});

describe('GPS activities & gamification', () => {
  const act = (km: number) => ({ sport: 'run', startedAt: new Date().toISOString(), durationSec: km * 360, movingSec: km * 360, distanceM: km * 1000, avgPaceSecKm: 360, elevGainM: 10, route: [[-34.6, -58.4], [-34.61, -58.41]] });
  it('stores activities with route, warns on volume jumps, awards capped XP', async () => {
    const { t } = await athleteWithPlan();
    const r = await call('POST', '/api/activities', t, act(10));
    await call('POST', '/api/activities', t, act(20));
    const list = (await call('GET', '/api/activities', t)).body;
    expect(list.activities).toHaveLength(2);
    expect(list.alerts).toEqual(['run_volume_jump']);
    expect((await call('GET', `/api/activities/${r.body.id}`, t)).body.route).toHaveLength(2);
    const plan = (await call('GET', '/api/plan', t)).body.plan;
    await call('POST', '/api/workouts', t, sessionFor(plan, 10, 2));
    await call('POST', '/api/workouts', t, sessionFor(plan, 10, 2));
    const g = (await call('GET', '/api/gamification', t)).body;
    expect(g.xp).toBe(50); // same day: one rewarded activity only
    expect(g.achievements).toEqual(expect.arrayContaining(['first_session', 'first_run']));
  });
  it('corrects wrong average pace and makes a saved run appear on the daily home feed', async () => {
    const { t }=await athleteWithPlan();
    const r=await call('POST','/api/activities',t,{
      sport:'run',startedAt:new Date().toISOString(),durationSec:1585,movingSec:1120,
      distanceM:3270,avgPaceSecKm:348,elevGainM:92,route:[[-26.07,-65.97],[-26.075,-65.975]]
    });
    expect(r.status).toBe(200);
    expect(r.body.avgPaceSecKm).toBe(Math.round(1585*1000/3270));
    expect(r.body.estimatedKcal).toBe(Math.round(profile.weightKg*3.27));
    const offset=new Date().getTimezoneOffset();
    const day=await call('GET','/api/activity/today?timezoneOffset='+offset,t);
    expect(day.status).toBe(200);
    expect(day.body.activities.some((x:any)=>x.id===r.body.id)).toBe(true);
    expect(day.body.activities[0].avg_pace_sec_km).toBe(Math.round(1585*1000/3270));
    expect(day.body.totalKcal).toBe(Math.round(profile.weightKg*3.27));
  });
  it('requires consent and isolates users', async () => {
    const t = await reg('b@x.com', 'athlete');
    expect((await call('POST', '/api/activities', t, act(5))).status).toBe(403);
    const a = await athleteWithPlan('c@x.com');
    const id = (await call('POST', '/api/activities', a.t, act(5))).body.id;
    const other = await athleteWithPlan('d@x.com');
    expect((await call('GET', `/api/activities/${id}`, other.t)).status).toBe(404);
  });
});

describe('hybrid plan, editing and cardio days', () => {
  it('builds a hybrid week, lets the athlete read & change answers, and guards cardio days', async () => {
    const t = await reg('h@x.com', 'athlete');
    await call('PUT', '/api/consents', t, allConsents);
    const hy = { ...assessment, strengthDays: 3, cardioDays: 2, cardioModalities: ['run', 'bike'] };
    const r = await call('POST', '/api/assessment', t, hy);
    expect(r.body.plan.days).toHaveLength(5);
    const cardioIdx = r.body.plan.days.findIndex((d: any) => d.kind === 'cardio');
    expect((await call('POST', '/api/workouts', t, { dayIndex: cardioIdx, items: [{ exerciseId: 'x', sets: [{ weight: 0, reps: 1, rir: 1 }] }] })).body.error).toBe('cardio_day_use_activities');
    // change mind: 5 strength days instead
    expect((await call('GET', '/api/assessment', t)).body.assessment.cardioDays).toBe(2);
    const r2 = await call('POST', '/api/assessment', t, { ...assessment, strengthDays: 5, cardioDays: 0 });
    expect(r2.body.plan.days).toHaveLength(5);
    expect(r2.body.planVersion).toBe(2);
  });
  it('validates days and anthropometrics', async () => {
    const t = await reg('i@x.com', 'athlete');
    await call('PUT', '/api/consents', t, allConsents);
    expect((await call('POST', '/api/assessment', t, { ...assessment, strengthDays: 6, cardioDays: 3 })).status).toBe(400);
    expect((await call('POST', '/api/assessment', t, { ...assessment, profile: { ...profile, weightKg: 5 } })).status).toBe(400);
    expect((await call('POST', '/api/assessment', t, { ...assessment, strengthDays: 0, cardioDays: 2, cardioModalities: [] })).status).toBe(400);
  });
});

describe('AI coach', () => {
  const body = { message: 'qué suplementos?' };
  it('is clearly unavailable without a configured model', async () => {
    const { t } = await athleteWithPlan();
    expect((await call('GET', '/api/coach/status', t)).body.configured).toBe(false);
    expect((await call('POST', '/api/coach', t, body)).status).toBe(503);
  });
  it('shares personal context only with ai_memory consent, and limits daily use', async () => {
    const seen: string[] = [];
    app = buildApp({ db, rateLimitMax: 100000, coach: async (sys, msgs) => { seen.push(sys); return 'ok:' + msgs.length; } });
    const { t } = await athleteWithPlan();
    expect((await call('POST', '/api/coach', t, body)).body.reply).toBe('ok:1');
    expect(seen[0]).toContain('has not shared personal data');
    await call('PUT', '/api/consents', t, { ai_memory: true });
    await call('POST', '/api/coach', t, { ...body, history: [{ role: 'user', content: 'hola' }, { role: 'assistant', content: 'hi' }] });
    expect(seen[1]).toContain('goal=hypertrophy');
    expect(seen[1]).toContain('kcal');
    for (let i = 0; i < 28; i++) await call('POST', '/api/coach', t, body);
    expect((await call('POST', '/api/coach', t, body)).status).toBe(429);
  });
  it('degrades gracefully when the model fails', async () => {
    app = buildApp({ db, rateLimitMax: 100000, coach: async () => { throw new Error('boom'); } });
    const { t } = await athleteWithPlan();
    expect((await call('POST', '/api/coach', t, body)).status).toBe(502);
  });
});

describe('custom activity blocks and energy calendar',()=>{
  it('records calisthenics blocks into the same daily energy log as nutrition',async()=>{
    const {t}=await athleteWithPlan();
    const a=await call('POST','/api/activity/blocks',t,{blocks:[{name:'Dominadas',kind:'calisthenics',minutes:15,intensity:'moderate'}]});
    expect(a.status).toBe(200);expect(a.body.activeKcal).toBeGreaterThan(0);
    const date=new Date().toISOString().slice(0,7);
    const result=await call('GET','/api/energy/calendar?month='+date+'&timezoneOffset=0',t);
    expect(result.status).toBe(200);
    expect(result.body.days.some((day:any)=>day.sessions.includes('Dominadas'))).toBe(true);
  });
  it('rejects invalid month and unauthenticated calendar',async()=>{
    expect((await call('GET','/api/energy/calendar?month=2026-20')).status).toBe(401);
    const {t}=await athleteWithPlan();
    expect((await call('GET','/api/energy/calendar?month=2026-20',t)).status).toBe(400);
  });
});
describe('home calorie estimate',()=>{
 it('combines elapsed basal estimate with recorded food and activity',async()=>{
  const {t}=await athleteWithPlan();
  const now=new Date().toISOString();
  await call('POST','/api/nutrition/log',t,{meal:'almuerzo',kcal:600,proteinG:30,carbsG:60,fatG:15,waterMl:200});
  const run=await call('POST','/api/activities',t,{sport:'run',startedAt:now,durationSec:1200,movingSec:1100,distanceM:3000,avgPaceSecKm:400,elevGainM:15,route:[]});
  expect(run.status).toBe(200);
  const response=await call('GET','/api/energy/today?timezoneOffset=0',t);
  expect(response.status).toBe(200);
  expect(response.body.eaten).toBe(600);
  expect(response.body.exerciseKcal).toBe(Math.round(profile.weightKg*3));
  expect(response.body.burnedSoFar).toBe(response.body.basalSoFar+response.body.neatSoFar+response.body.exerciseKcal);
  expect(response.body.remaining).toBe(response.body.targetBudget-600);
 });
});

describe('food by category and grams, and the daily energy balance', () => {
  it('recomputes a plate from foods and grams (never trusting client numbers) and feeds the balance', async () => {
    const { t } = await athleteWithPlan();
    const r = await call('POST', '/api/nutrition/log', t, { mealType: 'lunch', items: [{ foodId: 'chicken_breast', grams: 200 }, { foodId: 'rice_white', grams: 150 }, { foodId: 'broccoli', grams: 100 }], kcal: 1 });
    expect(r.body.kcal).toBe(330 + 195 + 35);
    expect(r.body.proteinG).toBeCloseTo(62 + 4.05 + 2.4, 0);
    expect(r.body.mealType).toBe('lunch');
    expect(r.body.items).toHaveLength(3);
    const d = (await call('GET', '/api/day', t)).body;
    expect(d.intake.kcal).toBe(560);
    expect(d.logs).toHaveLength(1);
    expect(d.resting).toBe(d.target.explain.lifeKcal);
    expect(d.balance).toBe(560 - d.expenditure);
    expect(d.estimated).toBe(true);
  });
  it('rejects unknown foods and empty logs, supports delete and backfilled days in the local timezone', async () => {
    const { t } = await athleteWithPlan();
    expect((await call('POST', '/api/nutrition/log', t, { items: [{ foodId: 'unicorn', grams: 100 }] })).status).toBe(400);
    expect((await call('POST', '/api/nutrition/log', t, {})).status).toBe(400);
    const y = new Date(Date.now() - 864e5).toISOString();
    const r = await call('POST', '/api/nutrition/log', t, { items: [{ foodId: 'banana', grams: 120 }], at: y });
    const yDate = y.slice(0, 10);
    expect((await call('GET', `/api/day?date=${yDate}`, t)).body.intake.kcal).toBe(r.body.kcal);
    expect((await call('GET', '/api/day', t)).body.intake.kcal).toBe(0);
    expect((await call('POST', '/api/nutrition/log', t, { items: [{ foodId: 'banana', grams: 120 }], at: new Date(Date.now() + 5 * 864e5).toISOString() })).status).toBe(400);
    expect((await call('DELETE', `/api/nutrition/log/${r.body.id}`, t)).status).toBe(200);
    expect((await call('GET', `/api/day?date=${yDate}`, t)).body.intake.kcal).toBe(0);
  });
  it('uses the local day: a late-evening meal in UTC−3 belongs to that local day', async () => {
    const { t } = await athleteWithPlan();
    // 2026-03-10 23:30 local (UTC−3) = 2026-03-11 02:30Z, logged within the allowed backfill window by faking "now"
    const real = Date.now; Date.now = () => Date.parse('2026-03-11T03:00:00Z');
    try {
      await call('POST', '/api/nutrition/log', t, { items: [{ foodId: 'pizza', grams: 220 }], at: '2026-03-11T02:30:00Z', timezoneOffset: 180 });
      expect((await call('GET', '/api/day?date=2026-03-10&timezoneOffset=180', t)).body.intake.kcal).toBeGreaterThan(500);
      expect((await call('GET', '/api/day?date=2026-03-11&timezoneOffset=180', t)).body.intake.kcal).toBe(0);
    } finally { Date.now = real; }
  });
  it('other users cannot delete my logs', async () => {
    const a = await athleteWithPlan('a1@x.com'), b = await athleteWithPlan('b1@x.com');
    const r = await call('POST', '/api/nutrition/log', a.t, { items: [{ foodId: 'egg', grams: 100 }] });
    expect((await call('DELETE', `/api/nutrition/log/${r.body.id}`, b.t)).status).toBe(404);
  });
  it('lists recent plates for one-tap re-logging', async () => {
    const { t } = await athleteWithPlan();
    await call('POST', '/api/nutrition/log', t, { meal: 'Mi almuerzo', items: [{ foodId: 'beef_lean', grams: 150 }] });
    await call('POST', '/api/nutrition/log', t, { meal: 'Mi almuerzo', items: [{ foodId: 'beef_lean', grams: 150 }] });
    expect((await call('GET', '/api/nutrition/recent', t)).body.recent).toHaveLength(1);
  });
});

describe('professional studio: codes, routines for students, feedback', () => {
  const routine = { name: 'Fuerza A', goal: 'strength', days: [{ name: 'Día 1', kind: 'strength', items: [{ exerciseId: 'back_squat', sets: 5, repMin: 3, repMax: 5, rirTarget: 2, restSec: 180 }, { exerciseId: 'bench_press', sets: 4, repMin: 5, repMax: 8 }] }, { name: 'Rodaje', kind: 'cardio', items: [], cardio: { modality: 'run', type: 'zone2', durationMin: 40 } }] };
  it('a student joins with the professional\'s code; the professional assigns a routine and sees the feedback', async () => {
    const pro = await reg('coach2@x.com', 'pro');
    const { code } = (await call('GET', '/api/pro/code', pro)).body;
    expect(code).toMatch(/^[A-Z2-9]{8}$/);
    expect((await call('GET', '/api/pro/code', pro)).body.code).toBe(code);
    const { t } = await athleteWithPlan('alumno@x.com');
    expect((await call('POST', '/api/links/join-code', t, { code: 'ZZZZZZZZ' })).status).toBe(404);
    expect((await call('POST', '/api/links/join-code', t, { code })).body.ok).toBe(true);
    const ath = (await call('GET', '/api/pro/athletes', pro)).body[0];
    expect(ath.name).toBe('alumno');
    const tpl = await call('POST', '/api/pro/templates', pro, routine);
    expect(tpl.status).toBe(200);
    expect((await call('GET', '/api/pro/templates', pro)).body[0].days).toHaveLength(2);
    const asg = await call('POST', `/api/pro/templates/${tpl.body.id}/assign`, pro, { athleteId: ath.id });
    expect(asg.body.planVersion).toBe(2);
    const plan = (await call('GET', '/api/plan', t)).body;
    expect(plan.proName).toBe('coach2');
    expect(plan.plan.days[0].items[0].exerciseId).toBe('back_squat');
    await call('POST', '/api/workouts', t, { dayIndex: 0, fatigue: 6, items: [{ exerciseId: 'back_squat', sets: [{ weight: 60, reps: 5, rir: 2 }, { weight: 60, reps: 4, rir: 1 }] }] });
    const fb = (await call('GET', `/api/pro/athletes/${ath.id}/training-feedback`, pro)).body;
    expect(fb.workouts[0].exercises[0]).toMatchObject({ exerciseId: 'back_squat', sets: 2 });
    expect(fb.workouts[0].fatigue).toBe(6);
  });
  it('validates routines, scopes them to their owner, and requires an active link to assign', async () => {
    const pro = await reg('c3@x.com', 'pro'), other = await reg('c4@x.com', 'pro');
    expect((await call('POST', '/api/pro/templates', pro, { ...routine, days: [{ name: 'x', kind: 'strength', items: [{ exerciseId: 'not_an_exercise', sets: 3, repMin: 8, repMax: 10 }] }] })).status).toBe(400);
    expect((await call('POST', '/api/pro/templates', pro, { ...routine, days: [{ name: 'x', kind: 'strength', items: [] }] })).status).toBe(400);
    const id = (await call('POST', '/api/pro/templates', pro, routine)).body.id;
    expect((await call('PUT', `/api/pro/templates/${id}`, other, routine)).status).toBe(404);
    expect((await call('DELETE', `/api/pro/templates/${id}`, other)).status).toBe(404);
    const { t } = await athleteWithPlan('x1@x.com');
    const me = (await call('GET', '/api/me', t)).body;
    expect((await call('POST', `/api/pro/templates/${id}/assign`, pro, { athleteId: me.id })).status).toBe(404);
    expect((await call('PUT', `/api/pro/templates/${id}`, pro, { ...routine, name: 'Nuevo' })).status).toBe(200);
    expect((await call('DELETE', `/api/pro/templates/${id}`, pro)).status).toBe(200);
  });
  it('joining by code needs the share_with_pro permission, and rotating the code invalidates the old one', async () => {
    const pro = await reg('c5@x.com', 'pro');
    const old = (await call('GET', '/api/pro/code', pro)).body.code;
    const nu = (await call('POST', '/api/pro/code/rotate', pro)).body.code;
    expect(nu).not.toBe(old);
    const t = await reg('s1@x.com', 'athlete');
    await call('PUT', '/api/consents', t, { terms: true, health_data: true, share_with_pro: false });
    expect((await call('POST', '/api/links/join-code', t, { code: nu })).status).toBe(403);
    await call('PUT', '/api/consents', t, { share_with_pro: true });
    expect((await call('POST', '/api/links/join-code', t, { code: old })).status).toBe(404);
    expect((await call('POST', '/api/links/join-code', t, { code: nu })).status).toBe(200);
  });
});

describe('dual mode: one account, athlete and professional', () => {
  it('a professional can switch to athlete mode and back, with permissions following the mode', async () => {
    const t = await reg('dual@x.com', 'pro');
    expect((await call('GET', '/api/me', t)).body).toMatchObject({ mode: 'pro', canPro: true });
    expect((await call('GET', '/api/plan', t)).status).toBe(403);
    expect((await call('POST', '/api/me/mode', t, { mode: 'athlete' })).body.mode).toBe('athlete');
    expect((await call('GET', '/api/plan', t)).status).toBe(200);
    expect((await call('GET', '/api/pro/athletes', t)).status).toBe(403);
    await call('POST', '/api/me/mode', t, { mode: 'pro' });
    expect((await call('GET', '/api/pro/athletes', t)).status).toBe(200);
  });
  it('an athlete must enable professional mode first; the choice persists across logins', async () => {
    const t = await reg('later@x.com', 'athlete');
    expect((await call('POST', '/api/me/mode', t, { mode: 'pro' })).status).toBe(403);
    await call('POST', '/api/me/pro', t);
    await call('POST', '/api/me/mode', t, { mode: 'pro' });
    const t2 = (await call('POST', '/api/auth/login', undefined, { email: 'later@x.com', password: 'password123' })).body.token;
    expect((await call('GET', '/api/me', t2)).body.mode).toBe('pro');
  });
  it('a professional who is also an athlete can be invited like anyone else, but not link to themselves', async () => {
    const pro = await reg('boss@x.com', 'pro');
    await call('POST', '/api/pro/invites', pro, { email: 'boss@x.com' });
    await call('POST', '/api/me/mode', pro, { mode: 'athlete' });
    expect((await call('GET', '/api/links', pro)).body).toEqual([]);
  });
});

describe('admin telemetry', () => {
  const setup = async () => {
    app = buildApp({ db, rateLimitMax: 100000, adminEmails: ['Founder@X.com'] });
    const admin = await reg('founder@x.com', 'athlete');
    return admin;
  };
  it('is only for configured admin emails and exposes aggregates, not health data', async () => {
    const admin = await setup();
    const user = await reg('someone@x.com', 'athlete');
    expect((await call('GET', '/api/admin/stats', user)).status).toBe(403);
    expect((await call('GET', '/api/me', admin)).body.isAdmin).toBe(true);
    expect((await call('GET', '/api/me', user)).body.isAdmin).toBe(false);
    const s = (await call('GET', '/api/admin/stats', admin)).body;
    expect(s.users.total).toBe(2);
    expect(s.users.newToday).toBe(2);
    expect(s.activity.dau).toBeGreaterThanOrEqual(1);
    expect(s.series).toHaveLength(30);
    expect(s.series[29].signups).toBe(2);
    expect(JSON.stringify(s)).not.toMatch(/weight|kcal|route/i);
  });
  it('counts usage and lists/searches accounts', async () => {
    const admin = await setup();
    const { t } = await athleteWithPlan('ana2@x.com');
    await call('POST', '/api/workouts', t, sessionFor((await call('GET', '/api/plan', t)).body.plan, 10, 2));
    const s = (await call('GET', '/api/admin/stats', admin)).body;
    expect(s.usage30d.workouts).toBe(1);
    expect(s.usage30d.assessments).toBe(1);
    expect(s.subscription.trialActive).toBe(2);
    const list = (await call('GET', '/api/admin/users?q=ana2', admin)).body;
    expect(list.total).toBe(1);
    expect(list.users[0].email).toBe('ana2@x.com');
    expect(list.users[0].pass_hash).toBeUndefined();
  });
});

describe('privacy', () => {
  it('export and delete', async () => {
    const { t } = await athleteWithPlan();
    const ex = (await call('GET', '/api/export', t)).body;
    expect(ex.assessments).toHaveLength(1);
    expect((await call('DELETE', '/api/me', t)).status).toBe(200);
    expect((await call('GET', '/api/me', t)).status).toBe(401);
    expect((await call('POST', '/api/auth/login', undefined, { email: 'ana@x.com', password: 'password123' })).status).toBe(401);
  });
});
