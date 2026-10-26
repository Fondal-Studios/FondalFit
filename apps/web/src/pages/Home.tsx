import { useState } from 'react';
import {AthleteProfessionalLink} from './AthleteProfessionalLink';
import { api } from '../api';
import { Bar, Loading, useApp, useLoad, useT } from '../ctx';
import { Ring } from '../charts';
import { useNav } from '../nav';
import { dayMinutes, dayMuscles } from './Train';
import type { Plan } from '@fondal/engine';

interface PlanRes {
  plan: Plan | null; version?: number;
  current?: { label: string; weekIndex: number; weekCount: number; ramp: boolean };
  advice?: { mode: 'normal' | 'light' | 'rest'; reason: string } | null;
  away?: { gapDays: number; options: { weeks: number; setsMult: number } | null };
  week?: { doneDays: number[]; nextIndex: number | null };
}
interface Energy { eaten: number; targetBudget: number | null; remaining: number | null; exerciseKcal: number; burnedSoFar: number; basalSoFar: number; neatSoFar: number; dailyBmr: number }
interface Challenge { id: string; target: number; value: number; pct: number; done: boolean; metric: string }

/** "Hoy": what to do now (one tap), how the day's energy stands, and what changed since last time. */
export function Home() {
  const t = useT(), nav = useNav(), { me, toast } = useApp();
  const plan = useLoad<PlanRes>('/api/plan');
  const energy = useLoad<Energy>('/api/energy/today?timezoneOffset=' + new Date().getTimezoneOffset());
  const daily = useLoad<{ activities: { id: number; sport: string; duration_sec: number; distance_m: number; avg_pace_sec_km: number; estimated_kcal: number | null }[]; totalKcal: number }>('/api/activity/today?timezoneOffset=' + new Date().getTimezoneOffset());
  const ch = useLoad<{ challenges: Challenge[]; points: number }>('/api/challenges');
  const goals = useLoad<{ targets: { metric: string; pct: number; targetKg?: number; targetSec?: number; exerciseId?: string; current: number | null; byDate?: string; projected?: boolean }[] }>('/api/goals');
  const gam = useLoad<{ level: number; xp: number; streakWeeks: number }>('/api/gamification');
  const [busy, setBusy] = useState(false);

  if (!plan.data) return <Loading err={plan.err} retry={() => { plan.reload(); energy.reload(); }} />;
  const p = plan.data;

  const doReturn = async (mode: 'resume' | 'adapted' | 'restart') => {
    setBusy(true);
    try { await api('POST', '/api/plan/return', { mode }); toast(t('returnDone')); plan.reload(); } catch { toast(t('netError')); } finally { setBusy(false); }
  };

  const hello = <div><p className="muted small" style={{ margin: 0 }}>{new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })}</p><h2>{t('hi')}, {me.name}</h2></div>;

  if (!p.plan) return (
    <div className="stack">{hello}
      <AthleteProfessionalLink/>
      <div className="card hero"><h3>{t('welcomeTitle')}</h3><p>{t('noPlanYet')}</p><p className="muted">{t('planWizardIntro')}</p><button className="primary big" onClick={() => nav.push('wizard')}>{t('createPlan')}</button></div>
      <div className="grid2"><button className="tile" onClick={() => nav.push('routines')}><b>📚</b><span>{t('orPickRoutine')}</span></button><button className="tile" onClick={() => nav.push('exercises')}><b>🏋️</b><span>{t('exercises')}</span></button></div>
      <button className="primary" onClick={() => nav.go('food')}>{t('trackFoodFirst')}</button>
    </div>
  );

  const days = p.plan.days;
  const idx = p.week?.nextIndex ?? null;
  const next = idx !== null ? days[idx]! : null;
  const e = energy.data;
  const doneAll = idx === null;

  return (
    <div className="stack">
      {hello}
      <AthleteProfessionalLink/>

      {p.away && p.away.gapDays >= 10 && p.away.options && (
        <div className="card alert"><h3>{t('welcomeBack')} · {p.away.gapDays} {t('daysAway')}</h3><p>{t('returnIntro')}</p>
          <div className="stack"><button className="primary" disabled={busy} onClick={() => doReturn('adapted')}>{t('returnAdapted')} <span className="small">({p.away.options.weeks} {t('weeks')}, −{Math.round((1 - p.away.options.setsMult) * 100)}% {t('volume')})</span></button>
            <button disabled={busy} onClick={() => doReturn('resume')}>{t('returnResume')}</button><button disabled={busy} onClick={() => doReturn('restart')}>{t('returnRestart')}</button></div></div>
      )}
      {p.advice && p.advice.mode !== 'normal' && <div className={'card alert' + (p.advice.mode === 'rest' ? ' bad' : '')} role="status"><p style={{ margin: 0 }}>{p.advice.mode === 'rest' ? t('adviceRest') : t('adviceLight')}</p></div>}

      <div className="card hero">
        {doneAll ? (<><p className="muted">{t('weekComplete')}</p><h3>🎉 {t('weekCompleteTitle')}</h3><div className="row"><button onClick={() => nav.go('train')}>{t('nav_train')}</button><button onClick={() => nav.push('routines')}>{t('routines')}</button></div></>) : next && (
          <>
            <div className="row between"><span className="muted small">{p.current && p.current.weekCount > 1 ? `${p.current.label === 'program' ? t('weekN') : t('block')} ${p.current.weekIndex + 1}/${p.current.weekCount} · ${t('phase_' + p.current.label)}` : t('nextSession')}</span>{p.current?.ramp && <span className="badge lv2">{t('rampShort')}</span>}</div>
            <h3>{next.name} · {t(next.kind === 'cardio' && next.cardio ? next.cardio.modality : 'kind_' + (next.kind ?? 'strength'))}</h3>
            <p className="muted">{dayMinutes(next)} {t('minutes_short')}{next.kind === 'cardio' && next.cardio ? ` · ${t('ct_' + next.cardio.type)}` : ` · ${dayMuscles(next).map((m) => t('m_' + m)).join(', ')} · ${next.items.length} ${t('ex_count')}`}</p>
            <button className="primary big" onClick={() => (next.kind === 'cardio' ? nav.go('cardio') : nav.push('session', { day: next, index: idx }))}>▶ {t('startNow')}</button>
            <p className="small" style={{ margin: '8px 0 0' }}><button className="link" onClick={() => nav.go('train')}>{t('seeWeek')} →</button></p>
          </>)}
      </div>

      <div className="card">
        <div className="row" style={{ alignItems: 'center' }}>
          {e && e.targetBudget !== null ? (
            <Ring pct={(e.eaten / e.targetBudget) * 100} size={118}><b>{Math.abs(e.remaining ?? 0)}</b><small>{(e.remaining ?? 0) >= 0 ? t('remaining') : t('over')}</small></Ring>
          ) : <div className="skeleton" style={{ width: 118, height: 118, borderRadius: '50%' }} />}
          <div style={{ flex: 1 }}>
            <h3 style={{ margin: 0 }}>{t('energyToday')}</h3>
            {e && <><p style={{ margin: '4px 0' }}>{t('eaten')} <b>{e.eaten}</b>{e.targetBudget !== null && <> / {e.targetBudget} {t('kcalShort')}</>}</p>
              <p className="muted small" style={{ margin: 0 }}>{t('burnedSoFar')} ≈ {e.burnedSoFar} · 🏃 {e.exerciseKcal}</p></>}
          </div>
        </div>
        <div className="row" style={{ marginTop: 10 }}><button className="primary" onClick={() => nav.push('addFood')}>＋ {t('addFood')}</button><button onClick={() => nav.go('food')}>{t('nav_nutrition')}</button></div>
        <details><summary className="muted small">{t('energyWhat')}</summary><p className="muted small">{t('energyExplain')}</p></details>
      </div>

      {daily.data && daily.data.activities.length > 0 && (
        <div className="card"><h3>{t('activityToday')}</h3>
          {daily.data.activities.map((a) => <p key={a.id} style={{ margin: '4px 0' }}><b>{t(a.sport)}</b> · {(a.distance_m / 1000).toFixed(2)} km · {Math.floor(a.duration_sec / 60)} min{a.estimated_kcal ? ` · ≈${a.estimated_kcal} ${t('kcalShort')}` : ''}</p>)}
          <button className="link" onClick={() => nav.push('progress')}>{t('progress')} →</button></div>
      )}

      {goals.data && goals.data.targets.length > 0 && (
        <div className="card"><div className="row between"><h3>{t('myGoals')}</h3><button className="link" onClick={() => nav.push('wizard')}>{t('edit')}</button></div>
          {goals.data.targets.map((g, i) => (
            <div key={i} style={{ margin: '8px 0' }}>
              <div className="row between small"><span>{g.metric === 'weight' ? `${t('goal_weight')} → ${g.targetKg} kg` : g.metric === 'run5k' ? `${t('goal_5k')} → ${fmtMin(g.targetSec!)}` : `${t('ex_' + g.exerciseId)} → ${g.targetKg} kg`}</span><span>{g.pct}%</span></div>
              <Bar pct={g.pct} />{g.projected && <p className="muted small" style={{ margin: 0 }}>{t('estimateNote')}</p>}
            </div>))}</div>
      )}

      {ch.data && (
        <div className="card"><div className="row between"><h3>{t('weekChallenges')}</h3><button className="link" onClick={() => nav.push('challenges')}>{t('ranking')} →</button></div>
          {ch.data.challenges.map((c) => <div key={c.id} style={{ margin: '8px 0' }}><div className="row between small"><span>{c.done ? '✅ ' : ''}{t('ch_' + c.id)}</span><span>{c.value}/{c.target}</span></div><Bar pct={c.pct} /></div>)}
          {gam.data && <p className="muted small">{t('level')} {gam.data.level} · {gam.data.xp} XP · {t('streak')}: {gam.data.streakWeeks} · {ch.data.points} {t('weekPoints')}</p>}</div>
      )}

      <div className="grid2">
        <button className="tile" onClick={() => nav.push('progress')}><b>📈</b><span>{t('progress')}</span></button>
        <button className="tile" onClick={() => nav.push('routines')}><b>📚</b><span>{t('routines')}</span></button>
        <button className="tile" onClick={() => nav.push('exercises')}><b>🏋️</b><span>{t('exercises')}</span></button>
        <button className="tile" onClick={() => nav.push('recovery')}><b>😴</b><span>{t('recovery')}</span></button>
      </div>
    </div>
  );
}
const fmtMin = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
