import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { api, ApiError, hasToken, setToken } from './api';
import { LANGS, translate, type Lang } from './i18n';

/* ---------- i18n context ---------- */
const LangCtx = createContext<{ lang: Lang; t: (k: string) => string }>({ lang: 'es', t: (k) => k });
const useT = () => useContext(LangCtx).t;

const initialLang = (): Lang => {
  try { const s = localStorage.getItem('ff_lang') as Lang | null; if (s && LANGS.includes(s)) return s; } catch { /* ignore */ }
  const n = navigator.language.slice(0, 2);
  return (LANGS as string[]).includes(n) ? (n as Lang) : 'es';
};

interface Me { id: number; name: string; role: 'athlete' | 'pro' | 'admin'; lang: Lang; subscription: { plan: string; trialEndsAt: string; active: boolean; canceled: boolean }; consents: Record<string, boolean> }

export function App() {
  const [lang, setLang] = useState<Lang>(initialLang);
  const [me, setMe] = useState<Me | null>(null);
  const [ready, setReady] = useState(!hasToken());
  const t = useCallback((k: string) => translate(lang, k), [lang]);
  const ctx = useMemo(() => ({ lang, t }), [lang, t]);

  const changeLang = (l: Lang) => {
    setLang(l);
    try { localStorage.setItem('ff_lang', l); } catch { /* ignore */ }
    document.documentElement.lang = l;
    if (me) api('PATCH', '/api/me', { lang: l }).catch(() => {});
  };
  const refresh = useCallback(async () => {
    try { const m = await api<Me>('GET', '/api/me'); setMe(m); } catch { setToken(null); setMe(null); }
    setReady(true);
  }, []);
  useEffect(() => { if (hasToken()) refresh(); }, [refresh]);

  if (!ready) return null;
  return (
    <LangCtx.Provider value={ctx}>
      <main>
        {me ? <Shell me={me} refresh={refresh} onLang={changeLang} onLogout={() => { setToken(null); setMe(null); }} /> : <Auth lang={lang} onLang={changeLang} onDone={refresh} />}
        <p className="muted">{t('disclaimer')}</p>
      </main>
    </LangCtx.Provider>
  );
}

function LangPicker({ lang, onLang }: { lang: Lang; onLang: (l: Lang) => void }) {
  const t = useT();
  return (
    <label>{t('language')}
      <select value={lang} onChange={(e) => onLang(e.target.value as Lang)}>{LANGS.map((l) => <option key={l} value={l}>{l.toUpperCase()}</option>)}</select>
    </label>
  );
}

/* ---------- Auth ---------- */
function Auth({ lang, onLang, onDone }: { lang: Lang; onLang: (l: Lang) => void; onDone: () => void }) {
  const t = useT();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [f, setF] = useState({ email: '', password: '', name: '', role: 'athlete' });
  const [err, setErr] = useState('');
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setErr('');
    try {
      const r = mode === 'login' ? await api('POST', '/api/auth/login', { email: f.email, password: f.password }) : await api('POST', '/api/auth/register', { ...f, lang });
      setToken(r.token); onDone();
    } catch { setErr(t('invalid')); }
  };
  return (
    <form onSubmit={submit} className="card">
      <h1>{t('app')}</h1>
      <LangPicker lang={lang} onLang={onLang} />
      {mode === 'register' && <>
        <label htmlFor="name">{t('name')}</label><input id="name" required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
        <label htmlFor="role">{t('role')}</label>
        <select id="role" value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })}><option value="athlete">{t('athlete')}</option><option value="pro">{t('pro')}</option></select>
      </>}
      <label htmlFor="email">{t('email')}</label><input id="email" type="email" required value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />
      <label htmlFor="pw">{t('password')}</label><input id="pw" type="password" minLength={8} required value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} />
      {err && <p className="bad" role="alert">{err}</p>}
      <p className="row"><button className="primary">{mode === 'login' ? t('login') : t('register')}</button>
        <button type="button" onClick={() => setMode(mode === 'login' ? 'register' : 'login')}>{mode === 'login' ? t('register') : t('login')}</button></p>
      {mode === 'register' && <p className="muted">{t('trialNote')}</p>}
    </form>
  );
}

