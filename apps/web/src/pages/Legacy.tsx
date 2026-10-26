import { useContext, useEffect, useState } from 'react';
import { api, ApiError } from '../api';
import { LangPicker, useLang, useT, type Lang, type Me, Bar } from '../ctx';
import { CATALOG } from '@fondal/engine';

export const CONSENT_KEYS = ['terms', 'health_data', 'share_with_pro', 'ai_memory', 'camera_video'];
export function Consents({ me, refresh }: { me: Me; refresh: () => void }) {
  const t = useT();
  const [c, setC] = useState<Record<string, boolean>>({ terms: false, health_data: false, share_with_pro: false, ai_memory: false, camera_video: false, ...me.consents });
  const ok = c.terms && c.health_data;
  return (
    <div className="card">
      <h2>{t('consentTitle')}</h2><p className="muted">{t('consentIntro')}</p>
      {CONSENT_KEYS.map((k) => <label key={k} className="check"><input type="checkbox" checked={!!c[k]} onChange={(e) => setC({ ...c, [k]: e.target.checked })} />{t('c_' + k)}</label>)}
      <button className="primary" disabled={!ok} onClick={async () => { await api('PUT', '/api/consents', c); refresh(); }}>{t('save')}</button>
    </div>
  );
}


export function Progress() {
  const t = useT();
  const [d, setD] = useState<{ sessions: { date: string; volume: number; sets: number }[]; total: number } | null>(null);
  const [g, setG] = useState<{ xp: number; level: number; streakWeeks: number; achievements: string[] } | null>(null);
  useEffect(() => { api('GET', '/api/progress').then(setD).catch(() => {}); api('GET', '/api/gamification').then(setG).catch(() => {}); }, []);
  if (!d) return null;
  const max = Math.max(1, ...d.sessions.map((s) => s.volume));
  return (
    <>
    {g && <div className="card"><h2>{t('level')} {g.level} · {g.xp} XP</h2><p>{t('streak')}: {g.streakWeeks}</p><div className="chips">{g.achievements.map((x) => <span key={x} className="badge ok">{t('ach_' + x)}</span>)}</div><p className="muted">{t('gamNote')}</p></div>}
    <div className="card"><h2>{t('progress')}</h2>
      {!d.total ? <p className="muted">{t('noData')}</p> : <><p>{t('sessionsDone')}: {d.total}</p>
        {d.sessions.slice(-14).map((s, i) => <div key={i}><span className="muted">{s.date.slice(0, 10)} · {Math.round(s.volume)} kg</span><div className="bar"><i style={{ width: `${(s.volume / max) * 100}%` }} /></div></div>)}</>}
    </div>
    </>
  );
}


/* ---------- Recovery ---------- */
export function Recovery() {
  const t = useT();
  const [f, setF] = useState({ sleepHours: 7, fatigue: 4, stress: 4, pain: 0 });
  const [hist, setHist] = useState<any[]>([]);
  const load = () => api('GET', '/api/recovery').then(setHist).catch(() => {});
  useEffect(() => { load(); }, []);
  const last = hist[0];
  const field = (k: keyof typeof f, label: string, min: number, max: number) => <><label>{label}: {f[k]}</label><input type="range" min={min} max={max} step={k === 'sleepHours' ? 0.5 : 1} value={f[k]} onChange={(e) => setF({ ...f, [k]: Number(e.target.value) })} /></>;
  return (
    <>
      <div className="card"><h2>{t('recovery')}</h2>
        {field('sleepHours', t('sleep'), 0, 12)}{field('fatigue', t('fatigue'), 1, 10)}{field('stress', t('stress'), 1, 10)}{field('pain', t('pain'), 0, 10)}
        <p><button className="primary" onClick={async () => { await api('POST', '/api/recovery', f); load(); }}>{t('save')}</button></p></div>
      {last && <div className="card"><h3>{t('score')}: {last.score}</h3><div className="bar"><i style={{ width: `${last.score}%` }} /></div>
        {last.alerts.map((a: string) => <p key={a} className="warn" role="alert">{t('a_' + a)}</p>)}</div>}
    </>
  );
}


