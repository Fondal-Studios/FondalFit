import { useState } from 'react';
import { api } from '../api';
import { Bar, Loading, useApp, useLoad, useT } from '../ctx';
import { Ring, WaterBar, waterZone } from '../charts';
import { useNav } from '../nav';

interface Explain { bmr: number; lifeFactor: number; lifeKcal: number; trainKcal: number; tdee: number; adjustPct: number; proteinPerKg: number; fatPct: number; kcalFloor: number }
interface Target { kcal: number; proteinG: number; fatG: number; carbsG: number; waterMl: number; floored: boolean; explain?: Explain }
interface Log { id: number; at: string; meal: string; mealType?: string; kcal: number; proteinG: number; carbsG: number; fatG: number; waterMl: number; items?: { foodId: string; grams: number }[] }
interface Energy { bmr: number; neat: number; exercise: number; goalAdjustment: number | null; budget: number; remaining: number; dayFraction: number; basalSoFar: number; neatSoFar: number; burnedSoFar: number }
interface Day { date: string; target: Target | null; energy: Energy | null; waterLogs: { id: number; ml: number; at: string }[]; intake: { kcal: number; proteinG: number; carbsG: number; fatG: number; waterMl: number }; logs: Log[]; exercise: { kind: string; name: string; kcal: number | null }[]; burnedExercise: number; resting: number | null; expenditure: number | null; balance: number | null; vsTarget: number | null }
interface Meal { dishId: string; kind: string; kcal: number; p: number; c: number; f: number }
interface Menu { index: number; factor: number; meals: Meal[]; kcal: number; p: number; c: number; f: number }

const localDate = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const shift = (date: string, n: number) => { const d = new Date(date + 'T12:00:00'); d.setDate(d.getDate() + n); return localDate(d); };
const tz = () => new Date().getTimezoneOffset();

