import { useMemo, useState } from 'react';
import { api, ApiError } from '../api';
import { byId, CATALOG, ROUTINES, routineById, routineWeekDays, type CardioType, type Muscle } from '@fondal/engine';
import { Chips, Loading, useApp, useLang, useLoad, useT } from '../ctx';
import { Page, useNav } from '../nav';

interface Student { linkId: number; id: number; name: string; email: string; limits: { maxLoadIncreasePct: number; maxWeeklyVolumeDeltaPct: number; maxSessionsPerWeek: number; allowAutoDeload: boolean }; lastSession: string | null; sessions30: number; recovery: { score: number; alerts: string[] } | null; pendingApprovals: number }
interface TplItem { exerciseId: string; sets: number; repMin: number; repMax: number; rirTarget: number; restSec?: number; load: number }
interface TplDay { name: string; kind: 'strength' | 'cardio'; format?: 'standard'|'superset'|'circuit'; items: TplItem[]; cardio?: { modality: 'run' | 'bike'; type: 'zone2' | 'intervals' | 'tempo' | 'long' | 'walkrun'; durationMin: number } }
interface Tpl { id?: number; name: string; goal: string; notes?: string; days: TplDay[] }
const GOALS = ['hypertrophy', 'strength', 'recomposition', 'fat_loss', 'endurance', 'vo2max', 'general', 'mobility'];
const ago = (iso: string | null) => (iso ? Math.max(0, Math.floor((Date.now() - Date.parse(iso)) / 864e5)) : null);

/* ------------------------------------------------------------------ students */
export function ProStudents() {
  const t = useT(), nav = useNav(), { toast } = useApp();
  const list = useLoad<Student[]>('/api/pro/athletes');
  const code = useLoad<{ code: string | null }>('/api/pro/code');
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const copy = async () => { try { await navigator.clipboard.writeText(code.data?.code ?? ''); toast(t('copied')); } catch { toast(code.data?.code ?? ''); } };
  const share = async () => { try { await navigator.share?.({ title: 'Fondal Fit', text: `${t('joinMsg')} ${code.data?.code}` }); } catch { void copy(); } };
  return (
    <div className="stack">
      <h2>{t('athletes')}</h2>
      <section className="card hero"><h3>Diseñá las rutinas de tus alumnos</h3><p className="muted">Desde el Creador de rutinas podés armar programas de fuerza y cardio, guardarlos y asignarlos a cualquier deportista vinculado.</p><button className="primary" onClick={()=>nav.go('studio')}>Abrir creador de rutinas →</button></section>
      <div className="card hero"><p className="muted small">{t('yourCode')}</p>
        <p className="big" style={{ letterSpacing: '.18em', fontFamily: 'monospace' }}>{code.data?.code ?? '········'}</p>
        <p className="muted">{t('codeHelp')}</p>
        <div className="row"><button className="primary" onClick={copy}>{t('copy')}</button><button onClick={share}>{t('share')}</button><button onClick={async () => { if (confirm(t('rotateConfirm'))) { await api('POST', '/api/pro/code/rotate'); code.reload(); } }}>{t('rotate')}</button></div></div>
      <form className="card" onSubmit={async (e) => { e.preventDefault(); await api('POST', '/api/pro/invites', { email }); setSent(true); setEmail(''); }}>
        <h3>{t('invite')}</h3><div className="row"><input type="email" required aria-label={t('email')} value={email} onChange={(e) => setEmail(e.target.value)} /><button className="primary" style={{ flex: 'none' }}>{t('send')}</button></div>{sent && <p className="ok" role="status">{t('inviteSent')}</p>}</form>
      {!list.data ? <Loading err={list.err} retry={list.reload} /> : list.data.length === 0 ? <div className="empty"><div className="em">👥</div><p>{t('noStudents')}</p></div> : list.data.map((s) => {
        const d = ago(s.lastSession);
        return (
          <button className="card" style={{ width: '100%', textAlign: 'left' }} key={s.id} onClick={() => nav.push('student', { id: s.id })}>
            <div className="row between"><h3 style={{ margin: 0 }}>{s.name}</h3>{s.pendingApprovals > 0 && <span className="badge lv2">{s.pendingApprovals} {t('pendingShort')}</span>}</div>
            <p className="muted small" style={{ margin: '4px 0' }}>{t('lastSession')}: {d === null ? '—' : d === 0 ? t('todayWord') : `${d} ${t('daysAgo')}`} · {t('sessions30')}: {s.sessions30}{s.recovery ? ` · ${t('score')} ${s.recovery.score}` : ''}</p>
            {s.recovery?.alerts.map((a) => <span key={a} className="badge lv2" style={{ marginRight: 6 }}>{t('a_' + a)}</span>)}
          </button>
        );
      })}
    </div>
  );
}

