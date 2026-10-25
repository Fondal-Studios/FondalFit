import { useEffect, useState } from 'react';
import { api, ApiError } from '../api';
import { byId, hrZones, schemeFor, weeklyVolume, type Goal, type Plan, type PlanDay, type Prescription } from '@fondal/engine';
import { Bar, Loading, useLoad, useT } from '../ctx';

interface PlanRes { version?: number; plan: Plan | null; proName?: string|null }

export function Train({ onWizard, onCardio }: { onWizard: () => void; onCardio: () => void }) {
  const t = useT();
  const { data, err, reload } = useLoad<PlanRes>('/api/plan');
  const asm = useLoad<{ assessment: any }>('/api/assessment');
  const [session, setSession] = useState<number | null>(null);
  const [msg, setMsg] = useState('');
  const [why, setWhy] = useState(false);
  if (!data) return <Loading err={err} retry={reload} />;
  if (!data.plan) return <div className="card"><p>{t('noPlan')}</p><button className="primary" onClick={onWizard}>{t('createPlan')}</button></div>;
  const plan = data.plan;
  if (session !== null) return <Session day={plan.days[session]!} index={session} onDone={(m) => { setMsg(m); setSession(null); reload(); }} />;
  const sch = schemeFor(plan.goal as Goal);
  const vol = weeklyVolume(plan);
  const age = asm.data?.assessment?.profile?.age as number | undefined;
  return (
    <>
      <div className="row between"><p className="muted">{t('planVersion')} {data.version} · {t('g_' + plan.goal)}</p><button onClick={onWizard}>{t('editPlan')}</button></div>
      {data.proName&&<div className="card linked-plan"><strong>Rutina asignada por {data.proName}</strong><p className="muted">Tus entrenamientos y cargas quedan registrados para el seguimiento del profesional. Repetir tu evaluación no elimina esta rutina asignada.</p></div>}
      {msg && <p className="ok" role="status">{msg}</p>}
      {plan.days.map((d, i) => (
        <div className="card" key={i}>
          <div className="row between"><h3>{d.name} · {t(d.kind === 'cardio' ? 'cardioSession' : 'nav_train')}</h3>
            {d.kind === 'cardio' ? <button className="primary" onClick={onCardio}>{t('startCardio')}</button> : <button className="primary" onClick={() => setSession(i)}>{t('startSession')}</button>}</div>
          {d.kind === 'cardio' && d.cardio ? <CardioInfo d={d} age={age} /> : d.items.map((it) => (
            <p key={it.exerciseId}>{t('ex_' + it.exerciseId)} <span className="muted">· {it.sets}×{it.repMin}-{it.repMax} · {t('rir')} {it.rirTarget}{it.restSec ? ` · ${t('restTime')} ${Math.round(it.restSec / 60 * 10) / 10}′` : ''}{it.load ? ` · ${it.load} kg` : ''}</span></p>
          ))}
        </div>
      ))}
      {vol.length > 0 && <div className="card"><h3>{t('weeklyVolume')}</h3>
        {vol.map((v) => <div key={v.muscle}><span className="muted">{t('m_' + v.muscle)}: {v.sets} · {t('vol_' + v.status)}</span><Bar pct={(v.sets / 20) * 100} /></div>)}</div>}
      <div className="card"><div className="row between"><h3>{t('whyPlan')}</h3><button onClick={() => setWhy(!why)}>{why ? '−' : '+'}</button></div>
        {why && <><p>{t('yourGoal')}: <b>{t('g_' + plan.goal)}</b></p><p className="muted">{t('gd_' + plan.goal)}</p>
          <p>{t('fiberFocus')}: {t('f_' + sch.fiber)}</p><p className="muted">{sch.repMin}–{sch.repMax} {t('reps')} · {t('rir')} {sch.rir} · {t('restTime')} {sch.restSec / 60}′</p></>}</div>
    </>
  );
}

function CardioInfo({ d, age }: { d: PlanDay; age?: number }) {
  const t = useT();
  const c = d.cardio!;
  const z = age ? hrZones(age) : null;
  return (
    <div>
      <p><b>{t(c.modality)}</b> · {t('ct_' + c.type)} · {c.durationMin} {t('minutes_short')}</p>
      {c.intervals && <p className="muted">{t('intervalsDesc', { n: c.intervals.reps, w: fmtSec(c.intervals.workSec), r: fmtSec(c.intervals.restSec) })}</p>}
      {z && (c.type === 'zone2' || c.type === 'long' || c.type === 'walkrun') && <p className="muted">{t('hrEstimate')}: {z.z2[0]}–{z.z2[1]} bpm. {t('hrNote')}</p>}
    </div>
  );
}
const fmtSec = (s: number) => (s >= 60 ? `${Math.round(s / 6) / 10} min` : `${s} s`);

