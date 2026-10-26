import { useMemo, useState } from 'react';
import { api } from '../api';
import { byId, CATALOG, ROUTINES, routineById, routineWeekDays, type Exercise, type Muscle, type Routine } from '@fondal/engine';
import { EXINFO } from '../exinfo';
import { ExerciseVisual } from '../anatomy';
import { LineChart } from '../charts';
import { Chips, useApp, useLang, useLoad, useT, type Lang } from '../ctx';
import { Page, useNav } from '../nav';

const IDX: Record<Lang, 0 | 1 | 2> = { es: 0, en: 1, pt: 2 };
const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const MUSCLES: Muscle[] = ['quads', 'hamstrings', 'glutes', 'chest', 'back', 'shoulders', 'biceps', 'triceps', 'core', 'calves', 'full'];
const EQUIP = ['none', 'dumbbells', 'barbell', 'machines', 'bands', 'bar'];

export const fmtReps = (ex: Exercise | undefined, min: number, max: number) => `${min === max ? min : `${min}–${max}`}${ex?.timed ? ' s' : ''}`;

/* ------------------------------------------------------------------ exercises */
export function ExerciseLibrary() {
  const t = useT(), lang = useLang(), nav = useNav();
  const [q, setQ] = useState('');
  const [muscle, setMuscle] = useState<string[]>([]);
  const [equip, setEquip] = useState<string[]>([]);
  const [level, setLevel] = useState<string[]>([]);
  const list = useMemo(() => CATALOG.filter((e) =>
    (!q || norm(t('ex_' + e.id)).includes(norm(q))) && (!muscle.length || e.muscle === muscle[0]) && (!equip.length || e.equipment.includes(equip[0] as never)) && (!level.length || e.level === Number(level[0]))
  ).sort((a, b) => t('ex_' + a.id).localeCompare(t('ex_' + b.id), lang)), [q, muscle, equip, level, t, lang]);
  const toggle = (set: (v: string[]) => void, cur: string[]) => (v: string[]) => set(cur[0] === v[0] ? [] : v);
  return (
    <Page title={t('exercises')} sub={`${CATALOG.length} ${t('exercises_count')}`}>
      <div className="searchbar"><input type="search" aria-label={t('search')} placeholder={t('search')} value={q} onChange={(e) => setQ(e.target.value)} /></div>
      <h3>{t('muscle')}</h3><Chips options={MUSCLES} value={muscle} onChange={toggle(setMuscle, muscle)} label={(m) => t('m_' + m)} />
      <h3>{t('equipment')}</h3><Chips options={EQUIP} value={equip} onChange={toggle(setEquip, equip)} />
      <h3>{t('level')}</h3><Chips options={['1', '2', '3']} value={level} onChange={toggle(setLevel, level)} label={(l) => t('lv' + l)} />
      <p className="muted" role="status">{list.length} {t('results')}</p>
      <div className="list">
        {list.map((e) => (
          <button key={e.id} onClick={() => nav.push('exercise', { id: e.id })}>
            <span><b>{t('ex_' + e.id)}</b><span className="sub">{t('m_' + e.muscle)} · {e.equipment.map((q) => t(q)).join(', ')}{e.timed ? ' · ' + t('timed') : ''}</span></span>
            <span className={'badge lv' + e.level}>{t('lv' + e.level)}</span>
          </button>
        ))}
        {!list.length && <div className="empty"><div className="em">🔎</div><p>{t('noResults')}</p></div>}
      </div>
    </Page>
  );
}

