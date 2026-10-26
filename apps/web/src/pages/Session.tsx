import { useEffect, useMemo, useRef, useState } from 'react';
import { api, ApiError } from '../api';
import { byId, type PlanDay } from '@fondal/engine';
import { Bar, useApp, useLoad, useT } from '../ctx';
import { Page, useNav } from '../nav';
import { fmtReps } from './Library';
import { dayMuscles } from './Train';

interface SetRow { weight: string; reps: string; rir: string; done: boolean }
type Last = Record<string, { at: string; sets: { weight: number; reps: number; rir: number }[] }>;

/**
 * Workout logging. Each set has a ✓ that starts the rest timer with the prescribed rest; the previous performance is shown
 * so you know what to beat. `index` 99 = a one-off library session (logged, never changes the plan).
 */
export function Session({ day, index, free, name }: { day: PlanDay; index: number; free?: boolean; name?: string }) {
  const t = useT(), nav = useNav(), { toast } = useApp();
  const ids = day.items.map((i) => i.exerciseId);
  const last = useLoad<{ last: Last }>(`/api/progress/last?ids=${ids.join(',')}`);
  const [rows, setRows] = useState<Record<string, SetRow[]>>(() => Object.fromEntries(day.items.map((it) => [it.exerciseId, Array.from({ length: it.sets }, () => ({ weight: String(it.load || ''), reps: '', rir: '', done: false }))])));
  const [fatigue, setFatigue] = useState(5);
  const [busy, setBusy] = useState(false);
  const [rest, setRest] = useState<{ left: number; total: number } | null>(null);
  const [summary, setSummary] = useState<{ msg: string; volume: number; sets: number } | null>(null);
  const t0 = useRef(Date.now());

  useEffect(() => {
    if (!rest || rest.left <= 0) return;
    const id = setTimeout(() => setRest((r) => (r && r.left > 1 ? { ...r, left: r.left - 1 } : null)), 1000);
    if (rest.left === 1) try { navigator.vibrate?.(250); } catch { /* ignore */ }
    return () => clearTimeout(id);
  }, [rest]);

  const total = day.items.reduce((a, i) => a + i.sets, 0);
  const done = Object.values(rows).flat().filter((r) => r.done).length;
  const set = (id: string, i: number, patch: Partial<SetRow>) => setRows((r) => ({ ...r, [id]: r[id]!.map((x, j) => (j === i ? { ...x, ...patch } : x)) }));
  const prefill = (id: string, i: number) => {
    const prev = last.data?.last[id]?.sets[Math.min(i, (last.data?.last[id]?.sets.length ?? 1) - 1)];
    return prev ? { weight: String(prev.weight), reps: String(prev.reps) } : null;
  };
  const toggle = (id: string, i: number, restSec?: number) => {
    const r = rows[id]![i]!;
    if (!r.done) {
      const pre = prefill(id, i);
      // loaded exercises need a weight: a set logged at 0 kg would corrupt progress and the next load
      if ((byId(id)?.increment ?? 0) > 0 && !(Number(r.weight || pre?.weight || 0) > 0)) { toast(t('enterWeight')); return; }
      // an empty set is completed with the target/previous numbers so a quick tap still records something meaningful
      const reps = r.reps || (pre?.reps ?? String(day.items.find((x) => x.exerciseId === id)!.repMax));
      set(id, i, { done: true, reps, weight: r.weight || pre?.weight || '0', rir: r.rir || String(day.items.find((x) => x.exerciseId === id)!.rirTarget) });
      if (restSec) setRest({ left: restSec, total: restSec });
    } else set(id, i, { done: false });
  };

  const volume = useMemo(() => Object.values(rows).flat().filter((r) => r.done).reduce((a, r) => a + Number(r.weight || 0) * Number(r.reps || 0), 0), [rows]);

  const finish = async () => {
    const items = day.items.map((it) => ({ exerciseId: it.exerciseId, sets: rows[it.exerciseId]!.filter((s) => s.done).map((s) => ({ weight: Number(s.weight || 0), reps: Number(s.reps || 0), rir: Number(s.rir || 0) })) })).filter((i) => i.sets.length);
    if (!items.length) { toast(t('logOneSet')); return; }
    setBusy(true);
    try {
      const r = await api('POST', '/api/workouts', { dayIndex: free ? 99 : index, fatigue, name, items });
      const msg = r.free ? t('sessionSaved') : r.adaptation === 'paused' ? t('adaptPaused') : r.applied ? t('applied') : t('needsApproval');
      setSummary({ msg: [msg, r.deloadSuggested ? t('deloadSuggested') : ''].filter(Boolean).join(' '), volume: Math.round(volume), sets: done });
    } catch (e) { toast(e instanceof ApiError ? t('invalid') : t('netError')); } finally { setBusy(false); }
  };

  if (summary) {
    const min = Math.max(1, Math.round((Date.now() - t0.current) / 60000));
    return (
      <Page title={t('sessionDone')}>
        <div className="card hero"><p className="big">🎉 {summary.msg}</p>
          <div className="grid3"><div className="tile"><b>{summary.sets}</b><span>{t('sets')}</span></div><div className="tile"><b>{summary.volume.toLocaleString()}</b><span>{t('volume')}</span></div><div className="tile"><b>{min}′</b><span>{t('duration')}</span></div></div>
          <p><button className="primary" onClick={() => nav.go('home')}>{t('backHome')}</button></p>
        </div>
      </Page>
    );
  }
  return (
    <Page title={name ?? `${day.name} · ${dayMuscles(day).map((m) => t('m_' + m)).join(', ')}`} sub={free ? t('freeSession') : undefined}>
      <div className="progressbar"><Bar pct={(done / Math.max(1, total)) * 100} /><p className="muted small">{done}/{total} {t('sets')}</p></div>
      {day.items.map((it) => {
        const ex = byId(it.exerciseId), prev = last.data?.last[it.exerciseId];
        return (
          <div className="card" key={it.exerciseId}>
            <div className="row between top"><div><h3 style={{ margin: 0 }}>{t('ex_' + it.exerciseId)}</h3><p className="muted small">{it.sets} × {fmtReps(ex, it.repMin, it.repMax)} · {t('rir')} {it.rirTarget}{it.restSec ? ` · ${t('restTime')} ${it.restSec >= 60 ? Math.round(it.restSec / 6) / 10 + '′' : it.restSec + ' s'}` : ''}</p></div>
              <button className="iconbtn" aria-label={t('howTo')} onClick={() => nav.push('exercise', { id: it.exerciseId })}>?</button></div>
            {prev && <p className="prev">{t('lastTime')}: {prev.sets.map((s) => `${s.weight}${ex?.timed ? '' : 'kg'}×${s.reps}`).join(' · ')}</p>}
            {rows[it.exerciseId]!.map((s, i) => (
              <div className={'setrow' + (s.done ? ' done' : '')} key={i}>
                <span className="n">{i + 1}</span>
                <input aria-label={t('weight')} placeholder={prefill(it.exerciseId, i)?.weight ?? t('weight')} inputMode="decimal" value={s.weight} onChange={(e) => set(it.exerciseId, i, { weight: e.target.value.replace(',', '.') })} />
                <input aria-label={ex?.timed ? 's' : t('reps')} placeholder={prefill(it.exerciseId, i)?.reps ?? (ex?.timed ? 's' : t('reps'))} inputMode="numeric" value={s.reps} onChange={(e) => set(it.exerciseId, i, { reps: e.target.value })} />
                <input aria-label={t('rir')} placeholder={t('rir')} inputMode="numeric" value={s.rir} onChange={(e) => set(it.exerciseId, i, { rir: e.target.value })} />
                <button className={s.done ? 'on' : ''} aria-pressed={s.done} aria-label={t('setDone')} onClick={() => toggle(it.exerciseId, i, it.restSec)}>✓</button>
              </div>
            ))}
          </div>
        );
      })}
      <label htmlFor="fat">{t('fatigue')}: {fatigue}</label><input id="fat" type="range" min={1} max={10} value={fatigue} onChange={(e) => setFatigue(Number(e.target.value))} />
      <p><button className="primary" disabled={busy || done === 0} onClick={finish}>{t('finish')}</button></p>
      {rest && <div className="toast" role="timer" aria-live="off">⏱ {t('rest')} {Math.floor(rest.left / 60)}:{String(rest.left % 60).padStart(2, '0')} <button className="link" onClick={() => setRest(null)}>{t('skip')}</button></div>}
    </Page>
  );
}
