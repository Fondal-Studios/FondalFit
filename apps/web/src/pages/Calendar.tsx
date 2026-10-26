import { useState } from 'react';
import { api } from '../api';
import { foodById, foodName } from '@fondal/engine';
import { Bar, Loading, useApp, useLang, useLoad, useT } from '../ctx';
import { Page, useNav } from '../nav';
import { ManualActivity } from './Cardio';

const pad = (n: number) => String(n).padStart(2, '0');
const localDate = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const tz = () => new Date().getTimezoneOffset();

interface CalDay { date: string; kcal: number; waterMl: number; meals: number; sessions: number; activities: number }
/** Colour of a day by food eaten vs the daily target: a quick way to spot a day that went wrong. */
const band = (kcal: number, target: number | null) => {
  if (!kcal) return 'none';
  if (!target) return 'ok';
  const r = kcal / target;
  return r > 1.25 ? 'high2' : r > 1.08 ? 'high' : r >= 0.88 ? 'ok' : r >= 0.65 ? 'low' : 'low2';
};

/** Month calendar: tap a day to see (and fix) what was eaten and trained. */
export function Calendar() {
  const t = useT(), nav = useNav();
  const now = new Date();
  const [ym, setYm] = useState({ y: now.getFullYear(), m: now.getMonth() });
  const month = `${ym.y}-${pad(ym.m + 1)}`;
  const cal = useLoad<{ targetKcal: number | null; days: CalDay[] }>(`/api/calendar?month=${month}&timezoneOffset=${tz()}`, [month]);
  const shift = (n: number) => { const d = new Date(ym.y, ym.m + n, 1); setYm({ y: d.getFullYear(), m: d.getMonth() }); };
  const first = new Date(ym.y, ym.m, 1), blanks = (first.getDay() + 6) % 7, count = new Date(ym.y, ym.m + 1, 0).getDate();
  const by = new Map((cal.data?.days ?? []).map((d) => [d.date, d]));
  const today = localDate();
  const wd = [1, 2, 3, 4, 5, 6, 0].map((i) => new Date(2024, 0, 7 + i).toLocaleDateString(undefined, { weekday: 'narrow' }));
  return (
    <Page title={t('calendarTitle')} sub={t('calendarSub')}>
      <div className="row between">
        <button className="iconbtn" aria-label={t('prevMonth')} onClick={() => shift(-1)}>‹</button>
        <h3 style={{ flex: 1, textAlign: 'center', textTransform: 'capitalize' }}>{first.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}</h3>
        <button className="iconbtn" aria-label={t('nextMonth')} onClick={() => shift(1)}>›</button>
      </div>
      {!cal.data ? <Loading err={cal.err} retry={cal.reload} /> : (
        <div className="calgrid" role="grid">
          {wd.map((w, i) => <span key={i} className="calhead">{w}</span>)}
          {Array.from({ length: blanks }).map((_, i) => <span key={'b' + i} />)}
          {Array.from({ length: count }).map((_, i) => {
            const date = `${month}-${pad(i + 1)}`, d = by.get(date), future = date > today;
            return (
              <button key={date} disabled={future} className={`calday b-${band(d?.kcal ?? 0, cal.data!.targetKcal)}${date === today ? ' today' : ''}`} aria-label={`${date}${d ? ` · ${d.kcal} kcal` : ''}`} onClick={() => nav.push('dayDetail', { date })}>
                <b>{i + 1}</b>
                <small>{d?.kcal ? d.kcal : ''}</small>
                <span className="dots" aria-hidden>{d && d.sessions > 0 && '💪'}{d && d.activities > 0 && '🏃'}</span>
              </button>);
          })}
        </div>)}
      <div className="callegend small muted">
        <span><i className="b-low2" /> {t('cal_low2')}</span><span><i className="b-low" /> {t('cal_low')}</span><span><i className="b-ok" /> {t('cal_ok')}</span><span><i className="b-high" /> {t('cal_high')}</span><span><i className="b-high2" /> {t('cal_high2')}</span>
      </div>
      <p className="muted small">{t('calendarNote')}</p>
    </Page>
  );
}

interface Log { id: number; at: string; meal: string; mealType?: string; kcal: number; proteinG: number; carbsG: number; fatG: number; waterMl: number; edited?: boolean; items?: { foodId: string; grams: number }[] }
interface Ex { kind: string; name: string; kcal: number | null; id?: number; deletable?: boolean; detail?: string }
interface Day { date: string; target: { kcal: number } | null; energy: { budget: number; remaining: number; bmr: number; neat: number; exercise: number; goalAdjustment: number | null } | null; intake: { kcal: number; proteinG: number; carbsG: number; fatG: number; waterMl: number }; logs: Log[]; exercise: Ex[]; waterLogs: { id: number; ml: number }[]; balance: number | null }

