import { useEffect, useState } from 'react';
import { api } from '../api';
import { Chips, Loading, useLoad, useT } from '../ctx';

const GOALS = ['hypertrophy', 'strength', 'recomposition', 'fat_loss', 'endurance', 'vo2max', 'general', 'mobility'];
const PLACES: Record<string, string[]> = {
  pl_gym: ['barbell', 'dumbbells', 'machines', 'bar', 'bands', 'none'],
  pl_home: ['dumbbells', 'bands', 'bar', 'none'],
  pl_bw: ['none', 'bar'],
};
const AREAS = ['knee', 'shoulder', 'lower_back', 'hip', 'ankle', 'wrist', 'neck'];
const DIETS = ['vegetarian', 'vegan', 'gluten_free', 'lactose_free', 'nut_free', 'egg_free', 'fish_free'];
const STEPS = ['w_body', 'w_goal', 'w_train', 'w_health', 'w_diet', 'w_summary'];

interface Form {
  profile: { sex: 'f' | 'm'; age: string; weightKg: string; heightCm: string; bodyFatPct: string; waistCm: string; lifeFactor: number; diet: string[] };
  goal: string; experience: string; strengthDays: number; cardioDays: number; cardioModalities: string[]; place: string; equipment: string[]; restrictions: string[];
  redFlags: Record<string, boolean>;
}
const empty: Form = {
  profile: { sex: 'f', age: '', weightKg: '', heightCm: '', bodyFatPct: '', waistCm: '', lifeFactor: 1.3, diet: [] },
  goal: 'general', experience: 'beginner', strengthDays: 3, cardioDays: 0, cardioModalities: [], place: 'pl_gym', equipment: PLACES.pl_gym!, restrictions: [],
  redFlags: { chestPain: false, dizziness: false, recentSurgery: false, pregnancy: false, medication: false },
};