/* ---------- Shell ---------- */
function Shell({ me, refresh, onLang, onLogout }: { me: Me; refresh: () => void; onLang: (l: Lang) => void; onLogout: () => void }) {
  const t = useT();
  const isPro = me.role === 'pro';
  const [tab, setTab] = useState('today');
  const [wellness, setWellness] = useState<'running' | 'nutrition' | 'recovery' | null>(null);
  const [proView, setProView] = useState<'athletes' | 'approvals'>('athletes');
  const needsConsent = !isPro && !(me.consents.terms && me.consents.health_data);
  const navigate = (next: string) => { setTab(next); setWellness(null); window.scrollTo({ top: 0, behavior: 'smooth' }); };
  const goBack = () => { setWellness(null); window.scrollTo({ top: 0, behavior: 'smooth' }); };
  const screenTitle = isPro ? (proView === 'athletes' ? t('athletes') : t('approvals')) : wellness ? t(wellness) : (tab === 'today' ? t('today') : t(tab === 'wellness' ? 'recovery' : tab));
  return (
    <>
      <header className="top"><div className="brand"><span className="brandmark">F</span><div><strong>FONDAL FIT</strong><small>{isPro ? t('pro') : t('athlete')}</small></div></div><button className="header-action" onClick={() => navigate('settings')} aria-label={t('settings')}>⚙</button></header>
      {needsConsent ? <Consents me={me} refresh={refresh} /> : (
        <>
          <div className="screen-heading">
            {wellness && <button className="back-button" onClick={goBack} aria-label="Volver a bienestar">← Volver</button>}
            <h1>{screenTitle}</h1>
            {!isPro && tab === 'today' && <p className="screen-subtitle">Tu entrenamiento y tu progreso, en un solo lugar.</p>}
          </div>
          {isPro ? <>
            <div className="quick-tabs"><button className={proView === 'athletes' ? 'selected' : ''} onClick={() => setProView('athletes')}>{t('athletes')}</button><button className={proView === 'approvals' ? 'selected' : ''} onClick={() => setProView('approvals')}>{t('approvals')}</button></div>
            {tab === 'settings' ? <Settings me={me} refresh={refresh} onLang={onLang} onLogout={onLogout} /> : proView === 'athletes' ? <ProAthletes /> : <ProApprovals />}
          </> : <>
            {tab === 'today' && <><div className="hero card"><div className="eyebrow">TU PLAN PERSONAL</div><h2>Entrená con un propósito.</h2><p>Tu sesión se ajusta a la evaluación inicial y al progreso que registres.</p><div className="hero-note">Empezá por la sesión que corresponde a tu plan.</div></div><Training /><BetaCoach /></>}
            {tab === 'progress' && <Progress />}
            {tab === 'wellness' && (wellness === 'running' ? <Running /> : wellness === 'nutrition' ? <Nutrition /> : wellness === 'recovery' ? <Recovery /> : <div className="feature-grid">
              <button className="feature-card" onClick={() => setWellness('running')}><span className="feature-icon">↗</span><strong>{t('running')}</strong><small>Distancia, ritmos y registro de carreras</small><span>Ver actividad →</span></button>
              <button className="feature-card" onClick={() => setWellness('nutrition')}><span className="feature-icon">◉</span><strong>{t('nutrition')}</strong><small>Comidas, energía y proteínas diarias</small><span>Ver alimentación →</span></button>
              <button className="feature-card" onClick={() => setWellness('recovery')}><span className="feature-icon">☾</span><strong>{t('recovery')}</strong><small>Sueño, fatiga y disponibilidad</small><span>Ver recuperación →</span></button>
            </div>)}
            {tab === 'settings' && <Settings me={me} refresh={refresh} onLang={onLang} onLogout={onLogout} />}
          </>}
          <nav className="tabs" aria-label="Navegación principal">
            {((isPro ? [['today', 'Inicio', '⌂'], ['settings', 'Perfil', '◎']] : [['today', 'Hoy', '⌂'], ['progress', 'Progreso', '▥'], ['wellness', 'Bienestar', '♡'], ['settings', 'Perfil', '◎']]) as [string, string, string][]).map(([key, label, symbol]) => <button key={key} className={tab === key ? 'on' : ''} aria-current={tab === key ? 'page' : undefined} onClick={() => navigate(key)}><span className="nav-icon" aria-hidden="true">{symbol}</span><span>{label}</span></button>)}
          </nav>
        </>
      )}
    </>
  );
}

