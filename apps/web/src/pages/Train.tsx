import { useState } from 'react';
import { byId, hrZones, schemeFor, weeklyVolume, type Goal, type Plan, type PlanDay } from '@fondal/engine';
import { Bar, Loading, useLoad, useT } from '../ctx';
import { useNav } from '../nav';
import { fmtReps } from './Library';

interface PlanRes {
  version?: number; source?: string; proName?: string | null; routineId?: string | null; plan: Plan | null;
  current?: { label: string; weekIndex: number; weekCount: number; ramp: boolean };
  advice?: { mode: 'normal' | 'light' | 'rest'; reason: string } | null;
}

export const dayMinutes = (d: PlanDay) => (d.kind === 'cardio' && d.cardio ? d.cardio.durationMin : Math.round(d.items.reduce((a, i) => a + i.sets * (1.0 + (i.restSec ?? 90) / 60), 0) + 8));
export const dayMuscles = (d: PlanDay) => [...new Set(d.items.map((i) => byId(i.exerciseId)?.muscle).filter((m): m is NonNullable<typeof m> => !!m && m !== 'full'))].slice(0, 4);

export function Train() {
  const t = useT(), nav = useNav();
  const { data, err, reload } = useLoad<PlanRes>('/api/plan');
  const asm = useLoad<{ assessment: { profile?: { age: number } } | null }>('/api/assessment');
  const [why, setWhy] = useState(false);
  if (!data) return <Loading err={err} retry={reload} />;
  if (!data.plan) return (
    <div className="stack"><h2>{t('nav_train')}</h2>
      <div className="card hero"><h3>{t('noPlanYet')}</h3><p className="muted">{t('planWizardIntro')}</p><button className="primary" onClick={() => nav.push('wizard')}>{t('createPlan')}</button></div>
      <div className="card"><h3>{t('orPickRoutine')}</h3><button onClick={() => nav.push('routines')}>{t('routines')} →</button></div>
    </div>
  );
  const plan = data.plan, cur = data.current;
  const sch = schemeFor(plan.goal as Goal);
  const vol = weeklyVolume(plan);
  const age = asm.data?.assessment?.profile?.age;
  return (
    <div className="stack">
      <div className="row between"><h2>{t('nav_train')}</h2><button onClick={() => nav.push('wizard')}>{t('editPlan')}</button></div>
      <div className="card hero">
        <p className="muted small">{data.proName ? `${t('byPro')} ${data.proName}` : data.routineId ? t('routine') : t('generatedPlan')} · v{data.version}</p>
        <h3>{t('g_' + plan.goal)}</h3>
        {cur && cur.weekCount > 1 && <><div className="row between"><span>{cur.label === 'program' ? t('weekN') : t('block')} {cur.weekIndex + 1}/{cur.weekCount}</span><span className="badge">{t('phase_' + cur.label)}</span></div><Bar pct={((cur.weekIndex + 1) / cur.weekCount) * 100} /></>}
        {cur?.label === 'deload' && <p className="muted">{t('deloadExplain')}</p>}
        {cur?.ramp && <p className="warn">{t('rampActive')}</p>}
        {data.advice && data.advice.mode !== 'normal' && <p className="warn" role="status">{data.advice.mode === 'rest' ? t('adviceRest') : t('adviceLight')}</p>}
        <div className="row"><button onClick={() => nav.push('routines')}>{t('changeRoutine')}</button><button onClick={() => nav.push('exercises')}>{t('exercises')}</button></div>
      </div>
      {plan.days.map((d, i) => (
        <div className="card" key={i}>
          <div className="row between top"><div><h3 style={{ margin: 0 }}>{d.name} · {t('kind_' + (d.kind ?? 'strength'))}</h3><p className="muted small">{dayMinutes(d)} {t('minutes_short')}{d.kind !== 'cardio' ? ` · ${dayMuscles(d).map((m) => t('m_' + m)).join(', ')}` : ''}</p></div>
            {d.kind === 'cardio' ? <button className="primary" onClick={() => nav.go('cardio')}>{t('startCardio')}</button> : <button className="primary" onClick={() => nav.push('session', { day: d, index: i })}>{t('startSession')}</button>}</div>
          {d.kind === 'cardio' && d.cardio ? (
            <div><p><b>{t(d.cardio.modality)}</b> · {t('ct_' + d.cardio.type)} · {d.cardio.durationMin} {t('minutes_short')}</p>
              {d.note && <p className="muted">{d.note}</p>}
              {d.cardio.intervals && <p className="muted">{t('intervalsDesc', { n: d.cardio.intervals.reps, w: fmtSec(d.cardio.intervals.workSec), r: fmtSec(d.cardio.intervals.restSec) })}</p>}
              {age && ['zone2', 'long', 'walkrun'].includes(d.cardio.type) && <p className="muted small">{t('hrEstimate')}: {hrZones(age).z2[0]}–{hrZones(age).z2[1]} bpm. {t('hrNote')}</p>}</div>
          ) : (
            <div className="list">{d.items.map((it) => (
              <button key={it.exerciseId} onClick={() => nav.push('exercise', { id: it.exerciseId })}>
                <span><b>{t('ex_' + it.exerciseId)}</b><span className="sub">{it.sets} × {fmtReps(byId(it.exerciseId), it.repMin, it.repMax)} · {t('rir')} {it.rirTarget}{it.restSec ? ` · ${t('restTime')} ${it.restSec >= 60 ? Math.round(it.restSec / 6) / 10 + '′' : it.restSec + ' s'}` : ''}{it.load ? ` · ${it.load} kg` : ''}</span></span><span aria-hidden>›</span></button>))}</div>
          )}
        </div>
      ))}
      {vol.length > 0 && <div className="card"><h3>{t('weeklyVolume')}</h3><p className="muted small">{t('volumeRef')}</p>
        {vol.map((v) => <div key={v.muscle}><span className="muted">{t('m_' + v.muscle)}: {v.sets} {t('sets')} · {t('vol_' + v.status)}</span><Bar pct={(v.sets / 20) * 100} /></div>)}</div>}
      <div className="card"><div className="row between"><h3>{t('whyPlan')}</h3><button onClick={() => setWhy(!why)} aria-expanded={why}>{why ? '−' : '+'}</button></div>
        {why && <><p>{t('yourGoal')}: <b>{t('g_' + plan.goal)}</b></p><p className="muted">{t('gd_' + plan.goal)}</p>
          <p>{t('fiberFocus')}: {t('f_' + sch.fiber)}</p><p className="muted">{sch.repMin}–{sch.repMax} {t('reps')} · {t('rir')} {sch.rir} · {t('restTime')} {sch.restSec / 60}′</p><button className="link" onClick={() => nav.push('science')}>{t('science')} →</button></>}</div>
    </div>
  );
}
const fmtSec = (s: number) => (s >= 60 ? `${Math.round(s / 6) / 10} min` : `${s} s`);