/** One day broken down: every meal, drink and workout, each editable or removable. */
export function DayDetail({ date }: { date: string }) {
  const t = useT(), lang = useLang(), nav = useNav(), { toast } = useApp();
  const day = useLoad<Day>(`/api/day?date=${date}&timezoneOffset=${tz()}`, [date]);
  const [edit, setEdit] = useState<{ id: number; meal: string; kcal: string } | null>(null);
  const d = day.data;
  const run = async (fn: () => Promise<unknown>, msg?: string) => { try { await fn(); if (msg) toast(msg); day.reload(); } catch { toast(t('netError')); } };
  const title = new Date(date + 'T12:00:00').toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });
  return (
    <Page title={title}>
      {!d ? <Loading err={day.err} retry={day.reload} /> : (
        <div className="stack">
          <div className="card hero">
            <div className="row between"><h3>{d.intake.kcal} {t('kcalShort')}</h3>{d.energy && <b style={{ color: d.energy.remaining >= 0 ? 'var(--accent)' : 'var(--bad)' }}>{d.energy.remaining >= 0 ? `${d.energy.remaining} ${t('remaining')}` : `+${-d.energy.remaining} ${t('over')}`}</b>}</div>
            {d.energy && <><Bar pct={(d.intake.kcal / Math.max(1, d.energy.budget)) * 100} /><p className="muted small">{t('budgetOfDay')}: {d.energy.budget} {t('kcalShort')} = {t('bud_bmr')} {d.energy.bmr} + {t('bud_neat')} {d.energy.neat} + {t('bud_exercise')} {d.energy.exercise}{d.energy.goalAdjustment ? ` ${d.energy.goalAdjustment > 0 ? '+' : '−'} ${Math.abs(d.energy.goalAdjustment)}` : ''}</p></>}
            <p className="muted small">P {d.intake.proteinG} g · C {d.intake.carbsG} g · G {d.intake.fatG} g · 💧 {(d.intake.waterMl / 1000).toFixed(2)} L</p>
          </div>

          <div className="card">
            <div className="row between"><h3>🍽 {t('mealsOfDay')}</h3><button className="primary" onClick={() => nav.push('addFood', { date })}>＋ {t('addFood')}</button></div>
            {d.logs.filter((l) => l.kcal > 0).length === 0 && <p className="muted">{t('noMealsYet')}</p>}
            {d.logs.filter((l) => l.kcal > 0).map((l) => (
              <div key={l.id} className="logrow">
                {edit?.id === l.id ? (
                  <div className="stack">
                    <label>{t('mealName')}<input value={edit.meal} onChange={(e) => setEdit({ ...edit, meal: e.target.value })} /></label>
                    <label>{t('kcalShort')}<input inputMode="numeric" value={edit.kcal} onChange={(e) => setEdit({ ...edit, kcal: e.target.value.replace(/\D/g, '') })} /></label>
                    <div className="row"><button className="primary" disabled={!edit.meal.trim() || edit.kcal === ''} onClick={() => run(async () => { await api('PATCH', `/api/nutrition/log/${l.id}`, { meal: edit.meal.trim(), kcal: Number(edit.kcal) }); setEdit(null); }, t('saved'))}>{t('save')}</button><button onClick={() => setEdit(null)}>{t('cancel')}</button></div>
                  </div>
                ) : (
                  <>
                    <div className="row between top">
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <b>{l.meal}</b>{l.edited && <span className="badge" style={{ marginLeft: 6 }}>{t('edited')}</span>}
                        <div className="muted small">{t('k_' + (l.mealType ?? 'snack'))} · {new Date(l.at).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })} · P{Math.round(l.proteinG)} C{Math.round(l.carbsG)} G{Math.round(l.fatG)}</div>
                        {l.items && l.items.length > 0 && <div className="muted small">{l.items.map((i) => { const f = foodById(i.foodId); return f ? `${foodName(f, lang)} ${i.grams}${f.liquid ? 'ml' : 'g'}` : null; }).filter(Boolean).join(' · ')}</div>}
                      </div>
                      <b className="nowrap">{l.kcal}</b>
                    </div>
                    <div className="row"><button onClick={() => setEdit({ id: l.id, meal: l.meal, kcal: String(l.kcal) })}>✎ {t('edit')}</button><button className="danger" onClick={() => run(() => api('DELETE', `/api/nutrition/log/${l.id}`), t('removed'))}>🗑 {t('remove')}</button></div>
                  </>)}
              </div>))}
            {d.logs.some((l) => l.kcal > 0 || l.waterMl > 0) && <button className="danger" onClick={() => { if (confirm(t('clearDayConfirm'))) void run(() => api('DELETE', `/api/nutrition/day?date=${date}&timezoneOffset=${tz()}`), t('removed')); }}>{t('clearDay')}</button>}
          </div>

          <div className="card">
            <h3>💧 {t('waterLabel')}</h3>
            {d.waterLogs.length === 0 ? <p className="muted">—</p> : d.waterLogs.map((w) => <div className="row between" key={w.id}><span>{w.ml} ml</span><button aria-label={t('remove')} onClick={() => run(() => api('DELETE', `/api/nutrition/log/${w.id}`))}>🗑</button></div>)}
          </div>

          <div className="card">
            <h3>🏃 {t('trainingOfDay')}</h3>
            {d.exercise.length === 0 && <p className="muted">{t('bud_noExercise')}</p>}
            {d.exercise.map((e, i) => (
              <div className="row between top logrow" key={i}>
                <div style={{ flex: 1, minWidth: 0 }}><b>{t(e.name === 'strength' ? 'kind_strength' : e.name)}</b>{e.detail && <div className="muted small">{e.detail}</div>}</div>
                <b className="nowrap">{e.kcal ?? '—'} {t('kcalShort')}</b>
                {e.deletable && e.id !== undefined && <button aria-label={t('remove')} onClick={() => { if (confirm(t('removeConfirm'))) void run(() => api('DELETE', e.kind === 'gps' ? `/api/activities/${e.id}` : e.kind === 'strength' ? `/api/workouts/${e.id}` : `/api/nutrition/exercise/${e.id}`), t('removed')); }}>🗑</button>}
              </div>))}
            <ManualActivity date={date} onSaved={day.reload} />
          </div>
        </div>)}
    </Page>
  );
}