export function ProStudent({ id }: { id: number }) {
  const t = useT(), lang = useLang(), { toast } = useApp(), nav = useNav();
  const list = useLoad<Student[]>('/api/pro/athletes');
  const fb = useLoad<{ workouts: { date: string; dayIndex: number; fatigue: number | null; exercises: { exerciseId: string; sets: number; best: { weight: number; reps: number } }[] }[]; activities: { sport: string; started_at: string; duration_sec: number; distance_m: number }[]; recovery: { score: number; at: string; alerts: string[] }[] }>(`/api/pro/athletes/${id}/training-feedback`);
  const sum = useLoad<{ assessment: { goal: string; experience: string; strengthDays: number; cardioDays: number; restrictions: string[]; profile?: { weightKg: number } } | null }>(`/api/pro/athletes/${id}/summary`);
  const tpls = useLoad<(Tpl & { id: number })[]>('/api/pro/templates');
  const [pick, setPick] = useState<number | ''>('');
  const s = list.data?.find((x) => x.id === id);
  const [lim, setLim] = useState<Student['limits'] | null>(null);
  if (!s) return <Page title="…"><Loading err={list.err} retry={list.reload} /></Page>;
  const limits = lim ?? s.limits;
  const save = async () => { await api('PUT', `/api/pro/athletes/${id}/limits`, limits); toast(t('saved')); list.reload(); };
  const assign = async () => { try { await api('POST', `/api/pro/templates/${pick}/assign`, { athleteId: id }); toast(t('assigned')); } catch { toast(t('invalid')); } };
  const a = sum.data?.assessment;
  return (
    <Page title={s.name} sub={s.email}>
      {a && <div className="card"><h3>{t('profileSummary')}</h3><p>{t('g_' + a.goal)} · {t(a.experience)} · {a.strengthDays}+{a.cardioDays} {t('daysWord')}{a.restrictions.length ? ` · ⚠ ${a.restrictions.map((r) => t(r)).join(', ')}` : ''}</p></div>}
      <div className="card"><h3>{t('assignRoutine')}</h3>
        {!tpls.data?.length ? <p className="muted">{t('noTemplates')}</p> : <><select value={pick} onChange={(e) => setPick(e.target.value ? Number(e.target.value) : '')} aria-label={t('assignRoutine')}><option value="">—</option>{tpls.data.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select><p><button className="primary" disabled={pick === ''} onClick={assign}>{t('assign')}</button></p></>}
        <button className="link" onClick={() => nav.go('studio')}>{t('studio')} →</button></div>
      <div className="card"><h3>{t('feedback')}</h3>
        {!fb.data ? <Loading err={fb.err} retry={fb.reload} /> : <>
          {fb.data.workouts.length === 0 && <p className="muted">{t('noData')}</p>}
          {fb.data.workouts.slice(0, 6).map((w, i) => <div key={i} style={{ margin: '8px 0' }}><div className="row between small"><b>{new Date(w.date).toLocaleDateString(lang, { day: 'numeric', month: 'short' })}</b><span className="muted">{t('fatigue')} {w.fatigue ?? '–'}</span></div>
            <p className="muted small" style={{ margin: 0 }}>{w.exercises.map((e) => `${t('ex_' + e.exerciseId)} ${e.best.weight}×${e.best.reps}`).join(' · ')}</p></div>)}
          {fb.data.activities.length > 0 && <p className="muted small">🏃 {fb.data.activities.slice(0, 3).map((x) => `${t(x.sport)} ${(x.distance_m / 1000).toFixed(1)} km`).join(' · ')}</p>}
          {fb.data.recovery.length > 0 && <p className="muted small">😴 {fb.data.recovery.map((r) => r.score).join(' · ')}</p>}</>}</div>
      <div className="card"><h3>{t('limits')}</h3><p className="muted small">{t('limitsHelp')}</p>
        {([['maxLoadIncreasePct', 'maxLoad'], ['maxWeeklyVolumeDeltaPct', 'maxVol'], ['maxSessionsPerWeek', 'maxSess']] as const).map(([k, l]) => <label key={k}>{t(l)}<input type="number" value={limits[k]} onChange={(e) => setLim({ ...limits, [k]: Number(e.target.value) })} /></label>)}
        <label className="check"><input type="checkbox" checked={limits.allowAutoDeload} onChange={(e) => setLim({ ...limits, allowAutoDeload: e.target.checked })} />{t('autoDeload')}</label>
        <button className="primary" onClick={save}>{t('save')}</button></div>
      <button className="danger" onClick={async () => { if (confirm(t('revokeConfirm'))) { await api('POST', `/api/links/${s.linkId}/revoke`); toast(t('saved')); nav.back(); } }}>{t('revoke')}</button>
    </Page>
  );
}

/* ------------------------------------------------------------------ studio */
export function ProStudio() {
  const t = useT(), nav = useNav(), { toast } = useApp();
  const tpls = useLoad<(Tpl & { id: number })[]>('/api/pro/templates');
  const [lib, setLib] = useState(false);
  const students = useLoad<Student[]>('/api/pro/athletes');
  const [assignment,setAssignment]=useState<Record<number,string>>({});
  const [assignBusy,setAssignBusy]=useState<number|null>(null);
  const [assignMessage,setAssignMessage]=useState('');
  const assignFromStudio=async(templateId:number)=>{
    const athleteId=Number(assignment[templateId]);
    if(!athleteId)return;
    const selected=students.data?.find(x=>x.id===athleteId);
    if(!selected||!window.confirm('¿Asignar esta rutina a '+selected.name+'? Reemplazará su plan activo y conservará el historial.'))return;
    setAssignBusy(templateId);setAssignMessage('');
    try{await api('POST',`/api/pro/templates/${templateId}/assign`,{athleteId});setAssignMessage('Rutina asignada correctamente a '+selected.name+'.');}
    catch{setAssignMessage('No se pudo asignar. Revisá que el alumno esté vinculado y activo.');}
    finally{setAssignBusy(null);}
  };
  const fromRoutine = async (rid: string) => {
    const r = routineById(rid)!;
    const days: TplDay[] = routineWeekDays(r, 0).map((d, i) => ({
      name: r.program[0]![i]!.n[0], kind: (d.kind === 'cardio' ? 'cardio' : 'strength') as 'cardio' | 'strength',
      items: d.items.map((it) => ({ exerciseId: it.exerciseId, sets: it.sets, repMin: it.repMin, repMax: it.repMax, rirTarget: it.rirTarget, restSec: it.restSec, load: 0 })),
      cardio: d.cardio && d.cardio.type !== 'walkrun' ? { modality: d.cardio.modality, type: d.cardio.type, durationMin: d.cardio.durationMin } : undefined,
    })).filter((d) => (d.kind === 'cardio' ? !!d.cardio : d.items.length > 0));
    try { await api('POST', '/api/pro/templates', { name: r.n[0], goal: r.goal, notes: r.d[0], days }); toast(t('saved')); setLib(false); tpls.reload(); } catch { toast(t('invalid')); }
  };
  return (
    <div className="stack">
      <div className="card hero"><h2>Creador de rutinas profesionales</h2>
        <p>Armá programas para tus alumnos con ejercicios, series, repeticiones, descansos y sesiones de cardio. Guardalos y asignáselos desde acá.</p>
        <ol className="muted"><li>Creá una rutina o elegí una plantilla.</li><li>Definí objetivo, jornadas y ejercicios.</li><li>Guardá la rutina y asignala a un alumno vinculado.</li></ol>
        <div className="row"><button className="primary" onClick={() => nav.push('studio_edit', {})}>＋ Crear rutina desde cero</button><button onClick={() => setLib(v=>!v)}>Usar una rutina de ejemplo</button></div>
      </div>
      {assignMessage&&<p role="status" className={assignMessage.startsWith('No se')?'warn':'ok'}>{assignMessage}</p>}
      {lib && <div className="card list">{ROUTINES.filter((r) => r.weeks === 1 && !r.tags.includes('mobility')).map((r) => <button key={r.id} onClick={() => fromRoutine(r.id)}><span><b>{r.n[0]}</b><span className="sub">{r.perWeek}×/{t('week_short')}</span></span><span>＋</span></button>)}</div>}
      {!tpls.data ? <Loading err={tpls.err} retry={tpls.reload} /> : tpls.data.length === 0 ? <div className="empty"><div className="em">📝</div><p>{t('noTemplates')}</p></div> : tpls.data.map((x) => (
        <div className="card" key={x.id}>
          <div className="row between"><h3 style={{ margin: 0 }}>{x.name}</h3><span className="badge">{x.days.length} {t('daysWord')}</span></div>
          <p className="muted small">{t('g_' + x.goal)}{x.notes ? ` · ${x.notes}` : ''}</p>
          <details><summary>Ver jornadas y ejercicios</summary>{x.days.map((d,i)=><div key={i} className="muted small"><strong>{d.name}</strong> · {d.kind==='cardio'?`${d.cardio?.durationMin??0} min de cardio`:d.items.map(it=>`${t('ex_'+it.exerciseId)} ${it.sets}×${it.repMin}-${it.repMax}`).join(' · ')}</div>)}</details>
          <div className="row"><label style={{flex:'2 1 180px'}}>Asignar a un alumno<select value={assignment[x.id]??''} onChange={e=>setAssignment(prev=>({...prev,[x.id]:e.target.value}))}><option value="">Elegí un alumno vinculado</option>{students.data?.map(a=><option key={a.id} value={a.id}>{a.name}</option>)}</select></label><button type="button" className="primary" disabled={!assignment[x.id]||assignBusy===x.id} onClick={()=>void assignFromStudio(x.id)}>{assignBusy===x.id?'Asignando…':'Asignar rutina'}</button></div>
          <div className="row"><button onClick={() => nav.push('studio_edit', { id: x.id })}>{t('edit')}</button><button className="danger" onClick={async () => { if (confirm(t('deleteConfirm'))) { await api('DELETE', `/api/pro/templates/${x.id}`); tpls.reload(); } }}>{t('remove')}</button></div>
        </div>))}
    </div>
  );
}

function ExercisePicker({ onPick, onClose }: { onPick: (id: string) => void; onClose: () => void }) {
  const t = useT();
  const [q, setQ] = useState(''), [m, setM] = useState<string[]>([]);
  const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const list = useMemo(() => CATALOG.filter((e) => e.pattern !== 'mobility' && (!q || norm(t('ex_' + e.id)).includes(norm(q))) && (!m.length || e.muscle === m[0])).slice(0, 60), [q, m, t]);
  return (
    <>
      <div className="scrim" onClick={onClose} />
      <div className="sheet" role="dialog" aria-label={t('addExercise')} style={{ maxHeight: '80vh', overflow: 'auto' }}>
        <div className="row between"><h3>{t('addExercise')}</h3><button onClick={onClose}>✕</button></div>
        <input type="search" aria-label={t('search')} placeholder={t('search')} value={q} onChange={(e) => setQ(e.target.value)} />
        <div style={{ margin: '8px 0' }}><Chips options={['quads', 'hamstrings', 'glutes', 'chest', 'back', 'shoulders', 'biceps', 'triceps', 'core', 'calves'] as Muscle[]} value={m} onChange={(v) => setM(m[0] === v[0] ? [] : v)} label={(x) => t('m_' + x)} /></div>
        <div className="list">{list.map((e) => <button key={e.id} onClick={() => onPick(e.id)}><span><b>{t('ex_' + e.id)}</b><span className="sub">{t('m_' + e.muscle)} · {e.equipment.map((q2) => t(q2)).join(', ')}</span></span><span>＋</span></button>)}</div>
      </div>
    </>
  );
}

export function StudioEditor({ id }: { id?: number }) {
  const t = useT(), nav = useNav(), { toast } = useApp();
  const tpls = useLoad<(Tpl & { id: number })[]>('/api/pro/templates');
  const [tpl, setTpl] = useState<Tpl | null>(id ? null : { name: '', goal: 'general', days: [{ name: 'Día 1', kind: 'strength', items: [] }] });
  const [picking, setPicking] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const cur = tpl ?? tpls.data?.find((x) => x.id === id) ?? null;
  if (!cur) return <Page title={t('editRoutine')}><Loading err={tpls.err} retry={tpls.reload} /></Page>;
  const set = (p: Partial<Tpl>) => setTpl({ ...cur, ...p });
  const setDay = (i: number, p: Partial<TplDay>) => set({ days: cur.days.map((d, j) => (j === i ? { ...d, ...p } : d)) });
  const setItem = (di: number, ii: number, p: Partial<TplItem>) => setDay(di, { items: cur.days[di]!.items.map((x, j) => (j === ii ? { ...x, ...p } : x)) });
  const save = async () => {
    setBusy(true);
    const body = { name: cur.name, goal: cur.goal, notes: cur.notes, days: cur.days.map((d) => (d.kind === 'cardio' ? { name: d.name, kind: 'cardio', items: [], cardio: d.cardio ?? { modality: 'run', type: 'zone2', durationMin: 40 } } : { name: d.name, kind: 'strength', format:d.format??'standard', items: d.items })) };
    try { if (id) await api('PUT', `/api/pro/templates/${id}`, body); else await api('POST', '/api/pro/templates', body); toast(t('saved')); nav.back(); }
    catch (e) { toast(e instanceof ApiError ? t('invalid') : t('netError')); } finally { setBusy(false); }
  };
  const num = (v: string, d: number) => (v === '' ? d : Math.max(0, Number(v) || d));
  return (
    <Page title={id ? t('editRoutine') : t('newRoutine')}>
      <div className="card"><h3>Paso 1 · Identificá el programa</h3><p className="muted">Poné un nombre reconocible, elegí el objetivo y agregá instrucciones para el alumno. Los datos se guardan como plantilla reutilizable.</p><label>{t('name')}<input value={cur.name} maxLength={80} onChange={(e) => set({ name: e.target.value })} /></label>
        <label>{t('goal')}</label><Chips options={GOALS} value={[cur.goal]} onChange={(v) => set({ goal: v[0]! })} label={(g) => t('g_' + g)} />
        <label>{t('notes')}<input value={cur.notes ?? ''} maxLength={1000} onChange={(e) => set({ notes: e.target.value })} /></label></div>
      <div className="card"><h3>Paso 2 · Armá las jornadas</h3><p className="muted">Seleccioná Fuerza o Cardio por día. Para fuerza, agregá cada ejercicio y configurá series, rango de repeticiones, RIR y descanso. Podés crear hasta 7 jornadas.</p></div>
      {cur.days.map((d, di) => (
        <div className="card" key={di}>
          <div className="row between"><input aria-label={t('name')} value={d.name} maxLength={60} onChange={(e) => setDay(di, { name: e.target.value })} /><button style={{ flex: 'none' }} aria-label={t('remove')} disabled={cur.days.length === 1} onClick={() => set({ days: cur.days.filter((_, j) => j !== di) })}>✕</button></div>
          <div className="tabs-inline"><button className={d.kind === 'strength' ? 'on' : ''} onClick={() => setDay(di, { kind: 'strength' })}>{t('kind_strength')}</button><button className={d.kind === 'cardio' ? 'on' : ''} onClick={() => setDay(di, { kind: 'cardio', cardio: d.cardio ?? { modality: 'run', type: 'zone2', durationMin: 40 } })}>{t('kind_cardio')}</button></div>
          {d.kind!=='cardio'&&<div className="card"><label>Organización de la jornada<select value={d.format??'standard'} onChange={e=>setDay(di,{format:e.target.value as 'standard'|'superset'|'circuit'})}><option value="standard">Series individuales</option><option value="superset">Superseries (alternar parejas)</option><option value="circuit">Circuito (una ronda de todos)</option></select></label><p className="muted small">{d.format==='circuit'?'Una ronda por ejercicio y después repetir hasta completar las series.':d.format==='superset'?'Alterná dos ejercicios antes del descanso largo, sin añadir volumen.':'Completá todas las series de un ejercicio antes de seguir.'}</p></div>}
          {d.kind === 'cardio' && d.cardio ? (
            <div className="grid3"><label>{t('cardioMods')}<select value={d.cardio.modality} onChange={(e) => setDay(di, { cardio: { ...d.cardio!, modality: e.target.value as 'run' | 'bike' } })}><option value="run">{t('run')}</option><option value="bike">{t('bike')}</option></select></label>
              <label>{t('type')}<select value={d.cardio.type} onChange={(e) => setDay(di, { cardio: { ...d.cardio!, type: e.target.value as CardioType } })}>{['zone2', 'intervals', 'tempo', 'long', 'walkrun'].map((x) => <option key={x} value={x}>{t('ct_' + x)}</option>)}</select></label>
              <label>{t('minutes')}<input type="number" min={5} max={360} value={d.cardio.durationMin} onChange={(e) => setDay(di, { cardio: { ...d.cardio!, durationMin: num(e.target.value, 30) } })} /></label></div>
          ) : (
            <>
              {d.items.map((it, ii) => (
                <div key={ii} style={{ borderTop: '1px solid var(--line)', padding: '8px 0' }}>
                  <div className="row between"><b>{t('ex_' + it.exerciseId)}</b><button style={{ flex: 'none', minHeight: 36 }} aria-label={t('remove')} onClick={() => setDay(di, { items: d.items.filter((_, j) => j !== ii) })}>✕</button></div>
                  <div className="grid3" style={{ gridTemplateColumns: 'repeat(5,1fr)' }}>
                    {([['sets', 'sets', 1], ['repMin', 'repMin', 1], ['repMax', 'repMax', 1], ['rirTarget', 'rir', 0], ['restSec', 'restTime', 0]] as const).map(([k, l, min]) => <label key={k} className="small">{t(l === 'repMin' ? 'reps' : l === 'repMax' ? 'repsMax' : l)}<input type="number" min={min} value={(it[k] as number | undefined) ?? ''} onChange={(e) => setItem(di, ii, { [k]: num(e.target.value, min) } as Partial<TplItem>)} /></label>)}
                  </div>
                  {byId(it.exerciseId)?.timed && <p className="muted small">{t('timedHint')}</p>}
                </div>))}
              <button onClick={() => setPicking(di)}>＋ {t('addExercise')}</button>
            </>
          )}
        </div>
      ))}
      <button onClick={() => set({ days: [...cur.days, { name: `Día ${cur.days.length + 1}`, kind: 'strength', items: [] }] })} disabled={cur.days.length >= 7}>＋ {t('addDay')}</button>
      <div className="card"><h3>Paso 3 · Revisá y guardá</h3><p className="muted">Después de guardar, volvé al Creador de rutinas para asignar este programa a un alumno vinculado.</p>
        <p><strong>{cur.name||'Rutina sin nombre'}</strong> · {cur.days.length} jornada(s) · {cur.days.reduce((n,d)=>n+d.items.length,0)} ejercicios</p>
        {cur.days.map((d,i)=><p key={i} className="muted small">{d.name}: {d.kind==='cardio'?`Cardio ${d.cardio?.durationMin??0} minutos`:d.items.map(it=>t('ex_'+it.exerciseId)).join(', ')||'Agregá ejercicios'}</p>)}
        <button className="primary big" disabled={busy || !cur.name.trim() || cur.days.some((d) => d.kind === 'strength' && d.items.length === 0)} onClick={save}>{busy?'Guardando…':'Guardar rutina profesional'}</button>
        {cur.days.some(d=>d.kind==='strength'&&d.items.length===0)&&<p className="warn">Completá los ejercicios de todas las jornadas de fuerza para guardar.</p>}
      </div>
      {picking !== null && <ExercisePicker onClose={() => setPicking(null)} onPick={(exId) => { const ex = byId(exId)!; setDay(picking, { items: [...cur.days[picking]!.items, { exerciseId: exId, sets: 3, repMin: ex.timed ? 30 : 8, repMax: ex.timed ? 45 : 12, rirTarget: 2, restSec: 90, load: 0 }] }); setPicking(null); }} />}
    </Page>
  );
}

/* ------------------------------------------------------------------ approvals */
export function ProApprovals() {
  const t = useT(), { toast } = useApp();
  const list = useLoad<{ id: number; athleteName: string; status: string; violations: string[]; change: { loadIncreasePct: number; sessionsPerWeek: number } }[]>('/api/pro/approvals');
  if (!list.data) return <Loading err={list.err} retry={list.reload} />;
  const pending = list.data.filter((a) => a.status === 'pending');
  const decide = async (id: number, approve: boolean) => { await api('POST', `/api/pro/approvals/${id}/decide`, { approve }); toast(t('saved')); list.reload(); };
  return (
    <div className="stack"><h2>{t('approvals')}</h2>
      {!pending.length ? <div className="empty"><div className="em">✅</div><p>{t('noApprovals')}</p></div> : pending.map((a) => (
        <div className="card" key={a.id}><h3>{a.athleteName}</h3>
          <p className="warn">{t('violation')}: {a.violations.map((v) => t('v_' + v)).join(', ')}</p><p className="muted small">+{a.change.loadIncreasePct}% · {a.change.sessionsPerWeek}/{t('week_short')}</p>
          <div className="row"><button className="primary" onClick={() => decide(a.id, true)}>{t('approve')}</button><button className="danger" onClick={() => decide(a.id, false)}>{t('reject')}</button></div></div>))}
    </div>
  );
}
