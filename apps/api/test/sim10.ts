/* 10-day simulation: 10 athletes + 2 coaches use the real API day by day (Date.now advances 24 h per day). Run: npx tsx test/sim10.ts */
import { buildApp } from '../src/app';
import { openDb } from '../src/db';

const db = await openDb(':memory:');
const app = buildApp({ db, rateLimitMax: 1e9, adminEmails: ['boss@x.com'] });
const RealDate = Date; const T0 = RealDate.parse('2026-06-01T12:00:00Z'); let dayNo = 0, tick = 0;
const clock = () => T0 + dayNo * 864e5 + (tick++) * 1000;
class FakeDate extends RealDate { constructor(...a: any[]) { if (a.length === 0) super(clock()); else super(...(a as [any])); } static now() { return clock(); } }
(globalThis as any).Date = FakeDate;
const problems: string[] = [];
async function call(method: string, url: string, token?: string, payload?: unknown, expect?: number[]) {
  const r = await app.inject({ method: method as 'GET', url, payload: payload as object, headers: token ? { authorization: `Bearer ${token}` } : {} });
  let body: any; try { body = r.json(); } catch { body = null; }
  if (r.statusCode >= 500 || (expect ? !expect.includes(r.statusCode) : r.statusCode >= 400)) problems.push(`${method} ${url} → ${r.statusCode} ${JSON.stringify(body)?.slice(0, 120)}`);
  return { status: r.statusCode, body };
}
const rf = { chestPain: false, dizziness: false, recentSurgery: false, pregnancy: false, medication: false };
interface P { name: string; sex: 'f' | 'm'; age: number; kg: number; cm: number; goal: string; sd: number; cd: number; mods: string[]; exp: string; eq: string[]; restr: string[]; life: number; habits: { eat: (d: number) => [string, number][]; skip: number[]; run?: number } }
const meal = (ids: [string, number][]) => ids;
const people: P[] = [
  { name: 'Lucía', sex: 'f', age: 24, kg: 68, cm: 163, goal: 'fat_loss', sd: 3, cd: 0, mods: [], exp: 'beginner', eq: ['none'], restr: [], life: 1.3, habits: { eat: () => [['oats_dry', 50], ['banana_unit', 120], ['chicken_breast', 150], ['rice_white', 150], ['salad_mixed', 150], ['pizza_slice', 220]], skip: [2, 5, 8] } },
  { name: 'Marcos', sex: 'm', age: 35, kg: 82, cm: 178, goal: 'hypertrophy', sd: 4, cd: 0, mods: [], exp: 'intermediate', eq: ['barbell', 'dumbbells', 'machines', 'bar'], restr: [], life: 1.4, habits: { eat: () => [['egg', 150], ['bread_white', 80], ['milanesa_napo', 280], ['pasta_plate', 350], ['whey', 30], ['rice_white', 200], ['beef_lean', 200]], skip: [4, 8] } },
  { name: 'Sofía', sex: 'f', age: 29, kg: 58, cm: 168, goal: 'endurance', sd: 2, cd: 3, mods: ['run'], exp: 'intermediate', eq: ['dumbbells'], restr: [], life: 1.4, habits: { eat: () => [['yogurt_greek', 200], ['banana_unit', 120], ['pasta_plate', 350], ['chicken_breast', 150], ['honey', 20]], skip: [3], run: 3 } },
  { name: 'Tomás', sex: 'm', age: 42, kg: 90, cm: 175, goal: 'recomposition', sd: 3, cd: 0, mods: [], exp: 'intermediate', eq: ['dumbbells', 'bar'], restr: ['lower_back'], life: 1.3, habits: { eat: () => [['hamburger_cheese', 200], ['papas_fritas_porcion', 150], ['gaseosa_vaso', 300], ['egg', 100]], skip: [1, 2, 3, 4, 5, 6] } },
  { name: 'Valentina', sex: 'f', age: 19, kg: 60, cm: 170, goal: 'strength', sd: 4, cd: 0, mods: [], exp: 'advanced', eq: ['barbell', 'dumbbells', 'machines', 'bar'], restr: [], life: 1.4, habits: { eat: () => [['oats_cooked', 250], ['egg', 150], ['asado_plate', 250], ['sweet_potato', 200], ['alfajor_unit', 55]], skip: [6] } },
  { name: 'Raúl', sex: 'm', age: 58, kg: 86, cm: 172, goal: 'general', sd: 2, cd: 1, mods: ['bike'], exp: 'beginner', eq: ['dumbbells', 'machines'], restr: ['knee', 'lower_back'], life: 1.3, habits: { eat: () => [['coffee_milk', 250], ['tostada_manteca', 40], ['locro', 350], ['mate_cebado', 500]], skip: [2, 6] } },
  { name: 'Camila', sex: 'f', age: 31, kg: 64, cm: 166, goal: 'recomposition', sd: 3, cd: 2, mods: ['run'], exp: 'intermediate', eq: ['dumbbells', 'bands', 'bar'], restr: [], life: 1.4, habits: { eat: () => [['yogur_granola', 250], ['arroz_pollo', 350], ['tarta_verdura_unit', 150], ['medialuna', 50]], skip: [5], run: 2 } },
  { name: 'Diego', sex: 'm', age: 27, kg: 74, cm: 180, goal: 'hypertrophy', sd: 4, cd: 0, mods: [], exp: 'intermediate', eq: ['none', 'bar'], restr: [], life: 1.4, habits: { eat: () => [['omelette_2', 130], ['pasta_bolognese', 400], ['empanada_baked', 90], ['empanada_baked', 90], ['batido_proteina', 350]], skip: [3, 7] } },
  { name: 'Paula', sex: 'f', age: 45, kg: 78, cm: 160, goal: 'fat_loss', sd: 3, cd: 0, mods: [], exp: 'beginner', eq: ['dumbbells', 'machines'], restr: ['knee'], life: 1.3, habits: { eat: () => [['sopa_verduras', 300], ['lasagna', 300], ['torta_porcion', 100], ['vino_copa', 150]], skip: [2, 3, 6, 9] } },
  { name: 'Nico', sex: 'm', age: 22, kg: 70, cm: 176, goal: 'vo2max', sd: 1, cd: 4, mods: ['bike', 'run'], exp: 'advanced', eq: ['dumbbells'], restr: [], life: 1.4, habits: { eat: () => [['avena_leche', 300], ['pasta_plate', 400], ['banana_unit', 120], ['chicken_thigh', 200], ['rice_white', 250]], skip: [8], run: 1 } },
];
const log: any[] = [];
const S: Record<string, { t: string; plan: any; id?: number }> = {};
for (const p of people) {
  const t = (await call('POST', '/api/auth/register', undefined, { email: p.name.toLowerCase().normalize('NFD').replace(/[^a-z]/g, '') + '@sim.com', password: 'password123', name: p.name, role: 'athlete', lang: 'es' })).body.token;
  await call('PUT', '/api/consents', t, { terms: true, health_data: true, share_with_pro: true, ai_memory: true, camera_video: false });
  const a = await call('POST', '/api/assessment', t, { profile: { sex: p.sex, age: p.age, weightKg: p.kg, heightCm: p.cm, lifeFactor: p.life, diet: [] }, goal: p.goal, strengthDays: p.sd, cardioDays: p.cd, cardioModalities: p.mods, experience: p.exp, equipment: p.eq, restrictions: p.restr, redFlags: rf });
  S[p.name] = { t, plan: a.body.plan };
  if (!a.body.plan) problems.push(`${p.name}: no plan`);
}
const stats: Record<string, { sessions: number; kcal: number[]; remaining: number[]; overDays: number; dayErr: string[]; decisions: number; loads: string[] }> = {};
for (const p of people) stats[p.name] = { sessions: 0, kcal: [], remaining: [], overDays: 0, dayErr: [], decisions: 0, loads: [] };
for (dayNo = 0; dayNo < 10; dayNo++) {
  for (const p of people) {
    const { t } = S[p.name]!; const st = stats[p.name]!;
    const skip = p.habits.skip.includes(dayNo);
    // nutrition: 3–5 items, sometimes a logging mistake
    const items = p.habits.eat(dayNo).filter((_, i) => (i + dayNo) % 5 !== 4);
    if (!skip || p.name === 'Tomás') {
      const r = await call('POST', '/api/nutrition/log', t, { items: items.map(([foodId, grams]) => ({ foodId, grams })), mealType: 'lunch' });
      if (r.body?.kcal > 3500) problems.push(`${p.name} d${dayNo}: single log ${r.body.kcal} kcal`);
    }
    await call('POST', '/api/nutrition/log', t, { waterMl: 500 + (dayNo % 3) * 500, meal: 'water' });
    if (p.name === 'Paula' && dayNo === 4) { // mistake: 4 pizzas logged by error → fix via day detail
      const bad = await call('POST', '/api/nutrition/log', t, { items: [{ foodId: 'pizza_slice', grams: 880 }] });
      await call('PATCH', `/api/nutrition/log/${bad.body.id}`, t, { kcal: 270, meal: '1 porción de pizza' });
    }
    // training
    if (!skip) {
      const plan = (await call('GET', '/api/plan', t)).body; const days = plan.plan?.days ?? [];
      const nextIdx = plan.week?.nextIndex ?? 0; const day = days[nextIdx];
      if (day?.kind === 'cardio' || (!day?.items?.length && day)) {
        const km = 4 + dayNo * 0.5; await call('POST', '/api/activities', t, { sport: p.mods[0] === 'bike' ? 'bike' : 'run', source: 'manual', startedAt: new Date(Date.now()).toISOString(), durationSec: Math.round(km * 360), movingSec: Math.round(km * 360), distanceM: Math.round(km * 1000), avgPaceSecKm: 0, elevGainM: 0, route: [] });
        st.sessions++;
      } else if (day) {
        const w = await call('POST', '/api/workouts', t, { dayIndex: nextIdx, fatigue: 3 + (dayNo % 4), items: day.items.map((i: any) => ({ exerciseId: i.exerciseId, sets: Array.from({ length: i.sets }, () => ({ weight: (i.load || 10) + (dayNo > 4 ? 2.5 : 0), reps: i.repMax ?? 10, rir: 2 })) })) });
        st.sessions++; st.decisions += Object.keys(w.body?.decisions ?? {}).length; st.loads.push(JSON.stringify(Object.values(w.body?.decisions ?? {}).slice(0, 1)));
      }
    }
    if (p.habits.run && dayNo % 3 === p.habits.run % 3 && !skip) {
      await call('POST', '/api/activities', t, { sport: 'run', source: 'manual', startedAt: new Date(Date.now()).toISOString(), durationSec: 1800, movingSec: 1800, distanceM: 5000, avgPaceSecKm: 360, elevGainM: 0, route: [], kcal: 380 });
    }
    const dr = await call('GET', `/api/day?date=${new Date(Date.now()).toISOString().slice(0, 10)}`, t); const d = dr.body; if (!d?.intake) { console.log(problems.slice(0, 6), dr); process.exit(1); }
    st.kcal.push(d.intake.kcal); if (d.energy) { st.remaining.push(d.energy.remaining); if (d.energy.remaining < -300) st.overDays++; if (d.energy.budget < d.energy.bmr) problems.push(`${p.name} budget<bmr`); }
    else st.dayErr.push('no energy');
  }
}
dayNo = 10;
// coaches
const pro = (await call('POST', '/api/auth/register', undefined, { email: 'coach@sim.com', password: 'password123', name: 'Prof. Gómez', role: 'pro', lang: 'es' })).body.token;
const code = (await call('GET', '/api/pro/code', pro)).body.code;
const join = await call('POST', '/api/links/join-code', S['Marcos']!.t, { code }); 
const tpl = await call('POST', '/api/pro/templates', pro, { name: 'Fuerza base', goal: 'strength', days: [{ name: 'A', kind: 'strength', items: [{ exerciseId: 'back_squat', sets: 4, repMin: 5, repMax: 6, rirTarget: 2, load: 60, restSec: 150 }, { exerciseId: 'bench_press', sets: 4, repMin: 5, repMax: 6, rirTarget: 2, load: 50, restSec: 150 }] }] });
const uid = (await call('GET', '/api/me', S['Marcos']!.t)).body.id;
const asg = await call('POST', `/api/pro/templates/${tpl.body.id}/assign`, pro, { athleteId: uid });
const fb = await call('GET', '/api/pro/athletes', pro);
import { byId } from '@fondal/engine';
const detail: any = {};
for (const p of people) {
  const t = S[p.name]!.t; const pl = (await call('GET', '/api/plan', t)).body; const nu = (await call('GET', '/api/day?date=2026-06-11', t)).body;
  const ids: string[] = (pl.plan?.days ?? []).flatMap((d: any) => d.items.map((i: any) => i.exerciseId));
  const viol = ids.filter((id) => (byId(id)?.stresses ?? []).some((a: string) => p.restr.includes(a)));
  const gps = (await call('GET', '/api/progress/running', t)).body;
  detail[p.name] = { days: (pl.plan?.days ?? []).map((d: any) => `${d.kind}:${d.kind === 'cardio' ? d.cardio?.type + ' ' + d.cardio?.durationMin + 'min' : d.items.length + 'ex'}`), week: pl.current?.label, advice: pl.advice?.mode, awayDays: pl.away?.gapDays, target: nu.target ? { kcal: nu.target.kcal, p: nu.target.proteinG, water: nu.target.waterMl } : null, budget: nu.energy?.budget, violations: viol, runKm: gps?.totalKm ?? gps?.summary ?? undefined };
}
console.log('DETAIL', JSON.stringify(detail, null, 1));
const admin = (await call('POST', '/api/auth/register', undefined, { email: 'boss@x.com', password: 'password123', name: 'NanoGM', role: 'athlete', lang: 'es' })).body.token;
const stat = await call('GET', '/api/admin/stats', admin, undefined, [200, 403]);
console.log('SUMMARY', JSON.stringify({ problems, join: join.status, assign: asg.status, athletesSeenByPro: Array.isArray(fb.body) ? fb.body.length : fb.body, admin: { users: stat.body?.users, activity: stat.body?.activity, usage30d: stat.body?.usage30d }, stats: Object.fromEntries(Object.entries(stats).map(([k, v]) => [k, { sessions: v.sessions, avgKcal: Math.round(v.kcal.reduce((a, b) => a + b, 0) / v.kcal.length), kcal: v.kcal, remainingLast: v.remaining.slice(-3), overDays: v.overDays, decisions: v.decisions }])) }, null, 1));
await app.close(); await db.close();
