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

describe('gym business: owner, staff, athletes and retention metrics',()=>{
 it('creates a beta gym, safely invites trainer and athlete, aggregates their sessions and isolates organizations',async()=>{
   const owner=await reg('gym-owner@example.com','pro');
   const trainer=await reg('gym-trainer@example.com','pro');
   const {t:athlete,plan}=await athleteWithPlan('gym-athlete@example.com');
   const other=await reg('other-owner@example.com','pro');
   const created=await call('POST','/api/gyms',owner,{name:'Academia Cafayate',city:'Cafayate',area:'Centro'});
   expect(created.status).toBe(200);expect(created.body.plan).toBe('beta_free');
   const id=created.body.id;
   expect((await call('GET',`/api/gyms/${id}`,other)).status).toBe(404);
   expect((await call('POST',`/api/gyms/${id}/invite`,other,{email:'gym-athlete@example.com',memberType:'athlete'})).status).toBe(404);
   expect((await call('POST',`/api/gyms/${id}/invite`,owner,{email:'gym-trainer@example.com',memberType:'coach'})).status).toBe(200);
   expect((await call('POST',`/api/gyms/${id}/invite`,owner,{email:'gym-athlete@example.com',memberType:'athlete'})).status).toBe(200);
   expect((await call('GET','/api/gyms/invitations',trainer)).body.invitations).toHaveLength(1);
   expect((await call('GET','/api/gyms/invitations',athlete)).body.invitations).toHaveLength(1);
   expect((await call('POST',`/api/gyms/${id}/invitations/accept`,trainer)).status).toBe(200);
   expect((await call('POST',`/api/gyms/${id}/invitations/accept`,athlete)).status).toBe(200);
   const athId=(await call('GET','/api/me',athlete)).body.id;
   const coachId=(await call('GET','/api/me',trainer)).body.id;
   expect((await call('PUT',`/api/gyms/${id}/members/${athId}/assign`,trainer,{coachId})).status).toBe(403);
   expect((await call('PUT',`/api/gyms/${id}/members/${athId}/assign`,owner,{coachId})).status).toBe(200);
   await call('POST','/api/workouts',athlete,sessionFor(plan,10,2));
   const view=(await call('GET',`/api/gyms/${id}`,owner)).body;
   expect(view.members).toHaveLength(2);
   expect(view.activity[0].sessions30).toBeGreaterThan(0);
   expect((await call('GET',`/api/gyms/${id}`,trainer)).body.members.filter((x:any)=>x.member_type==='athlete')).toHaveLength(1);
   expect((await call('GET','/api/gyms/plans',owner)).body.checkoutEnabled).toBe(false);
   // Revoking the sharing consent must immediately remove athlete data from staff.
   await call('PUT','/api/consents',athlete,{share_with_pro:false});
   expect((await call('GET',`/api/gyms/${id}`,trainer)).body.members.filter((x:any)=>x.member_type==='athlete')).toHaveLength(0);
   expect((await call('POST',`/api/gyms/${id}/members/${coachId}/remove`,owner)).status).toBe(200);
   expect((await call('GET',`/api/gyms/${id}`,trainer)).status).toBe(404);
 });
 it('requires the athlete to consent before joining and prevents coach from seeing another gym',async()=>{
   const owner=await reg('gym-2-owner@example.com','pro');
   const athlete=await reg('gym-2-athlete@example.com','athlete');
   const created=await call('POST','/api/gyms',owner,{name:'Centro Deporte',city:'Salta'});
   const id=created.body.id;
   await call('POST',`/api/gyms/${id}/invite`,owner,{email:'gym-2-athlete@example.com',memberType:'athlete'});
   expect((await call('POST',`/api/gyms/${id}/invitations/accept`,athlete)).status).toBe(403);
   await call('PUT','/api/consents',athlete,{share_with_pro:true});
   expect((await call('POST',`/api/gyms/${id}/invitations/accept`,athlete)).status).toBe(200);
   expect((await call('POST',`/api/gyms/${id}/invitations/accept`,athlete)).status).toBe(404);
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

describe('routine library, mesocycle and returning after a break', () => {
  it('generated plans carry a 4-week block that starts in the base week', async () => {
    const { t } = await athleteWithPlan();
    const p = (await call('GET', '/api/plan', t)).body;
    expect(p.current).toMatchObject({ label: 'base', weekIndex: 0, weekCount: 4, ramp: false });
    expect(p.away.gapDays).toBe(0);
  });
  it('adopting a multi-week routine creates a program plan; strength routines get a mesocycle', async () => {
    const { t } = await athleteWithPlan();
    expect((await call('POST', '/api/plan/adopt', t, { routineId: 'nope' })).status).toBe(404);
    const r = await call('POST', '/api/plan/adopt', t, { routineId: 'c25k_9w' });
    expect(r.body.planVersion).toBe(2);
    const p = (await call('GET', '/api/plan', t)).body;
    expect(p.routineId).toBe('c25k_9w');
    expect(p.current).toMatchObject({ label: 'program', weekIndex: 0, weekCount: 9 });
    expect(p.plan.days).toHaveLength(3);
    expect(p.plan.days[0].kind).toBe('cardio');
    await call('POST', '/api/plan/adopt', t, { routineId: 'ul4_gym' });
    const p2 = (await call('GET', '/api/plan', t)).body;
    expect(p2.plan.days).toHaveLength(4);
    expect(p2.current.label).toBe('base');
    // logging against a routine plan works, and the first session seeds loads
    const s = await call('POST', '/api/workouts', t, { dayIndex: 0, fatigue: 5, items: [{ exerciseId: 'bench_press', sets: [{ weight: 60, reps: 7, rir: 2 }] }] });
    expect(s.body.applied).toBe(true);
  });
  it('after a break the athlete can resume, ramp back gently, or restart', async () => {
    const { t } = await athleteWithPlan();
    // age the plan 30 days to simulate time away
    await db.prepare('UPDATE plans SET created_at=?').run(new Date(Date.now() - 30 * 864e5).toISOString());
    const p = (await call('GET', '/api/plan', t)).body;
    expect(p.away.gapDays).toBeGreaterThanOrEqual(29);
    expect(p.away.options).toMatchObject({ weeks: 2, setsMult: 0.7 });
    const r = await call('POST', '/api/plan/return', t, { mode: 'adapted' });
    expect(r.body.planVersion).toBe(2);
    const p2 = (await call('GET', '/api/plan', t)).body;
    expect(p2.current.ramp).toBe(true);
    expect(p2.source).toBe('return:adapted');
    // while the ramp is active, sessions are logged but loads are not changed
    const s = await call('POST', '/api/workouts', t, sessionFor(p2.plan, 12, 3));
    expect(s.body.adaptation).toBe('paused');
    expect((await call('POST', '/api/plan/return', t, { mode: 'restart' })).status).toBe(200);
    expect((await call('GET', '/api/plan', t)).body.current.ramp).toBe(false);
    expect((await call('POST', '/api/plan/return', t, { mode: 'resume' })).status).toBe(200);
    expect((await call('POST', '/api/plan/return', t, { mode: 'bogus' })).status).toBe(400);
  });
  it('same-day advice follows a fresh recovery check-in', async () => {
    const { t } = await athleteWithPlan();
    expect((await call('GET', '/api/plan', t)).body.advice).toBeNull();
    await call('POST', '/api/recovery', t, { sleepHours: 4, fatigue: 9, stress: 8, pain: 2 });
    expect((await call('GET', '/api/plan', t)).body.advice).toMatchObject({ mode: 'light' });
    await call('POST', '/api/recovery', t, { sleepHours: 8, fatigue: 2, stress: 2, pain: 8 });
    expect((await call('GET', '/api/plan', t)).body.advice).toMatchObject({ mode: 'rest', reason: 'pain' });
  });
});

describe('progress: lifts, running, body measurements', () => {
  it('builds per-exercise series with estimated 1RM', async () => {
    const { t, plan } = await athleteWithPlan();
    const ex = plan.days[0].items[0].exerciseId;
    for (const w of [40, 45]) await call('POST', '/api/workouts', t, { dayIndex: 0, fatigue: 5, items: [{ exerciseId: ex, sets: [{ weight: w, reps: 8, rir: 2 }, { weight: w, reps: 7, rir: 1 }] }] });
    const list = (await call('GET', '/api/progress/exercises', t)).body.exercises;
    expect(list[0]).toMatchObject({ id: ex, sessions: 2 });
    const s = (await call('GET', `/api/progress/exercise/${ex}`, t)).body.series;
    expect(s).toHaveLength(2);
    expect(s[1].topWeight).toBe(45);
    expect(s[1].e1rm).toBeGreaterThan(s[0].e1rm);
    expect(s[0].volume).toBe(40 * 8 + 40 * 7);
  });
  it('summarises running by week', async () => {
    const { t } = await athleteWithPlan();
    const base = { sport: 'run', startedAt: new Date().toISOString(), movingSec: 1800, elevGainM: 0, route: [] as number[][] };
    await call('POST', '/api/activities', t, { ...base, durationSec: 1800, distanceM: 5000, avgPaceSecKm: 360 });
    await call('POST', '/api/activities', t, { ...base, durationSec: 3300, distanceM: 10000, avgPaceSecKm: 330 });
    const r = (await call('GET', '/api/progress/running', t)).body;
    expect(r.series).toHaveLength(1);
    expect(r.series[0]).toMatchObject({ runKm: 15, runs: 2 });
    expect(r.series[0].avgPaceSecKm).toBe(Math.round((1800 + 3300) / 15));
    expect(r.longestRunKm).toBe(10);
    expect(r.fastestPaceSecKm).toBe(330);
  });
  it('stores measurements, rejects empties, imports weights without duplicates, and can refresh calorie targets', async () => {
    const { t } = await athleteWithPlan();
    expect((await call('POST', '/api/measurements', t, {})).status).toBe(400);
    expect((await call('POST', '/api/measurements', t, { weightKg: 5 })).status).toBe(400);
    const before = (await call('GET', '/api/day', t)).body.target.kcal;
    const r = await call('POST', '/api/measurements', t, { weightKg: 95, waistCm: 90, source: 'scale', applyToProfile: true });
    expect(r.body.targetUpdated).toBe(true);
    expect((await call('GET', '/api/day', t)).body.target.kcal).toBeGreaterThan(before);
    const bulk = await call('POST', '/api/measurements/bulk', t, { rows: [{ day: '2026-09-01', weightKg: 80 }, { day: '2026-09-02', weightKg: 79.5 }] });
    expect(bulk.body).toEqual({ added: 2, skipped: 0 });
    expect((await call('POST', '/api/measurements/bulk', t, { rows: [{ day: '2026-09-01', weightKg: 80 }] })).body).toEqual({ added: 0, skipped: 1 });
    const m = (await call('GET', '/api/measurements', t)).body;
    expect(m.entries.map((e: any) => e.day).slice(0, 2)).toEqual(['2026-09-01', '2026-09-02']);
    expect(m.latest).toMatchObject({ weightKg: 95, waistCm: 90 });
    const other = await athleteWithPlan('o1@x.com');
    expect((await call('DELETE', `/api/measurements/${m.entries[0].id}`, other.t)).status).toBe(404);
    expect((await call('DELETE', `/api/measurements/${m.entries[0].id}`, t)).status).toBe(200);
  });
});

describe('free sessions, previous performance and goals', () => {
  it('logs a one-off session without a plan and without touching the plan', async () => {
    const t = await reg('free@x.com', 'athlete');
    await call('PUT', '/api/consents', t, allConsents);
    const r = await call('POST', '/api/workouts', t, { dayIndex: 99, name: 'Pecho y tríceps', fatigue: 4, items: [{ exerciseId: 'bench_press', sets: [{ weight: 50, reps: 8, rir: 2 }] }] });
    expect(r.body).toMatchObject({ free: true, applied: false });
    expect((await call('GET', '/api/plan', t)).body.plan).toBeNull();
    expect((await call('GET', '/api/progress/exercises', t)).body.exercises[0]).toMatchObject({ id: 'bench_press', sessions: 1 });
  });
  it('returns the last sets per exercise', async () => {
    const { t } = await athleteWithPlan();
    await call('POST', '/api/workouts', t, { dayIndex: 99, fatigue: 4, items: [{ exerciseId: 'bench_press', sets: [{ weight: 50, reps: 8, rir: 2 }] }] });
    await call('POST', '/api/workouts', t, { dayIndex: 99, fatigue: 4, items: [{ exerciseId: 'bench_press', sets: [{ weight: 55, reps: 6, rir: 1 }] }] });
    const l = (await call('GET', '/api/progress/last?ids=bench_press,unknown', t)).body.last;
    expect(l.bench_press.sets[0]).toMatchObject({ weight: 55, reps: 6 });
    expect(l.unknown).toBeUndefined();
  });
  it('stores a primary goal, secondary goals and measurable targets', async () => {
    const t = await reg('goals@x.com', 'athlete');
    await call('PUT', '/api/consents', t, allConsents);
    const body = { ...assessment, secondaryGoals: ['endurance'], targets: [{ metric: 'weight', targetKg: 58, byDate: '2027-02-01' }, { metric: 'run5k', targetSec: 1700 }, { metric: 'lift', exerciseId: 'back_squat', targetKg: 80 }] };
    expect((await call('POST', '/api/assessment', t, body)).status).toBe(200);
    const a = (await call('GET', '/api/assessment', t)).body.assessment;
    expect(a.secondaryGoals).toEqual(['endurance']);
    expect(a.targets).toHaveLength(3);
    expect((await call('POST', '/api/assessment', t, { ...body, targets: [{ metric: 'run5k', targetSec: 100 }] })).status).toBe(400);
    expect((await call('POST', '/api/assessment', t, { ...body, targets: [{ metric: 'mystery', x: 1 }] })).status).toBe(400);
  });
});

describe('week status and goals', () => {
  it('marks done sessions of the week and points to the next one', async () => {
    const { t, plan } = await athleteWithPlan();
    expect((await call('GET', '/api/plan', t)).body.week).toEqual({ doneDays: [], nextIndex: 0 });
    await call('POST', '/api/workouts', t, sessionFor(plan, 10, 2));
    expect((await call('GET', '/api/plan', t)).body.week).toEqual({ doneDays: [0], nextIndex: 1 });
  });
  it('tracks weight, 5K and lift targets honestly', async () => {
    const t = await reg('g2@x.com', 'athlete');
    await call('PUT', '/api/consents', t, allConsents);
    await call('POST', '/api/assessment', t, { ...assessment, profile: { ...profile, weightKg: 80 }, targets: [{ metric: 'weight', targetKg: 70 }, { metric: 'run5k', targetSec: 1500 }, { metric: 'lift', exerciseId: 'bench_press', targetKg: 100 }] });
    await call('POST', '/api/measurements', t, { weightKg: 77, day: '2026-10-20' });
    await call('POST', '/api/activities', t, { sport: 'run', startedAt: new Date().toISOString(), durationSec: 1800, movingSec: 1800, distanceM: 5000, avgPaceSecKm: 360, elevGainM: 0, route: [] });
    await call('POST', '/api/workouts', t, { dayIndex: 99, fatigue: 4, items: [{ exerciseId: 'bench_press', sets: [{ weight: 60, reps: 5, rir: 2 }] }] });
    const g = (await call('GET', '/api/goals', t)).body;
    expect(g.targets[0]).toMatchObject({ metric: 'weight', current: 77, pct: 30 });
    expect(g.targets[1]).toMatchObject({ metric: 'run5k', current: 1800, pct: 83, projected: true });
    expect(g.targets[2].current).toBeCloseTo(70, 0);
    expect(g.targets[2].pct).toBe(70);
  });
  it('counts strength sessions in today\'s energy estimate', async () => {
    const { t, plan } = await athleteWithPlan();
    const before = (await call('GET', '/api/energy/today?timezoneOffset=0', t)).body.exerciseKcal;
    await call('POST', '/api/workouts', t, sessionFor(plan, 10, 2));
    const after = (await call('GET', '/api/energy/today?timezoneOffset=0', t)).body.exerciseKcal;
    expect(after).toBeGreaterThan(before);
  });
});

describe('weekly challenges and opt-in zone ranking', () => {
  it('serves 3 challenges anchored on 150 active minutes, with live progress', async () => {
    const { t } = await athleteWithPlan();
    await call('POST', '/api/activities', t, { sport: 'run', startedAt: new Date().toISOString(), durationSec: 3600, movingSec: 3600, distanceM: 10000, avgPaceSecKm: 360, elevGainM: 0, route: [] });
    const c = (await call('GET', '/api/challenges', t)).body;
    expect(c.challenges).toHaveLength(3);
    expect(c.challenges[0]).toMatchObject({ id: 'move_150', value: 60, pct: 40, done: false });
    expect(c.metrics.runKm).toBe(10);
    expect(c.points).toBeGreaterThan(0);
  });
  it('is off by default, needs an alias and zone, never exposes emails, and waits for a minimum zone size', async () => {
    const mk = async (email: string, alias: string, zone = 'Villa Crespo') => { const { t } = await athleteWithPlan(email); const r = await call('PUT', '/api/ranking', t, { enabled: true, alias, zone }); return { t, r }; };
    const { t } = await athleteWithPlan('r0@x.com');
    expect((await call('GET', '/api/ranking', t)).body.enabled).toBe(false);
    expect((await call('PUT', '/api/ranking', t, { enabled: true, alias: 'ab', zone: 'x' })).status).toBe(400);
    expect((await call('PUT', '/api/ranking', t, { enabled: true, alias: 'a@b.com', zone: 'Palermo' })).status).toBe(400);
    const a = await mk('r1@x.com', 'corredor_1'), b = await mk('r2@x.com', 'runner-2', 'villa  crespo');
    expect((await call('GET', '/api/ranking', a.t)).body.leaderboard).toBeNull();
    const dup = await mk('r3@x.com', 'corredor_1');
    expect(dup.r.status).toBe(409);
    const c3 = await mk('r4@x.com', 'tercero');
    const lb = (await call('GET', '/api/ranking', c3.t)).body;
    expect(lb.zoneSize).toBe(3);
    expect(lb.leaderboard).toHaveLength(3);
    expect(lb.leaderboard.some((x: any) => x.me)).toBe(true);
    expect(JSON.stringify(lb)).not.toMatch(/@|r[0-9]@x|weight|kcal/i);
    expect((await call('PUT', '/api/ranking', b.t, { enabled: false })).body.enabled).toBe(false);
    expect((await call('GET', '/api/ranking', b.t)).body.enabled).toBe(false);
    expect((await call('GET', '/api/ranking', c3.t)).body.leaderboard).toBeNull();
  });
});

describe('coach memory and personality', () => {
  const tagged = async (sys: string) => (sys.includes('Tone: concise') ? 'Directo. ' : 'Hola. ') + '[[memory: lesion=rodilla izquierda operada]]';
  it('stores preferences, validates tone, and is editable and deletable by the user', async () => {
    const { t } = await athleteWithPlan();
    expect((await call('PUT', '/api/coach/memory', t, { key: 'coach_tone', value: 'sarcastic' })).status).toBe(400);
    expect((await call('PUT', '/api/coach/memory', t, { key: 'Bad Key', value: 'x' })).status).toBe(400);
    expect((await call('PUT', '/api/coach/memory', t, { key: 'coach_tone', value: 'direct' })).status).toBe(200);
    await call('PUT', '/api/coach/memory', t, { key: 'dias_libres', value: 'martes y jueves' });
    const m = (await call('GET', '/api/coach/memory', t)).body;
    expect(m.memory.map((x: any) => x.key).sort()).toEqual(['coach_tone', 'dias_libres']);
    expect((await call('DELETE', '/api/coach/memory/dias_libres', t)).status).toBe(200);
    expect((await call('DELETE', '/api/coach/memory/dias_libres', t)).status).toBe(404);
  });
  it('the coach adapts tone, learns facts only with consent, remembers across messages and never re-asks decisions', async () => {
    const seen: { sys: string; n: number }[] = [];
    app = buildApp({ db, rateLimitMax: 100000, coach: async (sys, msgs) => { seen.push({ sys, n: msgs.length }); return tagged(sys); } });
    const { t } = await athleteWithPlan();
    await call('PUT', '/api/coach/memory', t, { key: 'coach_tone', value: 'direct' });
    // without ai_memory: tone applies, nothing is stored or shared
    const r1 = (await call('POST', '/api/coach', t, { message: 'hola' })).body;
    expect(r1.reply).toBe('Directo.');
    expect(r1.remembered).toEqual([]);
    expect((await call('GET', '/api/coach/history', t)).body.messages).toHaveLength(0);
    expect(seen[0]!.sys).toContain('Tone: concise');
    expect(seen[0]!.sys).not.toContain('Known decisions');
    // with consent: fact saved, messages persisted, and fed back next time
    await call('PUT', '/api/consents', t, { ai_memory: true });
    const r2 = (await call('POST', '/api/coach', t, { message: 'me operaron la rodilla' })).body;
    expect(r2.remembered).toEqual(['lesion']);
    expect(r2.reply).not.toContain('[[');
    await call('POST', '/api/coach', t, { message: 'qué entreno hoy?' });
    expect(seen[2]!.sys).toContain('lesion=rodilla izquierda operada');
    expect(seen[2]!.sys).toContain('do NOT ask');
    expect(seen[2]!.n).toBe(3); // 2 persisted turns + the new message
    expect((await call('GET', '/api/coach/history', t)).body.messages.length).toBe(4);
    expect((await call('DELETE', '/api/coach/memory', t)).status).toBe(200);
    expect((await call('GET', '/api/coach/memory', t)).body.memory).toEqual([]);
    expect((await call('GET', '/api/coach/history', t)).body.messages).toEqual([]);
  });
});

describe('daily budget, AI meal interpretation, menu rotation and water', () => {
  it('builds the food budget step by step: basal + daily life + logged exercise + goal adjustment', async () => {
    const { t, plan } = await athleteWithPlan();
    const d0 = (await call('GET', '/api/day', t)).body;
    const e0 = d0.energy;
    expect(e0.bmr).toBeGreaterThan(1000);
    expect(e0.neat).toBe(d0.target.explain.lifeKcal - d0.target.explain.bmr);
    expect(e0.budget).toBe(Math.max(e0.bmr, Math.round(d0.target.explain.lifeKcal + e0.exercise + e0.goalAdjustment)));
    expect(e0.remaining).toBe(e0.budget);
    expect(e0.dayFraction).toBeGreaterThanOrEqual(0); expect(e0.dayFraction).toBeLessThanOrEqual(1);
    // exercise already done raises the budget; eating lowers what remains
    await call('POST', '/api/activities', t, { sport: 'run', startedAt: new Date().toISOString(), durationSec: 3000, movingSec: 3000, distanceM: 8000, avgPaceSecKm: 375, elevGainM: 0, route: [] });
    await call('POST', '/api/workouts', t, sessionFor(plan, 10, 2));
    await call('POST', '/api/nutrition/log', t, { items: [{ foodId: 'rice_white', grams: 200 }] });
    const e1 = (await call('GET', '/api/day', t)).body.energy;
    expect(e1.exercise).toBeGreaterThan(300);
    expect(e1.budget).toBeGreaterThan(e0.budget);
    expect(e1.remaining).toBe(e1.budget - 260);
    // a past day is complete (all of the basal counted)
    const y = new Date(Date.now() - 864e5).toISOString().slice(0, 10);
    expect((await call('GET', `/api/day?date=${y}`, t)).body.energy.dayFraction).toBe(1);
  });
  it('keeps water separate from the calorie counter and lets you undo it', async () => {
    const { t } = await athleteWithPlan();
    await call('POST', '/api/nutrition/log', t, { waterMl: 500, meal: 'water' });
    const w = await call('POST', '/api/nutrition/log', t, { waterMl: 250, meal: 'water' });
    await call('POST', '/api/nutrition/log', t, { items: [{ foodId: 'egg', grams: 100 }] });
    const d = (await call('GET', '/api/day', t)).body;
    expect(d.intake.waterMl).toBe(750);
    expect(d.intake.kcal).toBe(143);
    expect(d.waterLogs.map((x: any) => x.ml)).toEqual([500, 250]);
    await call('DELETE', `/api/nutrition/log/${w.body.id}`, t);
    expect((await call('GET', '/api/day', t)).body.intake.waterMl).toBe(500);
  });
  it('rotates the three daily menus on demand through all 30', async () => {
    const { t } = await athleteWithPlan();
    const seen = new Set<number>();
    for (let n = 0; n < 10; n++) (await call('GET', `/api/nutrition/menus?date=2026-10-25&shuffle=${n}`, t)).body.menus.forEach((m: any) => seen.add(m.index));
    expect(seen.size).toBe(30);
    const a = (await call('GET', '/api/nutrition/menus?date=2026-10-25&shuffle=0', t)).body.menus.map((m: any) => m.index);
    const b = (await call('GET', '/api/nutrition/menus?date=2026-10-25&shuffle=1', t)).body.menus.map((m: any) => m.index);
    expect(a).not.toEqual(b);
  });
  it('interprets free text with the rule parser when no AI is configured', async () => {
    const { t } = await athleteWithPlan();
    const r = (await call('POST', '/api/nutrition/interpret', t, { text: '200g de pollo con 150 g de arroz y una banana' })).body;
    expect(r.source).toBe('rules');
    expect(r.items.map((i: any) => i.foodId)).toEqual(['chicken_breast', 'rice_white', 'banana']);
    expect(r.total.kcal).toBe(330 + 195 + 107);
    expect(r.low).toBeLessThan(r.total.kcal); expect(r.high).toBeGreaterThan(r.total.kcal);
  });
  it('with AI: validates the model output, recomputes numbers itself, labels custom foods, and falls back safely', async () => {
    const ai = JSON.stringify({ items: [
      { raw: 'plato de milanesa con puré', foodId: 'milanesa_beef', grams: 160, confidence: 'medium' },
      { raw: 'puré de papas', foodId: null, grams: 200, confidence: 'low', custom: { name: 'Puré de papas', kcalPer100: 90, proteinPer100: 2, carbsPer100: 15, fatPer100: 2.5 } },
      { raw: 'x', foodId: 'ghost', grams: 50, confidence: 'high' },
      { raw: 'bad', foodId: 'egg', grams: 99999, confidence: 'high' },
    ] });
    app = buildApp({ db, rateLimitMax: 100000, coach: async () => 'Aquí tienes:\n' + ai });
    const { t } = await athleteWithPlan();
    const r = (await call('POST', '/api/nutrition/interpret', t, { text: 'milanesa con puré' })).body;
    expect(r.source).toBe('ai');
    expect(r.items).toHaveLength(3); // absurd grams discarded; an unknown id is returned unmatched so the user can pick manually
    expect(r.items[2]).toMatchObject({ foodId: null, grams: 0, kcal: 0 });
    expect(r.total.kcal).toBe(464 + 180);
    expect(r.items[0]).toMatchObject({ foodId: 'milanesa_beef', grams: 160, kcal: Math.round(290 * 1.6) });
    expect(r.items[1]).toMatchObject({ foodId: null, name: 'Puré de papas', kcal: 180, custom: { kcalPer100: 90 } });
    expect((r.items[1].high - r.items[1].low) / r.items[1].kcal).toBeGreaterThan((r.items[0].high - r.items[0].low) / r.items[0].kcal); // custom, low confidence ⇒ wider relative range
    // custom foods can be logged; totals come from the server
    const log = await call('POST', '/api/nutrition/log', t, { items: [{ foodId: 'milanesa_beef', grams: 160 }], custom: [{ name: 'Puré de papas', grams: 200, kcalPer100: 90, proteinPer100: 2, carbsPer100: 15, fatPer100: 2.5 }] });
    expect(log.body.kcal).toBe(464 + 180);
    expect(log.body.items.some((i: any) => i.custom)).toBe(true);
    // a model that returns garbage or throws never breaks the feature
    app = buildApp({ db, rateLimitMax: 100000, coach: async () => 'no json here' });
    const f1 = (await call('POST', '/api/nutrition/interpret', t, { text: '2 huevos' })).body;
    expect(f1.source).toBe('rules_fallback'); expect(f1.items[0].foodId).toBe('egg');
    app = buildApp({ db, rateLimitMax: 100000, coach: async () => { throw new Error('down'); } });
    expect((await call('POST', '/api/nutrition/interpret', t, { text: '2 huevos' })).body.source).toBe('rules_fallback');
  });
});

describe('manual activities and food: add what you did elsewhere, and remove mistakes', () => {
  it('adds a run recorded in another app with the user\'s own calories, counts it in the day, and can delete it', async () => {
    const { t } = await athleteWithPlan();
    const base = (await call('GET', '/api/day', t)).body.energy;
    const r = await call('POST', '/api/activities', t, { sport: 'run', source: 'manual', startedAt: new Date().toISOString(), durationSec: 2700, movingSec: 2700, distanceM: 8000, avgPaceSecKm: 0, elevGainM: 0, route: [], kcal: 640 });
    expect(r.body.estimatedKcal).toBe(640);
    const list = (await call('GET', '/api/activities', t)).body.activities;
    expect(list[0]).toMatchObject({ estimated_kcal: 640, manual: true, distance_m: 8000 });
    expect(list[0].avg_pace_sec_km).toBe(Math.round((2700 * 1000) / 8000));
    const after = (await call('GET', '/api/day', t)).body.energy;
    expect(after.exercise).toBe(640);
    expect(after.budget).toBe(base.budget + 640);
    expect((await call('GET', '/api/energy/today?timezoneOffset=0', t)).body.exerciseKcal).toBeGreaterThanOrEqual(640);
    expect((await call('DELETE', `/api/activities/${r.body.id}`, t)).status).toBe(200);
    expect((await call('GET', '/api/activities', t)).body.activities).toHaveLength(0);
    expect((await call('GET', '/api/day', t)).body.energy.exercise).toBe(0);
    expect((await call('DELETE', `/api/activities/${r.body.id}`, t)).status).toBe(404);
  });
  it('a user cannot delete someone else\'s activity', async () => {
    const a = await athleteWithPlan('m1@x.com'), b = await athleteWithPlan('m2@x.com');
    const r = await call('POST', '/api/activities', a.t, { sport: 'walk', source: 'manual', startedAt: new Date().toISOString(), durationSec: 1800, movingSec: 1800, distanceM: 2000, avgPaceSecKm: 0, elevGainM: 0, route: [] });
    expect((await call('DELETE', `/api/activities/${r.body.id}`, b.t)).status).toBe(404);
  });
  it('adds a food by calories (manual) and removes it, restoring the balance', async () => {
    const { t } = await athleteWithPlan();
    const before = (await call('GET', '/api/day', t)).body.energy.remaining;
    const r = await call('POST', '/api/nutrition/log', t, { meal: 'Almuerzo en un restaurante', kcal: 900, proteinG: 40, mealType: 'lunch' });
    expect((await call('GET', '/api/day', t)).body.energy.remaining).toBe(before - 900);
    await call('DELETE', `/api/nutrition/log/${r.body.id}`, t);
    expect((await call('GET', '/api/day', t)).body.energy.remaining).toBe(before);
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

describe('end-to-end professional and athlete lifecycle',()=>{
 it('enables both modes, links by code, assigns and retains a professional plan through workouts, reassessment and login',async()=>{
  const coach=await reg('coachdual@x.com','athlete');
  await call('PUT','/api/consents',coach,allConsents);
  expect((await call('POST','/api/me/pro',coach)).status).toBe(200);
  expect((await call('POST','/api/me/mode',coach,{mode:'pro'})).status).toBe(200);
  const code=(await call('GET','/api/pro/code',coach)).body.code;
  expect(code).toMatch(/^[A-Z2-9]{8}$/);
  const {t:student}=await athleteWithPlan('dualstudent@x.com');
  const joined=await call('POST','/api/links/join-code',student,{code});
  expect(joined.status).toBe(200);
  const athlete=(await call('GET','/api/pro/athletes',coach)).body[0];
  const routine={name:'Circuito de prueba',goal:'strength',days:[
    {name:'Fuerza',kind:'strength',items:[{exerciseId:'back_squat',sets:3,repMin:5,repMax:8,rirTarget:2,load:50}]},
    {name:'Cardio',kind:'cardio',items:[],cardio:{modality:'run',type:'zone2',durationMin:30}}
  ]};
  const template=await call('POST','/api/pro/templates',coach,routine);
  expect(template.status).toBe(200);
  expect((await call('POST',`/api/pro/templates/${template.body.id}/assign`,coach,{athleteId:athlete.id})).status).toBe(200);
  expect((await call('GET','/api/plan',student)).body.proName).toBe('coachdual');
  const invalid=await call('POST','/api/workouts',student,{dayIndex:1,items:[{exerciseId:'back_squat',sets:[{weight:50,reps:6,rir:2}]}]});
  expect(invalid.status).toBe(400);
  expect((await call('GET','/api/progress',student)).body.total).toBe(0);
  const workout=await call('POST','/api/workouts',student,{dayIndex:0,fatigue:4,items:[{exerciseId:'back_squat',sets:[{weight:50,reps:6,rir:2}]}]});
  expect(workout.status).toBe(200);
  expect((await call('GET','/api/plan',student)).body.proName).toBe('coachdual');
  const reassessed=await call('POST','/api/assessment',student,{...assessment,goal:'recomposition'});
  expect(reassessed.status).toBe(200);
  expect(reassessed.body.professionalPlanPreserved).toBe(true);
  expect((await call('GET','/api/plan',student)).body.plan.days[0].items[0].exerciseId).toBe('back_squat');
  const feedback=await call('GET',`/api/pro/athletes/${athlete.id}/training-feedback`,coach);
  expect(feedback.status).toBe(200);
  expect(feedback.body.workouts).toHaveLength(1);
  await call('POST','/api/me/mode',coach,{mode:'athlete'});
  expect((await call('GET','/api/pro/athletes',coach)).status).toBe(403);
  expect((await call('GET','/api/plan',coach)).status).toBe(200);
  await call('POST','/api/me/mode',coach,{mode:'pro'});
  const relogin=await call('POST','/api/auth/login',undefined,{email:'coachdual@x.com',password:'password123'});
  expect((await call('GET','/api/me',relogin.body.token)).body.mode).toBe('pro');
  expect((await call('GET','/api/pro/athletes',relogin.body.token)).body).toHaveLength(1);
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

describe('weekly ranking opt-in',()=>{
 it('requires authentication and keeps non-participants private',async()=>{
   const anon=await call('GET','/api/rankings/weekly?metric=run_distance');
   expect(anon.status).toBe(401);
   const {t}=await athleteWithPlan();
   const result=await call('GET','/api/rankings/weekly?metric=run_distance',t);
   expect(result.status).toBe(200);
   expect(result.body.entries).toEqual([]);
 });
});
describe('professional network and four account modes',()=>{
 it('requires admin authorization and hides unverified professionals',async()=>{
   const token=await reg('nanogm.test@x.com','athlete');
   const profile={category:'medical',displayName:'Mariano Jiménez',specialty:'Medicina del ejercicio',credentials:'Médico',license:'Matrícula pendiente de validación',description:'Consultas de entrenamiento y salud',phone:'5493875466419',city:'Cafayate',area:'Vertientes',modality:'both',lat:null,lon:null,published:true};
   expect((await call('POST','/api/me/mode',token,{mode:'admin'})).status).toBe(403);
   expect((await call('POST','/api/me/mode',token,{mode:'medical'})).status).toBe(403);
   expect((await call('PUT','/api/profiles/me',token,profile)).status).toBe(200);
   expect((await call('POST','/api/me/mode',token,{mode:'medical'})).status).toBe(200);
   expect((await call('GET','/api/me',token)).body.mode).toBe('medical');
   const hidden=await call('GET','/api/directory?city=Cafayate',token);
   expect(hidden.status).toBe(200);expect(hidden.body.items).toHaveLength(0);
   expect((await call('GET','/api/admin/professionals',token)).status).toBe(403);
   await db.prepare("UPDATE users SET role='admin' WHERE email=?").run('nanogm.test@x.com');
   expect((await call('POST','/api/me/mode',token,{mode:'admin'})).status).toBe(200);
   const user=(await call('GET','/api/me',token)).body;
   expect(user.mode).toBe('admin');expect(user.isAdmin).toBe(true);
   const pending=(await call('GET','/api/admin/professionals',token)).body;
   expect(pending).toHaveLength(1);expect(pending[0].verified).toBe(false);
   expect((await call('POST','/api/admin/professionals/verify',token,{userId:user.id,category:'medical',verified:true})).status).toBe(200);
   const visible=(await call('GET','/api/directory?category=medical&city=Cafayate',token)).body;
   expect(visible.items).toHaveLength(1);expect(visible.items[0].phone).toBe('5493875466419');
   expect((await call('GET','/api/admin/accounts/lookup?name=nanogm.test',token)).body.users).toHaveLength(1);
   await call('PUT','/api/profiles/me',token,{...profile,description:'Descripción nueva'});
   expect((await call('GET','/api/directory?city=Cafayate',token)).body.items).toHaveLength(0);
 });
});
describe('kinesiology affiliation and safety',()=>{
 it('stores an independent physiotherapist identity and filters it apart from medical doctors',async()=>{
  const kin=await reg('kin@x.com','athlete');
  const physician=await reg('physician@x.com','athlete');
  const admin=await reg('admin.kin@x.com','pro');
  await db.prepare("UPDATE users SET role='admin' WHERE email=?").run('admin.kin@x.com');
  const common={category:'medical',displayName:'Kinesiólogo/a de prueba',specialty:'Rehabilitación y ejercicio terapéutico',credentials:'Licenciatura en Kinesiología',license:'7016K',description:'Evaluación funcional y retorno progresivo al deporte',phone:'5493875000000',city:'Cafayate',area:'Centro',modality:'both',lat:-26.07,lon:-65.97,published:true};
  expect((await call('PUT','/api/profiles/me',kin,{...common,profession:'kinesiologist'})).status).toBe(200);
  expect((await call('PUT','/api/profiles/me',physician,{...common,profession:'physician',displayName:'Médico de prueba',license:'A-123'})).status).toBe(200);
  const pending=(await call('GET','/api/directory?category=kinesiology&city=Cafayate',kin)).body;
  expect(pending.items).toHaveLength(0);
  const pkin=(await call('GET','/api/me',kin)).body;
  const pphys=(await call('GET','/api/me',physician)).body;
  expect((await call('POST','/api/admin/professionals/verify',admin,{userId:pkin.id,category:'medical',verified:true})).status).toBe(200);
  expect((await call('POST','/api/admin/professionals/verify',admin,{userId:pphys.id,category:'medical',verified:true})).status).toBe(200);
  const list=(await call('GET','/api/directory?category=kinesiology&city=Cafayate',kin)).body.items;
  expect(list).toHaveLength(1);expect(list[0].profession).toBe('kinesiologist');expect(list[0].displayName).toBe('Kinesiólogo/a de prueba');
  expect((await call('GET','/api/directory?category=medical&city=Cafayate',kin)).body.items).toHaveLength(2);
  const trainer=await reg('legacy.fitness@x.com','athlete');
  const fitness={...common,category:'fitness',displayName:'Entrenador de prueba',license:'Certificado privado',specialty:'Fuerza y running'};
  expect((await call('PUT','/api/profiles/me',trainer,fitness)).status).toBe(200);
  const trainerProfiles=(await call('GET','/api/profiles/me',trainer)).body;
  expect(trainerProfiles[0].profession).toBe('coach');
  expect((await call('PUT','/api/profiles/me',kin,{...common,profession:'coach'})).status).toBe(400);
  expect((await call('PUT','/api/profiles/me',kin,{...common,profession:'kinesiologist',description:'Nueva descripción'})).status).toBe(200);
  expect((await call('GET','/api/directory?category=kinesiology&city=Cafayate',kin)).body.items).toHaveLength(0);
 });
});
describe('founder account authorization',()=>{
 it('requires an existing administrator and exact NanoGM identity',async()=>{
   const target=await reg('founder@x.com','athlete');
   const actor=await reg('operator@x.com','athlete');
   const user=(await call('GET','/api/me',target)).body;
   await db.prepare('UPDATE users SET name=? WHERE id=?').run('NanoGM',user.id);
   expect((await call('POST','/api/admin/accounts/grant-founder',target,{userId:user.id,expectedEmail:'founder@x.com'})).status).toBe(403);
   await db.prepare("UPDATE users SET role='admin' WHERE email=?").run('operator@x.com');
   expect((await call('POST','/api/admin/accounts/grant-founder',actor,{userId:user.id,expectedEmail:'wrong@x.com'})).status).toBe(409);
   const grant=await call('POST','/api/admin/accounts/grant-founder',actor,{userId:user.id,expectedEmail:'founder@x.com'});
   expect(grant.status).toBe(200);expect(grant.body.medicalProfileVerified).toBe(false);
   const me=(await call('GET','/api/me',target)).body;
   expect(me.isAdmin).toBe(true);expect(me.canPro).toBe(true);expect(me.canMedical).toBe(true);
   expect(me.mode).toBe('admin');
   expect((await call('GET','/api/directory?city=Cafayate',target)).body.items).toHaveLength(0);
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

describe('fixing a day: calendar, edit, clear and delete', () => {
  it('edits a meal, clears a day, removes a strength session and shows month totals', async () => {
    const { t, plan } = await athleteWithPlan('fix@x.com');
    const y = new Date(Date.now() - 864e5).toISOString(), date = y.slice(0, 10);
    const a = await call('POST', '/api/nutrition/log', t, { items: [{ foodId: 'pizza_slice', grams: 440 }], at: y });
    expect(a.body.kcal).toBeGreaterThan(900); // 4 slices
    await call('POST', '/api/nutrition/log', t, { items: [{ foodId: 'banana_unit', grams: 120 }], at: y });
    const edited = await call('PATCH', `/api/nutrition/log/${a.body.id}`, t, { kcal: 540, meal: '2 porciones de pizza' });
    expect(edited.status).toBe(200);
    expect((await call('PATCH', `/api/nutrition/log/${a.body.id}`, await reg('other@x.com', 'athlete'), { kcal: 1 })).status).toBe(404);
    const day = (await call('GET', `/api/day?date=${date}`, t)).body;
    expect(day.logs.find((l: any) => l.id === a.body.id)).toMatchObject({ kcal: 540, edited: true });
    const month = (await call('GET', `/api/calendar?month=${date.slice(0, 7)}`, t)).body;
    expect(month.days.find((d: any) => d.date === date).kcal).toBe(540 + Math.round(day.logs.find((l: any) => l.id !== a.body.id).kcal));
    expect((await call('DELETE', `/api/nutrition/day?date=${date}`, t)).body.removed).toBe(2);
    expect((await call('GET', `/api/day?date=${date}`, t)).body.intake.kcal).toBe(0);
    await call('POST', '/api/workouts', t, sessionFor(plan, 10, 3));
    const today = (await call('GET', '/api/day', t)).body;
    const w = today.exercise.find((e: any) => e.kind === 'strength');
    expect(w.deletable).toBe(true);
    expect((await call('DELETE', `/api/workouts/${w.id}`, t)).status).toBe(200);
    expect((await call('GET', '/api/day', t)).body.exercise.filter((e: any) => e.kind === 'strength')).toHaveLength(0);
    expect((await call('DELETE', `/api/workouts/${w.id}`, t)).status).toBe(404);
  });
});


describe('collectible AI tutors', () => {
  it('starts with two free tutors and requires ownership to select or buy', async () => {
    const t = await reg('tutors@x.com', 'athlete');
    const first = await call('GET', '/api/tutors', t);
    expect(first.status).toBe(200);
    expect(first.body.xp).toBe(0);
    expect(first.body.tutors.filter((x:{owned:boolean}) => x.owned)).toHaveLength(2);
    expect((await call('POST', '/api/tutors/select', t, {id:'mora'})).status).toBe(200);
    expect((await call('GET', '/api/tutors', t)).body.selectedId).toBe('mora');
    expect((await call('POST', '/api/tutors/select', t, {id:'luli'})).status).toBe(403);
    expect((await call('POST', '/api/tutors/unlock', t, {id:'luli'})).status).toBe(409);
    expect((await call('POST', '/api/tutors/select', t, {id:'unknown'})).status).toBe(400);
  });
  it('requires health consent and a configured AI for advice', async () => {
    const t = await reg('tutor-consent@x.com', 'athlete');
    expect((await call('POST', '/api/tutors/ask', t, {message:'¿Qué puedo cocinar?'})).status).toBe(403);
    await call('PUT', '/api/consents', t, allConsents);
    expect((await call('POST', '/api/tutors/ask', t, {message:'¿Qué puedo cocinar?'})).status).toBe(503);
  });
});
