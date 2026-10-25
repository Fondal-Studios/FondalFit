import { useState } from 'react';
import { api } from '../api';
import { Bar, Loading, useLoad, useT } from '../ctx';

interface Explain { bmr: number; lifeFactor: number; lifeKcal: number; trainKcal: number; tdee: number; adjustPct: number; proteinPerKg: number; fatPct: number; kcalFloor: number }
interface Target { kcal: number; proteinG: number; fatG: number; carbsG: number; waterMl: number; floored: boolean; explain: Explain }
interface Meal { dishId: string; kind: string; kcal: number; p: number; c: number; f: number }
interface Menu { index: number; factor: number; meals: Meal[]; kcal: number; p: number; c: number; f: number }
const todayLocal = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

export function Food({ onWizard }: { onWizard: () => void }) {
  const t = useT();
  const n = useLoad<{ target: Target | null; today: { kcal: number; proteinG: number; carbsG: number; fatG: number; waterMl: number } }>('/api/nutrition');
  const m = useLoad<{ menus: Menu[] }>('/api/nutrition/menus?date=' + todayLocal());
  const [open, setOpen] = useState(false);
  const [done, setDone] = useState<Record<string, boolean>>({});
  const [weight, setWeight] = useState('');
  const [msg, setMsg] = useState('');
  const [c, setC] = useState({ meal: '', kcal: '', proteinG: '', carbsG: '', fatG: '' });

  if (!n.data) return <Loading err={n.err} retry={n.reload} />;
  const tg = n.data.target?.explain ? n.data.target : null; // targets from the first app version lack the breakdown
  if (!tg) return <div className="card"><p>{t('noPlanYet')}</p><button className="primary" onClick={onWizard}>{t('createPlan')}</button></div>;
  const x = tg.explain, td = n.data.today;

  const log = async (key: string, name: string, v: { kcal: number; p: number; c: number; f: number }) => {
    await api('POST', '/api/nutrition/log', { meal: name, kcal: v.kcal, proteinG: v.p, carbsG: v.c, fatG: v.f, waterMl: 0 });
    setDone((d) => ({ ...d, [key]: true })); n.reload();
  };
  const logMenu = async (menu: Menu) => {
    await api('POST', '/api/nutrition/log', { meal: 'menu ' + menu.index, kcal: menu.kcal, proteinG: menu.p, carbsG: menu.c, fatG: menu.f, waterMl: 0 });
    setDone((d) => ({ ...d, ['m' + menu.index]: true })); n.reload();
  };
  const addWater = async (ml: number) => { await api('POST', '/api/nutrition/log', { meal: 'water', kcal: 0, proteinG: 0, carbsG: 0, fatG: 0, waterMl: ml }); n.reload(); };
  const saveWeight = async () => {
    const a = await api('GET', '/api/assessment');
    if (!a.assessment) return;
    await api('PUT', '/api/profile', { ...a.assessment.profile, weightKg: Number(weight.replace(',', '.')) });
    setWeight(''); setMsg(t('saved')); n.reload(); m.reload();
  };

  return (
    <>
      <div className="card">
        <h2>{t('target')}</h2>
        <p className="big">{tg.kcal} {t('kcalShort')}</p>
        <p className="muted">P {tg.proteinG} g · C {tg.carbsG} g · G {tg.fatG} g · {tg.waterMl} ml</p>
        <p>{t('eaten')}: <b>{td.kcal}</b> · {t('remaining')}: <b>{Math.max(0, tg.kcal - td.kcal)}</b></p>
        <Bar pct={(td.kcal / tg.kcal) * 100} />
        <p className="muted">P {td.proteinG}/{tg.proteinG} · C {td.carbsG}/{tg.carbsG} · G {td.fatG}/{tg.fatG} · 💧 {td.waterMl}/{tg.waterMl} ml</p>
        <div className="row"><button onClick={() => addWater(250)}>+250 ml</button><button onClick={() => addWater(500)}>+500 ml</button></div>
        {tg.floored && <p className="warn">{t('kcalFloor')}</p>}
        <button className="link" onClick={() => setOpen(!open)}>{t('howCalc')} {open ? '▲' : '▼'}</button>
        {open && <ol className="plain">
          <li>{t('ex_bmr')}: <b>{x.bmr}</b></li>
          <li>{t('ex_life')} {x.lifeFactor} = <b>{x.lifeKcal}</b></li>
          <li>{t('ex_train')}: <b>+{x.trainKcal}</b></li>
          <li>{t('ex_tdee')}: <b>{x.tdee}</b></li>
          <li>{t('ex_adjust')}: <b>{x.adjustPct > 0 ? '+' : ''}{x.adjustPct}%</b> → <b>{tg.kcal}</b> {t('kcalShort')}</li>
          <li>{t('ex_protein')}: <b>{x.proteinPerKg}</b> → {tg.proteinG} g</li>
          <li>{t('ex_fat')}: <b>{x.fatPct}%</b> → {tg.fatG} g</li>
          <li>{t('ex_carbs')} → {tg.carbsG} g</li>
          <li>{t('ex_floor')}: {x.kcalFloor} {t('kcalShort')}</li>
          <li className="muted">{t('approxNote')}</li></ol>}
      </div>

      <div className="card">
        <h2>{t('menusToday')}</h2><p className="muted">{t('menusRot')}</p>
        {!m.data ? <Loading err={m.err} retry={m.reload} /> : m.data.menus.map((menu, i) => (
          <div key={menu.index} className="menu">
            <div className="row between"><h3>{t('option')} {i + 1} · {menu.kcal} {t('kcalShort')}</h3>
              <button className={done['m' + menu.index] ? '' : 'primary'} disabled={done['m' + menu.index]} onClick={() => logMenu(menu)}>{done['m' + menu.index] ? '✓ ' + t('logged') : t('logMenu')}</button></div>
            <p className="muted">P {menu.p} · C {menu.c} · G {menu.f} · {t('portion')} ×{menu.factor}</p>
            {menu.meals.map((ml) => (
              <div className="row between meal" key={ml.dishId}>
                <span><b>{t('k_' + ml.kind)}</b> {t('dish_' + ml.dishId)} <span className="muted">· {ml.kcal} {t('kcalShort')}</span></span>
                <button disabled={done[`${menu.index}${ml.dishId}`]} onClick={() => log(`${menu.index}${ml.dishId}`, t('dish_' + ml.dishId), ml)}>{done[`${menu.index}${ml.dishId}`] ? '✓' : t('logMeal')}</button>
              </div>
            ))}
          </div>
        ))}
      </div>

      <form className="card" onSubmit={async (e) => { e.preventDefault(); await api('POST', '/api/nutrition/log', { meal: c.meal, kcal: +c.kcal || 0, proteinG: +c.proteinG || 0, carbsG: +c.carbsG || 0, fatG: +c.fatG || 0, waterMl: 0 }); setC({ meal: '', kcal: '', proteinG: '', carbsG: '', fatG: '' }); n.reload(); }}>
        <h3>{t('customMeal')}</h3>
        <input required aria-label={t('meal')} placeholder={t('meal')} value={c.meal} onChange={(e) => setC({ ...c, meal: e.target.value })} />
        <div className="row">{(['kcal', 'proteinG', 'carbsG', 'fatG'] as const).map((k) => <input key={k} aria-label={k} placeholder={k === 'kcal' ? 'kcal' : t({ proteinG: 'protein', carbsG: 'carbs', fatG: 'fat' }[k]!)} inputMode="decimal" value={c[k]} onChange={(e) => setC({ ...c, [k]: e.target.value })} />)}</div>
        <p><button className="primary">{t('addMeal')}</button></p>
      </form>
      <div className="card"><h3>{t('updateWeight')}</h3>
        <div className="row"><input aria-label={t('weightKg')} placeholder={t('weightKg')} inputMode="decimal" value={weight} onChange={(e) => setWeight(e.target.value)} /><button className="primary" disabled={!weight} onClick={saveWeight}>{t('save')}</button></div>
        {msg && <p className="ok" role="status">{msg}</p>}
        <button className="link" onClick={onWizard}>{t('editDiet')}</button></div>
    </>
  );
}