const CONSENT_KEYS = ['terms', 'health_data', 'share_with_pro', 'ai_memory', 'camera_video'];
function Consents({ me, refresh }: { me: Me; refresh: () => void }) {
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

/* ---------- Athlete: training ---------- */
interface Rx { exerciseId: string; sets: number; repMin: number; repMax: number; rirTarget: number; load: number }
interface PlanRes { version?: number; recommendedDay?: number; plan: { days: { name: string; items: Rx[]; run?: {minutes:number;intensity:string;note:string} }[] } | null }

function Chips({ options, value, onChange, multi }: { options: string[]; value: string[]; onChange: (v: string[]) => void; multi?: boolean }) {
  const t = useT();
  return <div className="chips">{options.map((o) => {
    const on = value.includes(o);
    return <button key={o} type="button" className={'chip' + (on ? ' on' : '')} aria-pressed={on} onClick={() => onChange(multi ? (on ? value.filter((x) => x !== o) : [...value, o]) : [o])}>{t(o)}</button>;
  })}</div>;
}

function Training() {
  const t = useT();
  const [res, setRes] = useState<PlanRes | null>(null);
  const [session, setSession] = useState<number | null>(null);
  const [msg, setMsg] = useState('');
  const [allSessions, setAllSessions] = useState(false);
  const load = useCallback(() => api<PlanRes>('GET', '/api/plan').then(setRes).catch(() => setMsg('No pudimos cargar tu plan. Revisá tu conexión.')), []);
  useEffect(() => { load(); }, [load]);
  if (!res) return <div className="card"><p>{msg || 'Cargando tu entrenamiento…'}</p></div>;
  if (!res.plan) return <Assessment onDone={load} />;
  if (session !== null) return <Session day={res.plan.days[session]!} index={session} onCancel={() => setSession(null)} onDone={(m) => { setMsg(m); setSession(null); load(); }} />;
  const recommended = Math.min(res.plan.days.length - 1, res.recommendedDay ?? 0);
  const days = res.plan.days.map((day, index) => ({ day, index })).filter(({index}) => allSessions || index === recommended);
  return (
    <section aria-label="Tu plan de entrenamiento">
      <div className="row plan-overview"><p className="muted">Tu próxima sesión · Plan v{res.version}</p><button type="button" onClick={() => setAllSessions(!allSessions)}>{allSessions ? 'Ver solo la próxima' : 'Ver mi plan completo'}</button></div>
      {msg && <p className="ok" role="status">{msg}</p>}
      {days.map(({day, index}) => <div className="card workout-card" key={index}>
        <div className="eyebrow">{index === recommended ? 'RECOMENDADA PARA HOY' : 'OTRA SESIÓN DEL PLAN'}</div>
        <h2>{day.name}</h2>
        <p className="muted">{day.items.length} ejercicios · Preparada según tu evaluación y tus registros.</p>
        {day.run && <p className="run-prescription">Carrera suave: {day.run.minutes} minutos. {day.run.note}</p>}
        {day.items.map((it) => <div className="exercise-preview" key={it.exerciseId}><strong>{t('ex_' + it.exerciseId)}</strong><span>{it.sets} × {it.repMin}–{it.repMax} · RIR {it.rirTarget}{it.load ? ` · ${it.load} kg` : ''}</span></div>)}
        <button className="primary action-full" onClick={() => setSession(index)}>Empezar sesión →</button>
      </div>)}
    </section>
  );
}

function Assessment({ onDone }: { onDone: () => void }) {
  const t = useT();
  const GOALS = ['general', 'strength', 'hypertrophy', 'endurance', 'fat_loss', 'mobility', 'hybrid'];
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [referral, setReferral] = useState(false);
  const [a, setA] = useState({
    goal: 'general', secondaryGoals: [] as string[], targetDescription: '', targetDate: '',
    daysPerWeek: 3, sessionMinutes: 60, preferredActivities: ['strength'] as string[],
    experience: 'beginner', equipment: ['none'] as string[], restrictions: [] as string[],
    redFlags: { chestPain: false, dizziness: false, recentSurgery: false, pregnancy: false, medication: false },
  });
  const generate = async () => {
    setBusy(true); setError('');
    try {
      const payload = { ...a, secondaryGoals: a.secondaryGoals.filter((g) => g !== a.goal), targetDate: a.targetDate || undefined };
      const result = await api<{ referral?: boolean }>('POST', '/api/assessment', payload);
      if (result.referral) setReferral(true);
      else onDone();
    } catch (e) { setError(e instanceof ApiError ? 'Revisá tus respuestas antes de generar el plan.' : 'No pudimos guardar tu evaluación. Reintentá.'); }
    finally { setBusy(false); }
  };
  const title = ['¿Qué querés lograr?', '¿Cómo entrenás hoy?', '¿Con qué contás?', 'Chequeo antes de empezar'][step];
  return <section className="card onboarding" aria-label="Evaluación inicial">
    <div className="eyebrow">TU ENTRENADOR · PASO {step + 1} DE 4</div>
    <div className="wizard-track" aria-hidden="true"><span style={{width:`${(step + 1) * 25}%`}} /></div>
    <h2>{title}</h2>
    {step === 0 && <>
      <p className="muted">Tu objetivo principal dirige el entrenamiento. También podés tener metas secundarias.</p>
      <label>Objetivo principal</label><Chips options={GOALS} value={[a.goal]} onChange={(v) => setA({ ...a, goal: v[0]!, secondaryGoals: a.secondaryGoals.filter(g=>g!==v[0]) })} />
      <label>Objetivos secundarios (opcionales, hasta 3)</label><Chips options={GOALS.filter(g=>g!==a.goal)} multi value={a.secondaryGoals} onChange={(v)=>setA({...a,secondaryGoals:v.slice(0,3)})} />
      <label htmlFor="goal-specific">Meta concreta (opcional)</label><input id="goal-specific" maxLength={200} placeholder="Ej.: correr 21 km o mejorar mi fuerza" value={a.targetDescription} onChange={e=>setA({...a,targetDescription:e.target.value})} />
      <label htmlFor="goal-date">Fecha deseada (opcional)</label><input id="goal-date" type="date" value={a.targetDate} onChange={e=>setA({...a,targetDate:e.target.value})} />
    </>}
    {step === 1 && <>
      <label>Tu experiencia</label><Chips options={['beginner','intermediate','advanced']} value={[a.experience]} onChange={v=>setA({...a,experience:v[0]!})} />
      <label htmlFor="days">¿Cuántos días por semana podés entrenar?</label><input id="days" type="number" min={1} max={6} value={a.daysPerWeek} onChange={e=>setA({...a,daysPerWeek:Number(e.target.value)})} />
      <label htmlFor="session-duration">¿Cuántos minutos tenés por entrenamiento?</label><select id="session-duration" value={a.sessionMinutes} onChange={e=>setA({...a,sessionMinutes:Number(e.target.value)})}>{[20,30,45,60,75,90,120].map(n=><option key={n} value={n}>{n} minutos</option>)}</select>
      <p className="muted">La duración ayuda a ajustar el número de ejercicios de cada sesión.</p>
    </>}
    {step === 2 && <>
      <label>{t('equipment')}</label><Chips multi options={['none','dumbbells','barbell','bands','bar','machines']} value={a.equipment} onChange={v=>setA({...a,equipment:v})}/>
      <label>Actividades de interés</label><div className="chips">{([['strength','Fuerza'],['running','Running'],['mobility','Movilidad']] as [string,string][]).map(([key,label])=><button type="button" key={key} className={'chip'+(a.preferredActivities.includes(key)?' on':'')} aria-pressed={a.preferredActivities.includes(key)} onClick={()=>setA({...a,preferredActivities:a.preferredActivities.includes(key)?a.preferredActivities.filter(x=>x!==key):[...a.preferredActivities,key]})}>{label}</button>)}</div>
      <label>{t('restrictions')}</label><Chips multi options={['knee','shoulder','lower_back','hip','ankle','wrist','neck']} value={a.restrictions} onChange={v=>setA({...a,restrictions:v})}/>
    </>}
    {step === 3 && <>
      <p className="muted">Estas preguntas permiten detectar situaciones que requieren revisión profesional. No sustituyen una evaluación médica.</p>
      {Object.keys(a.redFlags).map(k=><label key={k} className="check"><input type="checkbox" checked={(a.redFlags as Record<string,boolean>)[k]} onChange={e=>setA({...a,redFlags:{...a.redFlags,[k]:e.target.checked}})}/>{t('rf_'+k)}</label>)}
      {referral && <p className="warn" role="alert">{t('referral')}</p>}
    </>}
    {error && <p className="bad" role="alert">{error}</p>}
    <div className="wizard-actions">
      {step>0 && <button type="button" onClick={()=>{setStep(step-1);setError('');}}>← Atrás</button>}
      {step<3 ? <button type="button" className="primary" onClick={()=>setStep(step+1)}>Continuar →</button> : <button type="button" className="primary" disabled={busy||referral||!a.equipment.length||a.daysPerWeek<1||a.daysPerWeek>6} onClick={generate}>{busy?'Creando tu plan…':'Crear mi plan'}</button>}
    </div>
  </section>;
}

function Session({ day, index, onDone, onCancel }: { day: { name: string; items: Rx[]; run?: {minutes:number;intensity:string;note:string} }; index: number; onDone: (msg: string) => void; onCancel: () => void }) {
  const t = useT();
  const [sets, setSets] = useState<Record<string, { weight: string; reps: string; rir: string }[]>>(() =>
    Object.fromEntries(day.items.map((it) => [it.exerciseId, Array.from({ length: it.sets }, () => ({ weight: String(it.load || ''), reps: '', rir: '' }))])));
  const [fatigue, setFatigue] = useState(5);
  const set = (id: string, i: number, k: 'weight' | 'reps' | 'rir', v: string) => setSets({ ...sets, [id]: sets[id]!.map((s, j) => (j === i ? { ...s, [k]: v } : s)) });
  const submit = async () => {
    const items = day.items.map((it) => ({ exerciseId: it.exerciseId, sets: sets[it.exerciseId]!.filter((s) => s.reps !== '').map((s) => ({ weight: Number(s.weight || 0), reps: Number(s.reps), rir: Number(s.rir || 0) })) })).filter((i) => i.sets.length);
    if (!items.length) return;
    try {
      const r = await api('POST', '/api/workouts', { dayIndex: index, fatigue, items });
      onDone([r.applied ? t('applied') : t('needsApproval'), r.deloadSuggested ? t('deloadSuggested') : ''].filter(Boolean).join(' '));
    } catch (e) { if (e instanceof ApiError) onDone(t('invalid')); else onDone(t('offline')); }
  };
  return (
    <>
      <button className="back-button" onClick={onCancel}>← Volver al plan</button>
      <h2>{day.name}</h2>
      {day.run && <p className="run-prescription">Carrera suave de {day.run.minutes} minutos. Registrala en Running.</p>}
      <p className="muted">Registrá tus series. Si volvés al plan antes de finalizar, los datos de esta sesión no se guardan.</p>
      {day.items.map((it) => (
        <div className="card" key={it.exerciseId}>
          <h3>{t('ex_' + it.exerciseId)}</h3><p className="muted">{it.repMin}-{it.repMax} {t('reps')} · {t('rir')} {it.rirTarget}</p>
          {sets[it.exerciseId]!.map((s, i) => (
            <div className="set" key={i}><span>{i + 1}</span>
              <input aria-label={t('weight')} placeholder={t('weight')} inputMode="decimal" value={s.weight} onChange={(e) => set(it.exerciseId, i, 'weight', e.target.value)} />
              <input aria-label={t('reps')} placeholder={t('reps')} inputMode="numeric" value={s.reps} onChange={(e) => set(it.exerciseId, i, 'reps', e.target.value)} />
              <input aria-label={t('rir')} placeholder={t('rir')} inputMode="numeric" value={s.rir} onChange={(e) => set(it.exerciseId, i, 'rir', e.target.value)} /></div>
          ))}
        </div>
      ))}
      <RestTimer />
      <label htmlFor="fat">{t('fatigue')}: {fatigue}</label><input id="fat" type="range" min={1} max={10} value={fatigue} onChange={(e) => setFatigue(Number(e.target.value))} />
      <p><button className="primary" onClick={submit}>{t('finish')}</button></p>
    </>
  );
}

function RestTimer() {
  const t = useT();
  const [left, setLeft] = useState(0);
  useEffect(() => { if (left <= 0) return; const id = setTimeout(() => setLeft((l) => l - 1), 1000); return () => clearTimeout(id); }, [left]);
  return (
    <div className="card row"><h3>{t('rest')}</h3>
      {[60, 90, 120].map((s) => <button key={s} onClick={() => setLeft(s)}>{s}s</button>)}
      <span role="timer" aria-live="off">{left > 0 ? `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}` : ''}</span></div>
  );
}

// Geolocation remains foreground-only on PWAs; explicit permission and manual save.
function GpsRun({ onDraft }: { onDraft: (km: number, minutes: number) => void }) {
  const [active, setActive] = useState(false);
  const [touchLocked, setTouchLocked] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [meters, setMeters] = useState(0);
  const [status, setStatus] = useState('El GPS necesita permiso y una conexión segura (HTTPS).');
  const watchId = useRef<number | null>(null);
  const lastPoint = useRef<{lat:number;lon:number;at:number}|null>(null);
  const startedAt = useRef(0);
  const wake = useRef<{release:()=>Promise<void>}|null>(null);
  const running = useRef(false);
  const stop = useCallback(() => {
    running.current = false;
    if (watchId.current!==null) navigator.geolocation.clearWatch(watchId.current);
    watchId.current = null;
    void wake.current?.release().catch(()=>{});
    wake.current = null;
    setActive(false);
    setTouchLocked(false);
  },[]);
  useEffect(() => () => {
    running.current=false;
    if(watchId.current!==null) navigator.geolocation.clearWatch(watchId.current);
    void wake.current?.release().catch(()=>{});
  },[]);
  useEffect(() => {
    if(!active) return;
    const tick=window.setInterval(()=>setElapsed(Math.round((Date.now()-startedAt.current)/1000)),1000);
    return ()=>clearInterval(tick);
  },[active]);
  const start=async()=>{
    if(!navigator.geolocation) {setStatus('Este navegador no ofrece GPS.');return;}
    setMeters(0);setElapsed(0);lastPoint.current=null;startedAt.current=Date.now();
    running.current=true;setActive(true);setStatus('Buscando señal GPS…');
    try {
      const n=navigator as Navigator & {wakeLock?: {request:(type:'screen')=>Promise<{release:()=>Promise<void>}>}};
      if(n.wakeLock) wake.current=await n.wakeLock.request('screen');
    } catch {setStatus('GPS activo. El dispositivo puede apagar la pantalla.');}
    if(!running.current)return;
    watchId.current=navigator.geolocation.watchPosition(pos=>{
      if(!running.current)return;
      const {latitude:lat,longitude:lon,accuracy}=pos.coords;
      if(accuracy>45){setStatus('Esperando una señal GPS más precisa…');return;}
      const at=pos.timestamp;
      if(lastPoint.current){
        const prev=lastPoint.current;
        const rad=Math.PI/180,dlat=(lat-prev.lat)*rad,dlon=(lon-prev.lon)*rad;
        const h=Math.sin(dlat/2)**2+Math.cos(prev.lat*rad)*Math.cos(lat*rad)*Math.sin(dlon/2)**2;
        const distance=12742000*Math.asin(Math.min(1,Math.sqrt(h)));
        const seconds=(at-prev.at)/1000;
        if(seconds>0&&distance>=3&&distance/seconds<8) {
          setMeters(m=>m+distance);
          lastPoint.current={lat,lon,at};
        } else if(seconds>0&&distance/seconds>=8) {
          setStatus('Se descartó un salto de posición GPS.');
        }
      } else lastPoint.current={lat,lon,at};
      setStatus('GPS activo · distancia estimada');
    },e=>setStatus(e.code===1?'Permiso de ubicación rechazado. Podés registrar la carrera manualmente.':'Se perdió la señal GPS. Podés registrar la carrera manualmente.'),{enableHighAccuracy:true,maximumAge:0,timeout:15000});
  };
  return <div className="card gps-run">
    <h3>Seguimiento GPS (beta)</h3>
    <p className="muted">Funciona mientras la app permanezca activa en primer plano. En segundo plano o con pantalla apagada el sistema puede suspender el seguimiento.</p>
    <div className="gps-metrics"><div><strong>{(meters/1000).toFixed(2)}</strong><small>km estimados</small></div><div><strong>{Math.floor(elapsed/60)}:{String(elapsed%60).padStart(2,'0')}</strong><small>tiempo</small></div></div>
    <p role="status" className="muted">{status}</p>
    {!active?<button className="primary action-full" onClick={()=>void start()}>Iniciar GPS</button>:<div className="gps-actions">
      <button onClick={()=>setTouchLocked(true)}>Bloquear toques</button>
      <button onClick={()=>{stop();if(meters>0&&elapsed>0)onDraft(Number((meters/1000).toFixed(2)),Number((elapsed/60).toFixed(2)));}}>Finalizar y completar registro</button>
    </div>}
    {touchLocked&&active&&<div className="gps-touch-lock" role="dialog" aria-label="Pantalla táctil bloqueada">
      <strong>Toques bloqueados</strong><p>El GPS continúa mientras el navegador esté activo.</p><button className="primary" onClick={()=>setTouchLocked(false)}>Desbloquear toques</button>
      <p className="muted">Este bloqueo no controla el botón físico de suspensión.</p>
    </div>}
  </div>;
}

function BetaCoach() {
  const [status,setStatus]=useState<{available:boolean;remaining:number;dailyLimit:number}|null>(null);
  const [message,setMessage]=useState('');
  const [answer,setAnswer]=useState('');
  const [error,setError]=useState('');
  const [working,setWorking]=useState(false);
  useEffect(()=>{api<{available:boolean;remaining:number;dailyLimit:number}>('GET','/api/coach/status').then(setStatus).catch(()=>{});},[]);
  const submit=async()=>{
    if(!message.trim())return;
    setWorking(true);setError('');
    try{
      const r=await api<{answer:string;remaining:number}>('POST','/api/coach/chat',{message});
      setAnswer(r.answer);setStatus(x=>x?{...x,remaining:r.remaining}:x);
    }catch(e){
      const err=e instanceof ApiError?e.body?.error:'';
      setError(err==='ai_consent_required'?'Activá el consentimiento de memoria de IA en Perfil antes de probarlo.':err==='coach_daily_limit'?'Llegaste al límite diario de prueba.':err==='coach_unconfigured'?'Falta configurar la clave gratuita de Gemini en el servidor.':'El entrenador no está disponible ahora.');
    }finally{setWorking(false);}
  };
  return <section className="card">
    <div className="eyebrow">FONDAL COACH · BETA</div><h2>Consultá a tu entrenador</h2>
    <p className="muted">Consejos educativos basados en tu meta. La IA no modifica el plan ni reemplaza una evaluación profesional.</p>
    <p className="muted">{status?.available?`Consultas restantes hoy: ${status.remaining}/${status.dailyLimit}`:'Para activar la IA se necesita una clave gratuita configurada en el servidor.'}</p>
    <label htmlFor="coach-message">Tu consulta</label><textarea id="coach-message" rows={3} maxLength={450} value={message} onChange={e=>setMessage(e.target.value)} placeholder="¿Cómo adapto el entrenamiento de hoy a mi objetivo?"/>
    <button className="primary action-full" disabled={working||!message.trim()||!status?.available||status.remaining<=0} onClick={()=>void submit()}>{working?'Consultando…':'Consultar al coach'}</button>
    {error&&<p className="warn" role="alert">{error}</p>}
    {answer&&<div className="coach-answer" role="status">{answer}</div>}
  </section>;
}

function Running() {
  const t = useT();
  const [d, setD] = useState<any>(null);
  const [f, setF] = useState({ km: '', minutes: '', rpe: '5' });
  const load = () => api('GET', '/api/runs').then(setD).catch(() => {});
  useEffect(() => { load(); }, []);
  const fmt = (p: number) => `${Math.floor(p)}:${String(Math.round((p % 1) * 60)).padStart(2, '0')}`;
  return (
    <>
      <GpsRun onDraft={(km,minutes)=>setF(prev=>({...prev,km:String(km),minutes:String(minutes)}))}/>
      <form className="card" onSubmit={async (e) => { e.preventDefault(); await api('POST', '/api/runs', { km: +f.km, minutes: +f.minutes, rpe: +f.rpe }); setF({ km: '', minutes: '', rpe: '5' }); load(); }}>
        <h2>{t('running')}</h2>
        <div className="row"><input required aria-label={t('distanceKm')} placeholder={t('distanceKm')} inputMode="decimal" value={f.km} onChange={(e) => setF({ ...f, km: e.target.value })} />
          <input required aria-label={t('minutes')} placeholder={t('minutes')} inputMode="decimal" value={f.minutes} onChange={(e) => setF({ ...f, minutes: e.target.value })} />
          <input required aria-label={t('rpe')} placeholder={t('rpe')} type="number" min={1} max={10} value={f.rpe} onChange={(e) => setF({ ...f, rpe: e.target.value })} /></div>
        <p><button className="primary">{t('logRun')}</button></p></form>
      {d && <div className="card"><p>{t('weekKm')}: <b>{d.weekKm}</b></p>
        {d.alerts.map((a: string) => <p key={a} className="warn" role="alert">{t('a_' + a)}</p>)}
        {d.runs.map((r: any, i: number) => <p key={i} className="muted">{r.created_at.slice(0, 10)} · {r.km} km · {fmt(r.pace)} /km · RPE {r.rpe}</p>)}</div>}
    </>
  );
}

interface ProgressData {
  sessions: { date: string; volume: number; sets: number }[];
  total: number;
  exercises?: Record<string, { date: string; weight: number; reps: number; estimated1RM: number }[]>;
  goal?: { goal: string; targetDescription?: string; targetDate?: string; secondaryGoals?: string[] };
}
function TrendChart({ points, label, unit, lowerIsBetter = false }: { points: { label: string; value: number }[]; label: string; unit: string; lowerIsBetter?: boolean }) {
  if (!points.length) return <p className="muted">Todavía no hay registros suficientes.</p>;
  const data = points.slice(-16);
  const values = data.map(p=>p.value);
  const min = Math.min(...values), max = Math.max(...values);
  const range = Math.max(1, max - min);
  const coords = data.map((p,i)=>[24+(i/Math.max(1,data.length-1))*312, 160-((p.value-min)/range)*125]);
  const trajectory = coords.map(([x,y])=>`${x},${y}`).join(' ');
  const delta = data.length>1 ? data[data.length-1]!.value-data[0]!.value : 0;
  const improvement = lowerIsBetter ? delta < 0 : delta > 0;
  return <div className="trend-chart">
    <div className="chart-heading"><strong>{label}</strong><span>{data[data.length-1]!.value.toFixed(1)} {unit}</span></div>
    <svg viewBox="0 0 360 185" role="img" aria-label={`${label}: ${data.map(p=>p.label+' '+p.value.toFixed(1)).join(', ')}`} preserveAspectRatio="xMidYMid meet">
      {[35,97.5,160].map(y=><line key={y} x1="24" y1={y} x2="338" y2={y} stroke="#35423c" strokeWidth="1" strokeDasharray="4 6"/>)}
      <polyline fill="none" stroke="#9af1aa" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" points={trajectory}/>
      {coords.map(([x,y],i)=><circle key={i} cx={x} cy={y} r={i===coords.length-1?5:3} fill="#9af1aa"/>)}
      <text x="22" y="179" fill="#b0c2b8" fontSize="11">{data[0]!.label.slice(0,10)}</text>
      <text x="338" y="179" textAnchor="end" fill="#b0c2b8" fontSize="11">{data[data.length-1]!.label.slice(0,10)}</text>
    </svg>
    {data.length>1&&<p className={improvement?'ok':'muted'}>Cambio en el período: {delta>0?'+':''}{delta.toFixed(1)} {unit}. {lowerIsBetter?'Un ritmo menor significa mayor velocidad.':'La evolución debe interpretarse según tu objetivo.'}</p>}
  </div>;
}
function Progress() {
  const t = useT();
  const [d,setD] = useState<ProgressData|null>(null);
  const [runs,setRuns] = useState<{runs:{created_at:string;km:number;pace:number}[]}|null>(null);
  const [g,setG] = useState<{xp:number;level:number;streakWeeks:number;achievements:string[]}|null>(null);
  const [selected,setSelected] = useState('');
  const [error,setError] = useState('');
  useEffect(()=>{
    api<ProgressData>('GET','/api/progress').then(setD).catch(()=>setError('No se pudo cargar el progreso.'));
    api<{runs:{created_at:string;km:number;pace:number}[]}>('GET','/api/runs').then(setRuns).catch(()=>{});
    api<{xp:number;level:number;streakWeeks:number;achievements:string[]}>('GET','/api/gamification').then(setG).catch(()=>{});
  },[]);
  if (!d) return <div className="card"><h2>{t('progress')}</h2><p>{error||'Cargando tu evolución…'}</p></div>;
  const exercises = Object.entries(d.exercises??{}).filter(([,items])=>items.length>0);
  const exerciseId = exercises.some(([id])=>id===selected)?selected:(exercises[0]?.[0]??'');
  const exerciseHistory = d.exercises?.[exerciseId]??[];
  return <section className="progress-dashboard">
    <div className="card"><div className="eyebrow">TU EVOLUCIÓN</div><h2>{d.goal?.targetDescription||'Entrená, registrá y medí tu avance'}</h2>
      <p className="muted">{d.goal?.goal?t(''+d.goal.goal):'Tu objetivo aparecerá después de la evaluación.'}{d.goal?.targetDate?' · Fecha meta: '+d.goal.targetDate:''}</p>
      <div className="metric"><strong>{d.total}</strong><span>sesiones registradas</span></div>
    </div>
    {g&&<div className="card"><h3>Nivel {g.level} · {g.xp} XP</h3><p className="muted">Semanas activas consecutivas: {g.streakWeeks}</p><div className="chips">{g.achievements.map(x=><span className="badge ok" key={x}>{t('ach_'+x)}</span>)}</div></div>}
    <div className="card"><h3>Volumen de entrenamiento</h3><p className="muted">Carga total × repeticiones registradas por sesión. No compara esfuerzos entre ejercicios distintos.</p>
      <TrendChart points={d.sessions.map(x=>({label:x.date.slice(0,10),value:x.volume}))} label="Volumen por sesión" unit="kg·reps"/>
    </div>
    <div className="card"><h3>Progresión de cargas</h3><p className="muted">Fuerza estimada a partir de cada sesión: aproximación, no prueba de 1RM.</p>
      {exercises.length>0?<><label htmlFor="progress-exercise">Elegí un ejercicio</label><select id="progress-exercise" value={exerciseId} onChange={e=>setSelected(e.target.value)}>{exercises.map(([id])=><option key={id} value={id}>{t('ex_'+id)}</option>)}</select>
        <TrendChart points={exerciseHistory.map(x=>({label:x.date.slice(0,10),value:x.estimated1RM}))} label="1RM estimado" unit="kg"/>
        <p className="muted">Última carga real: {exerciseHistory[exerciseHistory.length-1]?.weight??0} kg · {exerciseHistory[exerciseHistory.length-1]?.reps??0} repeticiones</p>
      </>:<p className="muted">Registrá al menos una sesión con cargas para ver tu evolución.</p>}
    </div>
    <div className="card"><h3>Progreso en running</h3>{runs?.runs?.length?<><TrendChart points={[...runs.runs].reverse().map(x=>({label:x.created_at.slice(0,10),value:x.km}))} label="Distancia" unit="km"/>
      <TrendChart points={[...runs.runs].reverse().filter(x=>x.pace>0).map(x=>({label:x.created_at.slice(0,10),value:x.pace}))} label="Ritmo" unit="min/km" lowerIsBetter/></>:<p className="muted">Registrá una carrera en Bienestar para ver los gráficos de distancia y ritmo.</p>}</div>
  </section>;
}

/* ---------- Nutrition ---------- */
function Nutrition() {
  const t = useT();
  const [d, setD] = useState<any>(null);
  const [p, setP] = useState({ sex: 'f', weightKg: 70, heightCm: 170, age: 30, activity: 1.375, goal: 'general' });
  const [m, setM] = useState({ meal: '', kcal: '', proteinG: '', carbsG: '', fatG: '', waterMl: '' });
  const load = () => api('GET', '/api/nutrition').then(setD).catch(() => {});
  useEffect(() => { load(); }, []);
  const calc = async () => { await api('POST', '/api/nutrition/target', p); load(); };
  const add = async (e: React.FormEvent) => { e.preventDefault(); await api('POST', '/api/nutrition/log', { meal: m.meal, kcal: +m.kcal || 0, proteinG: +m.proteinG || 0, carbsG: +m.carbsG || 0, fatG: +m.fatG || 0, waterMl: +m.waterMl || 0 }); setM({ meal: '', kcal: '', proteinG: '', carbsG: '', fatG: '', waterMl: '' }); load(); };
  const num = (k: keyof typeof p) => <input type="number" value={p[k] as number} onChange={(e) => setP({ ...p, [k]: Number(e.target.value) })} />;
  return (
    <>
      {d?.target ? (
        <div className="card"><h2>{t('target')}</h2>
          <p>{d.target.kcal} kcal · P {d.target.proteinG} · C {d.target.carbsG} · G {d.target.fatG} · {d.target.waterMl} ml</p>
          {d.target.floored && <p className="warn">{t('kcalFloor')}</p>}
          <p className="muted">{t('todayTotal')}: {d.today.kcal} kcal · P {d.today.proteinG} · C {d.today.carbsG} · G {d.today.fatG} · {d.today.waterMl} ml</p>
          <div className="bar"><i style={{ width: `${Math.min(100, (d.today.kcal / d.target.kcal) * 100)}%` }} /></div></div>
      ) : (
        <div className="card"><h2>{t('nutrition')}</h2>
          <label>{t('sex')}</label><Chips options={['female', 'male']} value={[p.sex === 'f' ? 'female' : 'male']} onChange={(v) => setP({ ...p, sex: v[0] === 'female' ? 'f' : 'm' })} />
          <label>{t('weightKg')}</label>{num('weightKg')}<label>{t('heightCm')}</label>{num('heightCm')}<label>{t('age')}</label>{num('age')}
          <label>{t('activity')}</label>
          <select value={p.activity} onChange={(e) => setP({ ...p, activity: Number(e.target.value) })}><option value={1.2}>{t('act1')}</option><option value={1.375}>{t('act2')}</option><option value={1.55}>{t('act3')}</option><option value={1.725}>{t('act4')}</option></select>
          <label>{t('goal')}</label><Chips options={['general', 'strength', 'hypertrophy', 'fat_loss']} value={[p.goal]} onChange={(v) => setP({ ...p, goal: v[0]! })} />
          <p><button className="primary" onClick={calc}>{t('calcTarget')}</button></p></div>
      )}
      <form className="card" onSubmit={add}><h3>{t('addMeal')}</h3>
        <label>{t('meal')}</label><input required value={m.meal} onChange={(e) => setM({ ...m, meal: e.target.value })} />
        <div className="row">{(['kcal', 'proteinG', 'carbsG', 'fatG', 'waterMl'] as const).map((k) => <input key={k} aria-label={k} placeholder={k === 'kcal' ? 'kcal' : t({ proteinG: 'protein', carbsG: 'carbs', fatG: 'fat', waterMl: 'water' }[k]!)} inputMode="decimal" value={m[k]} onChange={(e) => setM({ ...m, [k]: e.target.value })} />)}</div>
        <p><button className="primary">{t('addMeal')}</button></p></form>
    </>
  );
}

/* ---------- Recovery ---------- */
function Recovery() {
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

function ProAthletes() {
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

function ProApprovals() {
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
function Settings({ me, refresh, onLang, onLogout }: { me: Me; refresh: () => void; onLang: (l: Lang) => void; onLogout: () => void }) {
  const t = useT();
  const { lang } = useContext(LangCtx);
  const [links, setLinks] = useState<any[]>([]);
  const loadLinks = () => me.role === 'athlete' && api('GET', '/api/links').then(setLinks).catch(() => {});
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
        <div className="card"><h3>{t('consentTitle')}</h3>
          {CONSENT_KEYS.filter((k) => k !== 'terms' && k !== 'health_data').map((k) => <label key={k} className="check"><input type="checkbox" checked={!!me.consents[k]} onChange={(e) => toggle(k, e.target.checked)} />{t('c_' + k)}</label>)}</div>
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