export function Food() {
  const t = useT(), nav = useNav(), { toast } = useApp();
  const [date, setDate] = useState(localDate());
  const day = useLoad<Day>(`/api/day?date=${date}&timezoneOffset=${tz()}`, [date]);
  const [shuffle, setShuffle] = useState(0);
  const menus = useLoad<{ menus: Menu[] }>(`/api/nutrition/menus?date=${date}&shuffle=${shuffle}`, [date, shuffle]);
  const [showBudget, setShowBudget] = useState(true);
  const [open, setOpen] = useState(false);
  const [showMenus, setShowMenus] = useState(false);
  const [weight, setWeight] = useState('');
  const isToday = date === localDate();

  if (!day.data) return <Loading err={day.err} retry={day.reload} />;
  const d = day.data, tg = d.target;
  if (!tg || !tg.explain) return <div className="card hero"><h3>{t('noPlanYet')}</h3><p className="muted">{t('planWizardIntro')}</p><button className="primary" onClick={() => nav.push('wizard')}>{t('createPlan')}</button></div>;
  const x = tg.explain;
  const en = d.energy;
  const budget = en?.budget ?? tg.kcal;
  const left = budget - d.intake.kcal;
  const pct = (d.intake.kcal / budget) * 100;

  const logMenu = async (m: Menu) => { await api('POST', '/api/nutrition/log', { meal: `${t('option')} ${m.index + 1}`, kcal: m.kcal, proteinG: m.p, carbsG: m.c, fatG: m.f, mealType: 'lunch', timezoneOffset: tz() }); toast(t('mealSaved')); day.reload(); };
  const logDish = async (ml: Meal) => { await api('POST', '/api/nutrition/log', { meal: t('dish_' + ml.dishId), kcal: ml.kcal, proteinG: ml.p, carbsG: ml.c, fatG: ml.f, mealType: ml.kind, timezoneOffset: tz() }); toast(t('mealSaved')); day.reload(); };
  const del = async (id: number) => { await api('DELETE', `/api/nutrition/log/${id}`); day.reload(); };
  const water = async (ml: number) => { await api('POST', '/api/nutrition/log', { waterMl: ml, meal: 'water', timezoneOffset: tz() }); day.reload(); };
  const saveWeight = async () => {
    await api('POST', '/api/measurements', { weightKg: Number(weight.replace(',', '.')), source: 'manual', applyToProfile: true });
    setWeight(''); toast(t('saved')); day.reload(); menus.reload();
  };

  const byType = (k: string) => d.logs.filter((l) => (l.mealType ?? 'snack') === k && l.kcal + l.waterMl > 0 && l.meal !== 'water');
  return (
    <div className="stack">
      <div className="row between">
        <button className="iconbtn" aria-label={t('prevDay')} onClick={() => setDate(shift(date, -1))}>‹</button>
        <h2 style={{ textAlign: 'center', flex: 1 }} onClick={() => nav.push('dayDetail', { date })}>{isToday ? t('todayWord') : new Date(date + 'T12:00:00').toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'short' })}</h2>
        <button className="iconbtn" aria-label={t('nextDay')} disabled={isToday} onClick={() => setDate(shift(date, 1))}>›</button>
      </div>

      <div className="card hero">
        <div className="row" style={{ alignItems: 'center' }}>
          <Ring pct={pct} size={132}><b>{Math.abs(left)}</b><small>{left >= 0 ? t('availableToEat') : t('over')}</small></Ring>
          <div style={{ flex: 1 }}>
            <p style={{ margin: 0 }}>{t('eaten')} <b>{d.intake.kcal}</b> / {budget} {t('kcalShort')}</p>
            <p className="muted small" style={{ margin: '4px 0' }}>{t('budgetOfDay')}</p>
            {en && <p className="muted small" style={{ margin: 0 }}>{t('burnedSoFar')} ≈ <b>{en.burnedSoFar}</b> {t('kcalShort')}</p>}
          </div>
        </div>
        <div style={{ marginTop: 12 }}>
          {([['P', d.intake.proteinG, tg.proteinG], ['C', d.intake.carbsG, tg.carbsG], ['G', d.intake.fatG, tg.fatG]] as const).map(([l, v, g]) => <div key={l} style={{ margin: '6px 0' }}><div className="row between small"><span>{t('macro_' + l)}</span><span>{v} / {g} g</span></div><Bar pct={(v / g) * 100} /></div>)}
        </div>
      </div>

      {en && (
        <div className="card">
          <div className="row between"><h3>{t('whereBudget')}</h3><button onClick={() => setShowBudget(!showBudget)} aria-expanded={showBudget}>{showBudget ? '−' : '+'}</button></div>
          {showBudget && <>
            <table className="simple"><tbody>
              <tr><td>1. {t('bud_bmr')}<span className="muted small"> — {t('bud_bmrHelp')}</span></td><td><b>{en.bmr}</b></td></tr>
              <tr><td>2. {t('bud_neat')}<span className="muted small"> — {t('bud_neatHelp')}</span></td><td><b>+{en.neat}</b></td></tr>
              <tr><td>3. {t('bud_exercise')}<span className="muted small"> — {d.exercise.length ? d.exercise.map((e) => `${t(e.name === 'strength' ? 'kind_strength' : e.name)}${e.kcal ? ` ${e.kcal}` : ''}`).join(' · ') : t('bud_noExercise')}</span></td><td><b>+{en.exercise}</b></td></tr>
              <tr><td>4. {t('bud_goal')}<span className="muted small"> — {t('goalAdjust')} {x.adjustPct > 0 ? '+' : ''}{x.adjustPct}%</span></td><td><b>{(en.goalAdjustment ?? 0) > 0 ? '+' : ''}{en.goalAdjustment ?? 0}</b></td></tr>
              <tr><td><b>= {t('bud_total')}</b></td><td><b>{en.budget}</b></td></tr>
              <tr><td>− {t('eaten')}</td><td><b>{d.intake.kcal}</b></td></tr>
              <tr><td><b>= {t('availableToEat')}</b></td><td><b className={en.remaining < 0 ? 'warn' : 'ok'}>{en.remaining}</b></td></tr></tbody></table>
            {isToday && <p className="muted small">{t('bud_soFar', { pct: Math.round(en.dayFraction * 100), basal: en.basalSoFar, neat: en.neatSoFar })}</p>}
            <p className="muted small">{t('bud_baseTarget', { kcal: tg.kcal })}</p>
            <p className="muted small">{t('bud_note')}</p></>}
        </div>
      )}

      <button className="primary big" onClick={() => nav.push('addFood', { date: isToday ? undefined : date })}>＋ {t('addFood')}</button>

      <div className="card">
        {(() => { const ml = d.intake.waterMl, z = waterZone(ml); return (<>
          <div className="row between"><h3>💧 {t('waterLabel')}</h3><b style={{ color: z.color }}>{(ml / 1000).toFixed(2).replace(/\.?0+$/, '')} L</b></div>
          <WaterBar ml={ml} goal={tg.waterMl} />
          <p style={{ margin: 0, color: z.color }} role="status">{t('water_' + z.key)}</p>
          <p className="muted small">{t('waterGoalNote', { goal: (tg.waterMl / 1000).toFixed(1) })}</p>
          <div className="row"><button onClick={() => water(250)}>+250</button><button onClick={() => water(500)}>+500</button><button onClick={() => water(750)}>+750</button><button disabled={!d.waterLogs.length} onClick={() => del(d.waterLogs[d.waterLogs.length - 1]!.id)}>↶ {t('undo')}</button></div>
        </>); })()}
      </div>

      <div className="card">
        <h3>{t('mealsOfDay')}</h3>
        {d.logs.filter((l) => l.kcal > 0).length === 0 && <div className="empty"><div className="em">🍽</div><p>{t('noMealsYet')}</p></div>}
        {(['breakfast', 'lunch', 'snack', 'dinner'] as const).map((k) => { const ls = byType(k); if (!ls.length) return null; return (
          <div key={k}><div className="row between"><b>{t('k_' + k)}</b><span className="muted small">{ls.reduce((a, l) => a + l.kcal, 0)} {t('kcalShort')}</span></div>
            {ls.map((l) => <div className="row between" key={l.id} style={{ margin: '4px 0' }}><span style={{ flex: 3 }}>{l.meal}<span className="muted small"> · P{Math.round(l.proteinG)} C{Math.round(l.carbsG)} G{Math.round(l.fatG)}</span></span><b style={{ flex: 'none' }}>{l.kcal}</b><button aria-label={t('remove')} onClick={() => del(l.id)} style={{ flex: 'none', minHeight: 36, padding: '0 10px' }}>✕</button></div>)}</div>); })}
        {d.exercise.length > 0 && <p className="muted small">🏃 {d.exercise.map((e) => `${t(e.name === 'strength' ? 'kind_strength' : e.name)}${e.kcal ? ` (${e.kcal} ${t('kcalShort')})` : ''}`).join(' · ')}</p>}
      </div>

      <div className="card">
        <div className="row between"><h3>{t('menusToday')}</h3><button onClick={() => setShowMenus(!showMenus)} aria-expanded={showMenus}>{showMenus ? '−' : '+'}</button></div>
        {showMenus && <button onClick={() => setShuffle(shuffle + 1)}>🔄 {t('otherMenus')}</button>}
        <p className="muted small">{t('menusRot')}</p>
        {showMenus && (!menus.data ? <Loading err={menus.err} retry={menus.reload} /> : menus.data.menus.map((menu, i) => (
          <div key={menu.index} className="menu">
            <div className="row between"><h3>{t('option')} {i + 1} · {menu.kcal} {t('kcalShort')}</h3><button className="primary" onClick={() => logMenu(menu)}>{t('logMenu')}</button></div>
            <p className="muted small">P {menu.p} · C {menu.c} · G {menu.f} · {t('portion')} ×{menu.factor}</p>
            {menu.meals.map((ml) => <div className="row between meal" key={ml.dishId}><span><b>{t('k_' + ml.kind)}</b> {t('dish_' + ml.dishId)} <span className="muted">· {ml.kcal}</span></span><button onClick={() => logDish(ml)}>{t('logMeal')}</button></div>)}
          </div>)))}
      </div>

      <div className="card">
        <button className="link" onClick={() => setOpen(!open)} aria-expanded={open}>{t('howCalc')} {open ? '▲' : '▼'}</button>
        {open && <ol className="plain">
          <li>{t('ex_bmr')}: <b>{x.bmr}</b></li><li>{t('ex_life')} {x.lifeFactor} = <b>{x.lifeKcal}</b></li><li>{t('ex_train')}: <b>+{x.trainKcal}</b></li><li>{t('ex_tdee')}: <b>{x.tdee}</b></li>
          <li>{t('ex_adjust')}: <b>{x.adjustPct > 0 ? '+' : ''}{x.adjustPct}%</b> → <b>{tg.kcal}</b> {t('kcalShort')}</li><li>{t('ex_protein')}: <b>{x.proteinPerKg}</b> → {tg.proteinG} g</li>
          <li>{t('ex_fat')}: <b>{x.fatPct}%</b> → {tg.fatG} g</li><li>{t('ex_carbs')} → {tg.carbsG} g</li><li>{t('ex_floor')}: {x.kcalFloor} {t('kcalShort')}</li><li className="muted">{t('approxNote')}</li></ol>}
        {tg.floored && <p className="warn">{t('kcalFloor')}</p>}
      </div>

      <button className="primary big" onClick={() => nav.push('calendar')}>📅 {t('openCalendar')}</button>

      <div className="card"><h3>{t('updateWeight')}</h3>
        <div className="row"><input aria-label={t('weightKg')} placeholder={t('weightKg')} inputMode="decimal" value={weight} onChange={(e) => setWeight(e.target.value)} /><button className="primary" disabled={!weight} onClick={saveWeight}>{t('save')}</button></div>
        <p className="muted small">{t('weightUpdatesTarget')}</p>
        <button className="link" onClick={() => nav.push('wizard')}>{t('editDiet')}</button></div>
    </div>
  );
}
