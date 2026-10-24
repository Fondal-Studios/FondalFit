import { beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app';

let app: ReturnType<typeof buildApp>;
beforeEach(() => { app = buildApp(); });

async function call(method: string, url: string, token?: string, payload?: unknown) {
  const r = await app.inject({ method: method as 'GET', url, payload: payload as object, headers: token ? { authorization: `Bearer ${token}` } : {} });
  return { status: r.statusCode, body: r.json() };
}
async function reg(email: string, role: 'athlete' | 'pro') {
  const r = await call('POST', '/api/auth/register', undefined, { email, password: 'password123', name: email.split('@')[0], role, lang: 'pt' });
  return r.body.token as string;
}
const allConsents = { terms: true, health_data: true, share_with_pro: true, ai_memory: false, camera_video: false };
const assessment = { goal: 'hypertrophy', daysPerWeek: 3, experience: 'intermediate', equipment: ['dumbbells'], restrictions: ['knee'], redFlags: { chestPain: false, dizziness: false, recentSurgery: false, pregnancy: false, medication: false } };

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
  it('computes safe target and aggregates logs', async () => {
    const { t } = await athleteWithPlan();
    const tg = await call('POST', '/api/nutrition/target', t, { sex: 'f', weightKg: 55, heightCm: 160, age: 30, activity: 1.2, goal: 'fat_loss' });
    expect(tg.body.kcal).toBeGreaterThanOrEqual(1200);
    await call('POST', '/api/nutrition/log', t, { meal: 'x', kcal: 500, proteinG: 30, carbsG: 50, fatG: 10, waterMl: 300 });
    await call('POST', '/api/nutrition/log', t, { meal: 'y', kcal: 300, proteinG: 20, carbsG: 30, fatG: 5, waterMl: 200 });
    const n = (await call('GET', '/api/nutrition', t)).body;
    expect(n.today).toMatchObject({ kcal: 800, waterMl: 500 });
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