export function ExerciseDetail({ id }: { id: string }) {
  const t = useT(), lang = useLang(), nav = useNav();
  const ex = byId(id), info = EXINFO[id];
  const prog = useLoad<{ series: { date: string; e1rm: number; topWeight: number; topReps: number }[] }>(`/api/progress/exercise/${id}`);
  if (!ex || !info) return <Page title="?"><p className="muted">{t('noResults')}</p></Page>;
  const steps = info.how[IDX[lang]].split('|').map((s) => s.trim());
  const alt = CATALOG.filter((e) => e.muscle === ex.muscle && e.id !== ex.id && e.pattern !== 'mobility' && e.level <= Math.min(3, ex.level + 1)).slice(0, 6);
  const series = prog.data?.series ?? [];
  return (
    <Page title={t('ex_' + id)} sub={`${t('m_' + ex.muscle)} · ${t('lv' + ex.level)}`}>
      <div className="card">
        <div className="chips">
          <span className="badge">{t('m_' + ex.muscle)}</span>
          {ex.secondary?.map((m) => <span key={m} className="badge">{t('m_' + m)}</span>)}
          {ex.equipment.map((e) => <span key={e} className="badge">{t(e)}</span>)}
          {ex.timed && <span className="badge">{t('timed')}</span>}
          {ex.stresses.length > 0 && <span className="badge warn" title={t('stresses')}>⚠ {ex.stresses.map((s) => t(s)).join(', ')}</span>}
        </div>
        <ExerciseVisual id={id} />
        <h3>{t('howTo')}</h3>
        <ol className="steps">{steps.map((s, i) => <li key={i}>{s}</li>)}</ol>
        <div className="cue"><b>{t('keyCue')}:</b> {info.tip[IDX[lang]]}</div>
        <p className="muted small">{t('formDisclaimer')}</p>
      </div>
      {series.length > 0 && <div className="card"><h3>{t('myProgress')}</h3>
        <LineChart title={t('e1rm')} unit="kg" points={series.map((s) => ({ x: Date.parse(s.date), y: s.e1rm }))} fmtX={(x) => new Date(x).toLocaleDateString(lang, { day: 'numeric', month: 'short' })} />
        <p className="muted small">{t('e1rmNote')}</p></div>}
      {alt.length > 0 && <div className="card"><h3>{t('alternatives')}</h3><div className="list">{alt.map((e) => <button key={e.id} onClick={() => nav.push('exercise', { id: e.id })}><span><b>{t('ex_' + e.id)}</b><span className="sub">{e.equipment.map((q) => t(q)).join(', ')}</span></span><span className={'badge lv' + e.level}>{t('lv' + e.level)}</span></button>)}</div></div>}
    </Page>
  );
}

/* ------------------------------------------------------------------ routines */
const TAGS = ['strength', 'hypertrophy', 'running', 'cycling', 'hiit', 'mobility', 'hybrid', 'calisthenics', 'health'];
const PLACES = ['gym', 'home', 'bodyweight', 'outdoor'];

export function RoutineLibrary() {
  const t = useT(), nav = useNav();
  const [tag, setTag] = useState<string[]>([]);
  const [place, setPlace] = useState<string[]>([]);
  const [level, setLevel] = useState<string[]>([]);
  const toggle = (set: (v: string[]) => void, cur: string[]) => (v: string[]) => set(cur[0] === v[0] ? [] : v);
  const list = ROUTINES.filter((r) => (!tag.length || r.tags.includes(tag[0] as never)) && (!place.length || r.place === place[0]) && (!level.length || r.level === Number(level[0])));
  return (
    <Page title={t('routines')} sub={`${ROUTINES.length} ${t('routines_count')}`}>
      <h3>{t('type')}</h3><Chips options={TAGS} value={tag} onChange={toggle(setTag, tag)} label={(x) => t('tag_' + x)} />
      <h3>{t('where')}</h3><Chips options={PLACES} value={place} onChange={toggle(setPlace, place)} label={(x) => t('place_' + x)} />
      <h3>{t('level')}</h3><Chips options={['1', '2', '3']} value={level} onChange={toggle(setLevel, level)} label={(l) => t('lv' + l)} />
      <p className="muted" role="status">{list.length} {t('results')}</p>
      <div className="stack">
        {list.map((r) => <RoutineCard key={r.id} r={r} onOpen={() => nav.push('routine', { id: r.id })} />)}
        {!list.length && <div className="empty"><div className="em">🔎</div><p>{t('noResults')}</p></div>}
      </div>
    </Page>
  );
}

function RoutineCard({ r, onOpen }: { r: Routine; onOpen: () => void }) {
  const t = useT(), lang = useLang(), i = IDX[lang];
  return (
    <button className="card" style={{ width: '100%', textAlign: 'left' }} onClick={onOpen}>
      <div className="row between"><h3 style={{ margin: 0 }}>{r.n[i]}</h3><span className={'badge lv' + r.level}>{t('lv' + r.level)}</span></div>
      <p className="muted">{r.d[i]}</p>
      <div className="chips"><span className="badge">{r.perWeek}×/{t('week_short')}</span>{r.weeks > 1 && <span className="badge">{r.weeks} {t('weeks')}</span>}<span className="badge">{t('place_' + r.place)}</span>{r.tags.slice(0, 2).map((x) => <span key={x} className="badge">{t('tag_' + x)}</span>)}</div>
    </button>
  );
}