/* ---------- Professional ---------- */
const LIMIT_FIELDS: [string, string][] = [['maxLoadIncreasePct', 'maxLoad'], ['maxWeeklyVolumeDeltaPct', 'maxVol'], ['maxSessionsPerWeek', 'maxSess']];

export function ProAthletes() {
  const t = useT();
  const [list, setList] = useState<any[]>([]);
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const load = () => api('GET', '/api/pro/athletes').then(setList).catch(() => {});
  useEffect(() => { load(); }, []);
  const saveLimits = async (a: any, limits: any) => { await api('PUT', `/api/pro/athletes/${a.id}/limits`, limits); load(); };
  return (
    <>
      <form className="card" onSubmit={async (e) => { e.preventDefault(); await api('POST', '/api/pro/invites', { email }); setSent(true); setEmail(''); }}>
        <h3>{t('invite')}</h3><input type="email" required aria-label={t('email')} value={email} onChange={(e) => setEmail(e.target.value)} />
        <p><button className="primary">{t('send')}</button></p>{sent && <p className="ok" role="status">{t('inviteSent')}</p>}</form>
      {list.map((a) => (
        <div className="card" key={a.id}>
          <h3>{a.name} {a.pendingApprovals > 0 && <span className="badge warn">{a.pendingApprovals}</span>}</h3>
          <p className="muted">{t('lastSession')}: {a.lastSession?.slice(0, 10) ?? '—'} · {t('sessions30')}: {a.sessions30}
            {a.recovery && <> · {t('score')}: {a.recovery.score}</>}</p>
          {a.recovery?.alerts.map((x: string) => <p key={x} className="warn">{t('a_' + x)}</p>)}
          <h3>{t('limits')}</h3>
          {LIMIT_FIELDS.map(([k, label]) => <label key={k}>{t(label)}<input type="number" defaultValue={a.limits[k]} onBlur={(e) => saveLimits(a, { ...a.limits, [k]: Number(e.target.value) })} /></label>)}
          <label className="check"><input type="checkbox" defaultChecked={a.limits.allowAutoDeload} onChange={(e) => saveLimits(a, { ...a.limits, allowAutoDeload: e.target.checked })} />{t('autoDeload')}</label>
        </div>
      ))}
    </>
  );
}

export function ProApprovals() {
  const t = useT();
  const [list, setList] = useState<any[]>([]);
  const load = () => api('GET', '/api/pro/approvals').then(setList).catch(() => {});
  useEffect(() => { load(); }, []);
  const pending = list.filter((a) => a.status === 'pending');
  const decide = async (id: number, approve: boolean) => { await api('POST', `/api/pro/approvals/${id}/decide`, { approve }); load(); };
  if (!pending.length) return <p className="muted">{t('noApprovals')}</p>;
  return <>{pending.map((a) => (
    <div className="card" key={a.id}><h3>{a.athleteName}</h3>
      <p className="warn">{t('violation')}: {a.violations.map((v: string) => t('v_' + v)).join(', ')}</p>
      <p className="muted">+{a.change.loadIncreasePct}% · {a.change.sessionsPerWeek}/wk</p>
      <div className="row"><button className="primary" onClick={() => decide(a.id, true)}>{t('approve')}</button><button className="danger" onClick={() => decide(a.id, false)}>{t('reject')}</button></div></div>
  ))}</>;
}