function RestTimer({ seconds }: { seconds: number }) {
  const t = useT();
  const [left, setLeft] = useState(0);
  useEffect(() => { if (left <= 0) return; const id = setTimeout(() => setLeft((l) => l - 1), 1000); return () => clearTimeout(id); }, [left]);
  useEffect(() => { if (left === 0) return; if (left === 1 && 'vibrate' in navigator) navigator.vibrate?.(200); }, [left]);
  return (
    <div className="card row"><h3>{t('rest')}</h3>
      <button onClick={() => setLeft(seconds)}>{seconds}s</button>
      {[60, 90, 120, 180].filter((s) => s !== seconds).map((s) => <button key={s} onClick={() => setLeft(s)}>{s}s</button>)}
      <span role="timer" aria-live="off" style={{ fontVariantNumeric: 'tabular-nums' }}>{left > 0 ? `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}` : ''}</span></div>
  );
}

function Session({ day, index, onDone }: { day: PlanDay; index: number; onDone: (msg: string) => void }) {
  const t = useT();
  const [sets, setSets] = useState<Record<string, { weight: string; reps: string; rir: string }[]>>(() =>
    Object.fromEntries(day.items.map((it) => [it.exerciseId, Array.from({ length: it.sets }, () => ({ weight: String(it.load || ''), reps: '', rir: '' }))])));
  const [fatigue, setFatigue] = useState(5);
  const [busy, setBusy] = useState(false);
  const set = (id: string, i: number, k: 'weight' | 'reps' | 'rir', v: string) => setSets({ ...sets, [id]: sets[id]!.map((s, j) => (j === i ? { ...s, [k]: v } : s)) });
  const rest = day.items.find((i) => i.restSec)?.restSec ?? 90;
  const submit = async () => {
    const items = day.items.map((it: Prescription) => ({ exerciseId: it.exerciseId, sets: sets[it.exerciseId]!.filter((s) => s.reps !== '').map((s) => ({ weight: Number(s.weight || 0), reps: Number(s.reps), rir: Number(s.rir || 0) })) })).filter((i) => i.sets.length);
    if (!items.length) return;
    setBusy(true);
    try {
      const r = await api('POST', '/api/workouts', { dayIndex: index, fatigue, items });
      onDone([r.applied ? t('applied') : t('needsApproval'), r.deloadSuggested ? t('deloadSuggested') : ''].filter(Boolean).join(' '));
    } catch (e) { onDone(e instanceof ApiError ? t('invalid') : t('offline')); }
  };
  return (
    <>
      <h2>{day.name}</h2>
      {day.items.map((it) => (
        <div className="card" key={it.exerciseId}>
          <h3>{t('ex_' + it.exerciseId)} <span className="badge">{t('m_' + byId(it.exerciseId)?.muscle)}</span></h3><p className="muted">{it.repMin}-{it.repMax} {t('reps')} · {t('rir')} {it.rirTarget}</p>
          {sets[it.exerciseId]!.map((s, i) => (
            <div className="set" key={i}><span>{i + 1}</span>
              <input aria-label={t('weight')} placeholder={t('weight')} inputMode="decimal" value={s.weight} onChange={(e) => set(it.exerciseId, i, 'weight', e.target.value)} />
              <input aria-label={t('reps')} placeholder={t('reps')} inputMode="numeric" value={s.reps} onChange={(e) => set(it.exerciseId, i, 'reps', e.target.value)} />
              <input aria-label={t('rir')} placeholder={t('rir')} inputMode="numeric" value={s.rir} onChange={(e) => set(it.exerciseId, i, 'rir', e.target.value)} /></div>
          ))}
        </div>
      ))}
      <RestTimer seconds={rest} />
      <label htmlFor="fat">{t('fatigue')}: {fatigue}</label><input id="fat" type="range" min={1} max={10} value={fatigue} onChange={(e) => setFatigue(Number(e.target.value))} />
      <p><button className="primary" disabled={busy} onClick={submit}>{t('finish')}</button></p>
    </>
  );
}