/** Multi-step assessment. Prefilled from the saved answers so the plan can be edited at any time; every step has Back. */
export function Wizard({ onDone, onCancel }: { onDone: () => void; onCancel?: () => void }) {
  const t = useT();
  const { data, err, reload } = useLoad<{ assessment: any }>('/api/assessment');
  const [f, setF] = useState<Form>(empty);
  const [step, setStep] = useState(0);
  const [referral, setReferral] = useState(false);
  const [busy, setBusy] = useState(false);
  const [fail, setFail] = useState(false);

  useEffect(() => {
    const a = data?.assessment;
    if (!a) return;
    const p = a.profile;
    const place = Object.keys(PLACES).find((k) => PLACES[k]!.length === a.equipment.length && PLACES[k]!.every((e) => a.equipment.includes(e))) ?? 'pl_gym';
    setF({ ...empty, ...a, place, profile: { sex: p.sex, age: String(p.age), weightKg: String(p.weightKg), heightCm: String(p.heightCm), bodyFatPct: p.bodyFatPct ? String(p.bodyFatPct) : '', waistCm: p.waistCm ? String(p.waistCm) : '', lifeFactor: p.lifeFactor, diet: p.diet ?? [] } });
  }, [data]);

  if (!data) return <Loading err={err} retry={reload} />;
  const set = (patch: Partial<Form>) => setF({ ...f, ...patch });
  const setP = (patch: Partial<Form['profile']>) => setF({ ...f, profile: { ...f.profile, ...patch } });
  const p = f.profile;
  const total = f.strengthDays + f.cardioDays;
  const num = (v: string) => (v === '' ? NaN : Number(v));

  const valid = [
    num(p.age) >= 16 && num(p.age) <= 90 && num(p.weightKg) >= 30 && num(p.heightCm) >= 120,
    true,
    total >= 1 && total <= 6 && (f.cardioDays === 0 || f.cardioModalities.length > 0),
    true, true, true,
  ];
  const submit = async () => {
    setBusy(true); setFail(false);
    try {
      const body = {
        profile: { sex: p.sex, age: num(p.age), weightKg: num(p.weightKg), heightCm: num(p.heightCm), lifeFactor: p.lifeFactor, diet: p.diet, ...(p.bodyFatPct ? { bodyFatPct: num(p.bodyFatPct) } : {}), ...(p.waistCm ? { waistCm: num(p.waistCm) } : {}) },
        goal: f.goal, experience: f.experience, strengthDays: f.strengthDays, cardioDays: f.cardioDays, cardioModalities: f.cardioDays ? f.cardioModalities : [],
        equipment: f.equipment, restrictions: f.restrictions, redFlags: f.redFlags,
      };
      const r = await api('POST', '/api/assessment', body);
      if (r.referral) setReferral(true); else onDone();
    } catch { setFail(true); } finally { setBusy(false); }
  };

  const stepper = (label: string, v: number, onChange: (n: number) => void) => (
    <div className="row"><span>{label}</span>
      <button type="button" aria-label="-" onClick={() => onChange(Math.max(0, v - 1))}>−</button><b style={{ textAlign: 'center' }}>{v}</b>
      <button type="button" aria-label="+" onClick={() => onChange(Math.min(6, v + 1))}>+</button></div>
  );

  return (
    <div className="card">
      <p className="muted">{t('step')} {step + 1} {t('of')} {STEPS.length}</p><Bar2 pct={((step + 1) / STEPS.length) * 100} />
      <h2>{t(STEPS[step]!)}</h2>
      {step === 0 && <>
        <p className="muted">{t('bodyWhy')}</p>
        <label>{t('sex')}</label><Chips options={['f', 'm']} value={[p.sex]} onChange={(v) => setP({ sex: v[0] as 'f' | 'm' })} label={(o) => t(o === 'f' ? 'female' : 'male')} />
        <div className="row"><label>{t('age')}<input inputMode="numeric" value={p.age} onChange={(e) => setP({ age: e.target.value })} /></label>
          <label>{t('weightKg')}<input inputMode="decimal" value={p.weightKg} onChange={(e) => setP({ weightKg: e.target.value.replace(',', '.') })} /></label>
          <label>{t('heightCm')}<input inputMode="numeric" value={p.heightCm} onChange={(e) => setP({ heightCm: e.target.value })} /></label></div>
        <div className="row"><label>{t('bodyFat')}<input inputMode="decimal" value={p.bodyFatPct} onChange={(e) => setP({ bodyFatPct: e.target.value })} /></label>
          <label>{t('waist')}<input inputMode="decimal" value={p.waistCm} onChange={(e) => setP({ waistCm: e.target.value })} /></label></div>
        <label>{t('lifeActivity')}</label>
        <Chips options={['1.2', '1.3', '1.4']} value={[String(p.lifeFactor)]} onChange={(v) => setP({ lifeFactor: Number(v[0]) })} label={(o) => t(o === '1.2' ? 'life1' : o === '1.3' ? 'life2' : 'life3')} />
      </>}
      {step === 1 && GOALS.map((g) => (
        <button key={g} type="button" className={'opt' + (f.goal === g ? ' on' : '')} aria-pressed={f.goal === g} onClick={() => set({ goal: g })}>
          <b>{t('g_' + g)}</b><span className="muted">{t('gd_' + g)}</span></button>
      ))}
      {step === 2 && <>
        <label>{t('experience')}</label><Chips options={['beginner', 'intermediate', 'advanced']} value={[f.experience]} onChange={(v) => set({ experience: v[0]! })} />
        {stepper(t('strengthDays'), f.strengthDays, (n) => set({ strengthDays: n }))}
        {stepper(t('cardioDays'), f.cardioDays, (n) => set({ cardioDays: n }))}
        {f.cardioDays > 0 && <><label>{t('cardioMods')}</label><Chips multi options={['run', 'bike']} value={f.cardioModalities} onChange={(v) => set({ cardioModalities: v })} /></>}
        <p className={total >= 1 && total <= 6 ? 'muted' : 'warn'} role="status">{t('totalDays')}: {total}{total > 6 ? ' — ' + t('daysWarn') : total < 1 ? ' — ' + t('needOne') : ''}</p>
        {f.cardioDays > 0 && !f.cardioModalities.length && <p className="warn">{t('needMod')}</p>}
        <label>{t('where')}</label>
        <Chips options={Object.keys(PLACES)} value={[f.place]} onChange={(v) => set({ place: v[0]!, equipment: PLACES[v[0]!]! })} />
      </>}
      {step === 3 && <>
        <label>{t('restrictions')}</label><Chips multi options={AREAS} value={f.restrictions} onChange={(v) => set({ restrictions: v })} />
        <h3>{t('redFlagsTitle')}</h3>
        {Object.keys(f.redFlags).map((k) => <label key={k} className="check"><input type="checkbox" checked={f.redFlags[k]} onChange={(e) => set({ redFlags: { ...f.redFlags, [k]: e.target.checked } })} />{t('rf_' + k)}</label>)}
      </>}
      {step === 4 && <><p className="muted">{t('dietNote')}</p><Chips multi options={DIETS} value={p.diet} onChange={(v) => setP({ diet: v })} label={(o) => t('d_' + o)} /></>}
      {step === 5 && <>
        <ul className="plain">
          <li>{t('g_' + f.goal)} · {t(f.experience)}</li>
          <li>{t('strengthDays')}: {f.strengthDays} · {t('cardioDays')}: {f.cardioDays}{f.cardioDays ? ` (${f.cardioModalities.map((m) => t(m)).join(', ')})` : ''}</li>
          <li>{t(f.place)}{f.restrictions.length ? ' · ' + f.restrictions.map((r) => t(r)).join(', ') : ''}</li>
          <li>{p.weightKg} kg · {p.heightCm} cm · {p.age}</li>
          {p.diet.length > 0 && <li>{p.diet.map((d) => t('d_' + d)).join(', ')}</li>}
        </ul>
        <p className="muted">{t('planEditNote')}</p>
        {referral && <p className="warn" role="alert">{t('referral')}</p>}
        {fail && <p className="bad" role="alert">{t('invalid')}</p>}
      </>}
      <div className="row nav">
        {step > 0 ? <button type="button" onClick={() => setStep(step - 1)}>{t('back')}</button> : onCancel ? <button type="button" onClick={onCancel}>{t('back')}</button> : <span />}
        {step < STEPS.length - 1
          ? <button className="primary" disabled={!valid[step]} onClick={() => setStep(step + 1)}>{t('next')}</button>
          : <button className="primary" disabled={busy || !valid.every(Boolean)} onClick={submit}>{t('generate')}</button>}
      </div>
    </div>
  );
}
const Bar2 = ({ pct }: { pct: number }) => <div className="bar"><i style={{ width: `${pct}%` }} /></div>;