export function RoutineDetail({ id }: { id: string }) {
  const t = useT(), lang = useLang(), i = IDX[lang], nav = useNav(), { toast } = useApp();
  const r = routineById(id);
  const plan = useLoad<{ plan: unknown | null }>('/api/plan');
  const [week, setWeek] = useState(0);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);
  if (!r) return <Page title="?"><p className="muted">{t('noResults')}</p></Page>;
  const days = routineWeekDays(r, week);
  const adopt = async () => {
    setBusy(true);
    try { await api('POST', '/api/plan/adopt', { routineId: r.id }); toast(t('planAdopted')); nav.go('train'); } catch { toast(t('netError')); } finally { setBusy(false); setConfirm(false); }
  };
  const hasPlan = !!plan.data?.plan;
  return (
    <Page title={r.n[i]} sub={`${r.perWeek}×/${t('week_short')} · ${t('place_' + r.place)} · ${t('lv' + r.level)}`}>
      <div className="card hero"><p>{r.d[i]}</p>
        <div className="chips">{r.tags.map((x) => <span key={x} className="badge">{t('tag_' + x)}</span>)}{r.equipment.filter((e) => e !== 'none').map((e) => <span key={e} className="badge">{t(e)}</span>)}</div>
        {!confirm ? <p><button className="primary" onClick={() => (hasPlan ? setConfirm(true) : adopt())}>{t('useAsPlan')}</button></p>
          : <div className="card alert"><p>{t('replacePlanWarn')}</p><div className="row"><button className="primary" disabled={busy} onClick={adopt}>{t('confirm')}</button><button onClick={() => setConfirm(false)}>{t('cancel')}</button></div></div>}
      </div>
      {r.weeks > 1 && <div className="card"><h3>{t('weekN')}</h3><div className="chips">{r.program.map((_, w) => <button key={w} className={'chip' + (w === week ? ' on' : '')} onClick={() => setWeek(w)}>{w + 1}</button>)}</div></div>}
      {days.map((d, di) => (
        <div className="card" key={di}>
          <div className="row between"><h3 style={{ margin: 0 }}>{r.program[week]![di]!.n[i]}</h3><span className="badge">{t('kind_' + d.kind)}</span></div>
          {d.kind === 'cardio' && d.cardio ? (
            <div><p>{t(d.cardio.modality)} · {t('ct_' + d.cardio.type)} · {d.cardio.durationMin} {t('minutes_short')}</p>
              {r.program[week]![di]!.note && <p className="muted">{r.program[week]![di]!.note![i]}</p>}
              {d.cardio.intervals && <p className="muted">{t('intervalsDesc', { n: d.cardio.intervals.reps, w: d.cardio.intervals.workSec >= 60 ? `${Math.round(d.cardio.intervals.workSec / 6) / 10} min` : `${d.cardio.intervals.workSec} s`, r: d.cardio.intervals.restSec >= 60 ? `${Math.round(d.cardio.intervals.restSec / 6) / 10} min` : `${d.cardio.intervals.restSec} s` })}</p>}
              <button onClick={() => nav.go('cardio')}>{t('startCardio')}</button></div>
          ) : (
            <>
              <div className="list">{d.items.map((it) => { const ex = byId(it.exerciseId); return (
                <button key={it.exerciseId} onClick={() => nav.push('exercise', { id: it.exerciseId })}><span><b>{t('ex_' + it.exerciseId)}</b><span className="sub">{it.sets} × {fmtReps(ex, it.repMin, it.repMax)}{it.restSec ? ` · ${t('restTime')} ${it.restSec >= 60 ? Math.round(it.restSec / 6) / 10 + '′' : it.restSec + ' s'}` : ''}</span></span><span aria-hidden>›</span></button>); })}</div>
              <button className="primary" onClick={() => nav.push('session', { free: true, name: r.program[week]![di]!.n[i], day: d })}>{t('doNow')}</button>
            </>
          )}
        </div>
      ))}
    </Page>
  );
}