/* ---------- Settings ---------- */
export function Settings({ me, refresh, onLang, onLogout, onWizard }: { me: Me; refresh: () => void; onLang: (l: Lang) => void; onLogout: () => void; onWizard: () => void }) {
  const t = useT();
  const lang = useLang();
  const [links, setLinks] = useState<any[]>([]);
  const [joinCode,setJoinCode]=useState('');
  const [joinStatus,setJoinStatus]=useState('');
  const loadLinks = () => me.mode === 'athlete' && api('GET', '/api/links').then(setLinks).catch(() => {});
  useEffect(() => { loadLinks(); }, []); // eslint-disable-line
  const toggle = async (k: string, v: boolean) => { await api('PUT', '/api/consents', { [k]: v }); refresh(); loadLinks(); };
  const download = async () => {
    const data = await api('GET', '/api/export');
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })); a.download = 'fondal-export.json'; a.click();
  };
  return (
    <>
      <div className="card"><LangPicker lang={lang} onLang={onLang} /></div>
      {me.role === 'athlete' && <>
        <div className="card"><button onClick={onWizard}>{t('editPlan')}</button></div>
        <div className="card"><h3>{t('consentTitle')}</h3>
          {CONSENT_KEYS.filter((k) => k !== 'terms' && k !== 'health_data').map((k) => <label key={k} className="check"><input type="checkbox" checked={!!me.consents[k]} onChange={(e) => toggle(k, e.target.checked)} />{k === 'public_ranking' ? 'Aparecer en rankings deportivos públicos (nombre y resultados)' : k === 'ai_memory' ? t('coachMemory') : t('c_' + k)}</label>)}</div>
        <div className="card"><h3>Vincularme con mi entrenador</h3><p className="muted">Ingresá el código que te dio tu profesor para recibir rutinas y compartir tus entrenamientos.</p>
          <label>Código de vinculación<input value={joinCode} maxLength={12} placeholder="Ej.: ABCD2345" onChange={e=>setJoinCode(e.target.value.toUpperCase().trim())}/></label>
          <button className="primary" disabled={!me.consents.share_with_pro||joinCode.length<6} onClick={async()=>{try{const result=await api<{proName:string}>('POST','/api/links/join-code',{code:joinCode});setJoinStatus('Vinculado con '+result.proName);setJoinCode('');loadLinks();}catch{setJoinStatus('Código inválido o vínculo no disponible.');}}}>Vincularme</button>
          {!me.consents.share_with_pro&&<p className="warn">Primero activá el permiso de compartir datos con el profesional.</p>}{joinStatus&&<p role="status">{joinStatus}</p>}
        </div>
        <div className="card"><h3>{t('invitations')}</h3>
          {links.map((l) => <div className="row" key={l.id}><span>{l.proName} <span className="badge">{t(l.status)}</span></span>
            {l.status === 'pending' && <button className="primary" disabled={!me.consents.share_with_pro} onClick={async () => { await api('POST', `/api/links/${l.id}/accept`); loadLinks(); }}>{t('accept')}</button>}
            {l.status !== 'revoked' && <button className="danger" onClick={async () => { await api('POST', `/api/links/${l.id}/revoke`); loadLinks(); }}>{t('revoke')}</button>}</div>)}
          {links.some((l) => l.status === 'pending') && !me.consents.share_with_pro && <p className="muted">{t('c_share_with_pro')}</p>}</div></>}
      <div className="card"><h3>{t('subscription')}</h3>
        <p>{t('trialUntil')} {me.subscription.trialEndsAt.slice(0, 10)} {me.subscription.canceled && <span className="badge">{t('canceled')}</span>}</p>
        <p className="muted">{t('paymentsNote')}</p>
        {!me.subscription.canceled && <button onClick={async () => { await api('POST', '/api/subscription/cancel'); refresh(); }}>{t('cancelSub')}</button>}</div>
      <div className="card row"><button onClick={download}>{t('export')}</button>
        <button className="danger" onClick={async () => { if (confirm(t('confirmDelete'))) { await api('DELETE', '/api/me'); onLogout(); } }}>{t('deleteAccount')}</button></div>
    </>
  );
}
