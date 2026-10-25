import {RunningMap, missingGPSGap, type GPSPoint} from './RunningMap';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { api, ApiError, hasToken, setToken } from './api';
import { LANGS, translate, type Lang } from './i18n';
import { FOODS, MENUS, THEORY, nutrition, parseSimpleFood, type Portion } from './foodLibrary';

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
  const isAdmin = me.role === 'admin';
  const [tab, setTab] = useState('today');
  const [wellness, setWellness] = useState<'running' | 'nutrition' | 'recovery' | null>(null);
  const [proView, setProView] = useState<'athletes' | 'approvals'>('athletes');
  const [coachOpen, setCoachOpen] = useState(false);
  const [coachMessage,setCoachMessage]=useState('');
  const [playerLevel,setPlayerLevel]=useState<number|null>(null);
  useEffect(()=>{if(!isPro)api<{level:number}>('GET','/api/gamification').then(v=>setPlayerLevel(v.level)).catch(()=>{});},[isPro,tab]);
  const needsConsent = !isPro && !(me.consents.terms && me.consents.health_data);
  const navigate = (next: string) => { setTab(next); setWellness(null); window.scrollTo({ top: 0, behavior: 'smooth' }); };
  const goBack = () => { setWellness(null); window.scrollTo({ top: 0, behavior: 'smooth' }); };
  const screenTitle = tab === 'assessment' ? 'Mi evaluación física' : isPro ? (proView === 'athletes' ? t('athletes') : t('approvals')) : wellness ? t(wellness) : (tab === 'today' ? t('today') : t(tab === 'wellness' ? 'recovery' : tab));
  return (
    <>
      <header className="top"><div className="brand"><span className="brandmark">F</span><div><strong>FONDAL FIT</strong><small>{isPro ? t('pro') : playerLevel!==null ? 'Atleta · Nivel '+playerLevel : t('athlete')}</small></div></div><button className="header-action" onClick={() => navigate('settings')} aria-label={t('settings')}>⚙</button></header>
      {needsConsent ? <Consents me={me} refresh={refresh} /> : (
        <>
          <div className="screen-heading">
            {wellness && <button className="back-button" onClick={goBack} aria-label="Volver a bienestar">← Volver</button>}
            <h1>{screenTitle}</h1>
            {!isPro && tab === 'today' && <p className="screen-subtitle">Tu entrenamiento y tu progreso, en un solo lugar.</p>}
          </div>
          {isPro ? <>
            <div className="quick-tabs"><button className={proView === 'athletes' ? 'selected' : ''} onClick={() => setProView('athletes')}>{t('athletes')}</button><button className={proView === 'approvals' ? 'selected' : ''} onClick={() => setProView('approvals')}>{t('approvals')}</button></div>
            {coachOpen && <div className="coach-modal" role="dialog" aria-modal="true" aria-label="Fondal Coach profesional"><button className="back-button" onClick={()=>setCoachOpen(false)}>← Volver al estudio</button><BetaCoach /></div>}
            <button className="floating-coach" type="button" onClick={()=>setCoachOpen(true)}>🎙 Consultar tutor IA</button>
            {tab === 'development' ? <Development isAdmin={isAdmin}/> : tab === 'settings' ? <Settings me={me} refresh={refresh} onLang={onLang} onLogout={onLogout} /> : proView === 'athletes' ? <ProAthletes /> : <ProApprovals />}
          </> : <>
            {tab === 'assessment' && <Assessment onDone={()=>navigate('today')} onCancel={()=>navigate('today')} />}
            {tab === 'today' && <><ActivityBlocks/><button className="primary action-full" onClick={()=>navigate('assessment')}>Mi evaluación física · Hacer o repetir entrevista →</button><VirtualMentorChoice onCoach={()=>setCoachOpen(true)} onProfessional={()=>navigate('settings')}/><button className="primary action-full" onClick={()=>setCoachOpen(true)}>Consultar a Fondal Coach →</button><div className="hero card"><div className="eyebrow">TU PLAN PERSONAL</div><h2>Entrená con un propósito.</h2><p>Tu sesión se ajusta a la evaluación inicial y al progreso que registres.</p><div className="hero-note">Empezá por la sesión que corresponde a tu plan.</div></div><Training /><LearningTips topic="training" /></>}
            {tab === 'progress' && <Progress />}
            {tab === 'development' && <Development isAdmin={isAdmin}/>}
            {tab === 'wellness' && (wellness === 'running' ? <Running /> : wellness === 'nutrition' ? <Nutrition /> : wellness === 'recovery' ? <Recovery /> : <div className="feature-grid">
              <button className="feature-card" onClick={() => setWellness('running')}><span className="feature-icon">↗</span><strong>{t('running')}</strong><small>Distancia, ritmos y registro de carreras</small><span>Ver actividad →</span></button>
              <button className="feature-card" onClick={() => setWellness('nutrition')}><span className="feature-icon">◉</span><strong>{t('nutrition')}</strong><small>Comidas, energía y proteínas diarias</small><span>Ver alimentación →</span></button>
              <button className="feature-card" onClick={() => setWellness('recovery')}><span className="feature-icon">☾</span><strong>{t('recovery')}</strong><small>Sueño, fatiga y disponibilidad</small><span>Ver recuperación →</span></button>
            </div>)}
            <button className="floating-coach" type="button" onClick={()=>setCoachOpen(true)} aria-label="Preguntar a mi tutor"><span className="pixel-mentor" aria-hidden="true"><span className="pixel-eyes">▪ ▪</span><span className="pixel-smile">▔</span></span><span>Preguntá a tu tutor</span></button>
            {coachOpen && <div className="coach-modal" role="dialog" aria-modal="true" aria-label="Fondal Coach"><button className="back-button" onClick={()=>setCoachOpen(false)}>← Volver al entrenamiento</button><BetaCoach initialMessage={coachMessage} onMessageChange={setCoachMessage}/></div>}
            {tab === 'settings' && <Settings me={me} refresh={refresh} onLang={onLang} onLogout={onLogout} onReassess={()=>navigate('assessment')} />}
          </>}
          <nav className="tabs" aria-label="Navegación principal">
            {((isPro ? [['today', 'Inicio', '⌂'], ['settings', 'Perfil', '◎'], ['development', 'Desarrollo', '◫']] : [['today', 'Hoy', '⌂'], ['progress', 'Progreso', '▥'], ['wellness', 'Bienestar', '♡'], ['assessment', 'Evaluación', '▤'], ['settings', 'Perfil', '◎'], ['development', 'Desarrollo', '◫']]) as [string, string, string][]).map(([key, label, symbol]) => <button key={key} className={tab === key ? 'on' : ''} aria-current={tab === key ? 'page' : undefined} onClick={() => navigate(key)}><span className="nav-icon" aria-hidden="true">{symbol}</span><span>{label}</span></button>)}
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
  const [exerciseNames,setExerciseNames]=useState<Record<string,string>>({});
  useEffect(()=>{api<{id:string;name:string}[]>('GET','/api/exercises').then(items=>setExerciseNames(Object.fromEntries(items.map(i=>[i.id,i.name])))).catch(()=>{});},[]);
  const load = useCallback(() => api<PlanRes>('GET', '/api/plan').then(setRes).catch(() => setMsg('No pudimos cargar tu plan. Revisá tu conexión.')), []);
  useEffect(() => { load(); }, [load]);
  if (!res) return <div className="card"><p>{msg || 'Cargando tu entrenamiento…'}</p></div>;
  if (!res.plan) return <Assessment onDone={load} />;
  if (session !== null) return <Session exerciseNames={exerciseNames} day={res.plan.days[session]!} index={session} onCancel={() => setSession(null)} onDone={(m) => { setMsg(m); setSession(null); load(); }} />;
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
        {day.items.map((it) => <div className="exercise-preview" key={it.exerciseId}><strong>{exerciseNames[it.exerciseId]??t('ex_' + it.exerciseId)}</strong><span>{it.sets} × {it.repMin}–{it.repMax} · RIR {it.rirTarget}{it.load ? ` · ${it.load} kg` : ''}</span></div>)}
        <button className="primary action-full" onClick={() => setSession(index)}>Empezar sesión →</button>
      </div>)}
    </section>
  );
}

type AssessmentValues = {
 goal:string;secondaryGoals:string[];specificGoals:string[];targetDescription:string;targetDate:string;
 daysPerWeek:number;sessionMinutes:number;preferredActivities:string[];experience:string;equipment:string[];restrictions:string[];
 redFlags:{chestPain:boolean;dizziness:boolean;recentSurgery:boolean;pregnancy:boolean;medication:boolean};
 baseline:Record<string,number>;trainingContext:Record<string,number>;
};
const GOAL_DETAILS=['Correr 5 km','Correr 10 km','Media maratón','Maratón','Mejorar ritmo de carrera','Aumentar distancia','Mejorar capacidad aeróbica','Ganar fuerza máxima','Ganar masa muscular','Resistencia muscular','Reducir grasa corporal','Mantener peso','Mejorar composición corporal','Mejorar movilidad','Mejorar equilibrio','Volver a entrenar','Prevenir lesiones','Mejorar salud metabólica','Preparar una competencia','Entrenamiento combinado','Mejorar bienestar general'];
const DEFAULT_ASSESSMENT:AssessmentValues={
 goal:'general',secondaryGoals:[],specificGoals:[],targetDescription:'',targetDate:'',daysPerWeek:3,sessionMinutes:60,
 preferredActivities:['strength'],experience:'beginner',equipment:['none'],restrictions:[],
 redFlags:{chestPain:false,dizziness:false,recentSurgery:false,pregnancy:false,medication:false},
 baseline:{},trainingContext:{preferredReassessmentWeeks:6}
};
function Assessment({onDone,onCancel,initial}:{onDone:()=>void;onCancel?:()=>void;initial?:Partial<AssessmentValues>}) {
 const t=useT();
 const GOALS=['general','strength','hypertrophy','endurance','fat_loss','mobility','hybrid'];
 const [step,setStep]=useState(0),[busy,setBusy]=useState(false),[error,setError]=useState(''),[referral,setReferral]=useState(false);
 const [customGoal,setCustomGoal]=useState('');
 const [a,setA]=useState<AssessmentValues>(()=>({...DEFAULT_ASSESSMENT,...initial,baseline:{...initial?.baseline},trainingContext:{preferredReassessmentWeeks:6,...initial?.trainingContext},redFlags:{...DEFAULT_ASSESSMENT.redFlags,...initial?.redFlags}}));
 useEffect(()=>{
   if(initial)return;
   let cancelled=false;
   api<{date:string;assessment:Partial<AssessmentValues>}[]>('GET','/api/assessments').then(rows=>{
     if(cancelled||!rows.length)return;
     const prev=rows[0]!.assessment;
     setA({...DEFAULT_ASSESSMENT,...prev,baseline:{...prev.baseline},trainingContext:{preferredReassessmentWeeks:6,...prev.trainingContext},redFlags:{...DEFAULT_ASSESSMENT.redFlags,...prev.redFlags}});
   }).catch(()=>{});
   return ()=>{cancelled=true;};
 },[initial]);

 const baselineField=(key:string,label:string,min:number,max:number,stepSize=1)=><label key={key}>{label} <span className="muted">(opcional)</span><input type="number" min={min} max={max} step={stepSize} value={a.baseline[key]??''} placeholder="No medido" onChange={e=>{const v=e.target.value;setA(prev=>{const baseline={...prev.baseline};if(v==='')delete baseline[key];else baseline[key]=Number(v);return {...prev,baseline};});}}/></label>;
 const contextField=(key:string,label:string,min:number,max:number)=><label key={key}>{label}<input type="number" min={min} max={max} value={a.trainingContext[key]??''} placeholder="Opcional" onChange={e=>{const v=e.target.value;setA(prev=>{const trainingContext={...prev.trainingContext};if(v==='')delete trainingContext[key];else trainingContext[key]=Number(v);return {...prev,trainingContext};});}}/></label>;
 const submit=async()=>{setBusy(true);setError('');try{
  const payload={...a,secondaryGoals:a.secondaryGoals.filter(g=>g!==a.goal),targetDate:a.targetDate||undefined};
  const result=await api<{referral?:boolean;professionalPlanPreserved?:boolean}>('POST','/api/assessment',payload);
  if(result.referral){setReferral(true);setError('Tus respuestas indican que es recomendable una revisión profesional antes de generar una nueva rutina.');}
  else onDone();
 }catch{setError('No pudimos guardar la evaluación. Revisá los campos e intentá nuevamente.');}finally{setBusy(false);}};
 const titles=['Tus objetivos personales','Tu experiencia y disponibilidad','Tu punto de partida','Capacidad y recuperación','Equipamiento y limitaciones','Seguridad y revisión'];
 return <section className="card onboarding" aria-label="Evaluación física y objetivos">
  <div className="eyebrow">EVALUACIÓN PERSONAL · PASO {step+1} DE 6</div><div className="wizard-track"><span style={{width:`${(step+1)*100/6}%`}}/></div>
  <h2>{titles[step]}</h2>
  {step===0&&<><p className="muted">No hay una lista cerrada de metas. Elegí un enfoque principal y todas las metas específicas que correspondan.</p>
   <label>Enfoque principal del plan</label><Chips options={GOALS} value={[a.goal]} onChange={v=>setA({...a,goal:v[0]!,secondaryGoals:a.secondaryGoals.filter(g=>g!==v[0])})}/>
   <label>Enfoques complementarios</label><Chips multi options={GOALS.filter(g=>g!==a.goal)} value={a.secondaryGoals} onChange={v=>setA({...a,secondaryGoals:v})}/>
   <label>Metas concretas (selección múltiple)</label><div className="chips">{GOAL_DETAILS.map(goal=><button type="button" className={'chip'+(a.specificGoals.includes(goal)?' on':'')} key={goal} onClick={()=>setA(v=>({...v,specificGoals:v.specificGoals.includes(goal)?v.specificGoals.filter(x=>x!==goal):[...v.specificGoals,goal].slice(0,12)}))}>{goal}</button>)}</div>
   <label>Otra meta, en tus palabras</label><div className="row"><input value={customGoal} maxLength={100} placeholder="Ej.: completar 15 km sin parar" onChange={e=>setCustomGoal(e.target.value)}/><button type="button" disabled={!customGoal.trim()||a.specificGoals.length>=12} onClick={()=>{setA(v=>({...v,specificGoals:[...v.specificGoals,customGoal.trim()]}));setCustomGoal('');}}>Agregar</button></div>
   <label>Resultado medible que querés conseguir</label><input maxLength={200} value={a.targetDescription} onChange={e=>setA({...a,targetDescription:e.target.value})} placeholder="Ej.: correr 10 km en menos de 55 minutos"/>
   <label>Fecha objetivo (opcional)</label><input type="date" value={a.targetDate} onChange={e=>setA({...a,targetDate:e.target.value})}/>
  </>}
  {step===1&&<><label>Experiencia actual</label><Chips options={['beginner','intermediate','advanced']} value={[a.experience]} onChange={v=>setA({...a,experience:v[0]!})}/>
   <label>Días disponibles para fuerza</label><input type="number" min={1} max={6} value={a.daysPerWeek} onChange={e=>setA({...a,daysPerWeek:Number(e.target.value)})}/>
   <label>Duración disponible por sesión</label><select value={a.sessionMinutes} onChange={e=>setA({...a,sessionMinutes:Number(e.target.value)})}>{[20,30,45,60,75,90,120].map(n=><option key={n} value={n}>{n} minutos</option>)}</select>
   {contextField('strengthDays','Sesiones actuales de fuerza por semana',0,7)}
   {contextField('cardioDays','Sesiones actuales de cardio por semana',0,7)}
   {contextField('recentBreakWeeks','Semanas desde tu última rutina regular (0 si entrenás)',0,520)}
   <p className="muted">Fuerza y cardio se registran por separado y pueden realizarse el mismo día.</p>
  </>}
  {step===2&&<><p className="muted">Estos datos describen tu situación actual. No son exámenes obligatorios ni equivalen a una prueba de esfuerzo.</p>
   <div className="assessment-fields">{baselineField('age','Edad (años)',13,100)}{baselineField('weightKg','Peso (kg)',25,350,.1)}{baselineField('heightCm','Altura (cm)',100,240,.1)}
   {baselineField('weeklyStrengthSessions','Sesiones de fuerza habituales/semana',0,14)}{baselineField('weeklyRunKm','Kilómetros de carrera por semana',0,300,.1)}
   {baselineField('longestComfortableRunKm','Mayor distancia cómoda (km)',0,100,.1)}{baselineField('comfortableRunPaceMinKm','Ritmo cómodo (min/km)',2,20,.1)}
   {baselineField('activityMinutesPerWeek','Minutos activos por semana',0,2000)}</div>
  </>}
  {step===3&&<><p className="muted">Solo completá las mediciones que conozcas. No hagas pruebas máximas ni te exijas para completar el formulario.</p>
   <div className="assessment-fields">{baselineField('walkingMinutes','Minutos caminando sin dificultad',0,240)}{baselineField('pushUps','Flexiones controladas habituales',0,200)}
   {baselineField('sitToStand30s','Levantadas de silla en 30 segundos (si ya lo mediste)',0,100)}
   {baselineField('restingHeartRate','Pulso en reposo medido (lat/min)',35,180)}
   {baselineField('perceivedFitness','Condición física percibida (1–10)',1,10)}
   {baselineField('sleepHours','Horas de sueño habituales',0,16,.5)}
   {baselineField('recovery','Recuperación percibida (1–10)',1,10)}</div>
   <p className="muted">Los resultados auto-reportados no estiman con precisión VO₂máx ni fuerza máxima. La carga inicial será conservadora y se ajustará con tus sesiones.</p>
  </>}
  {step===4&&<><label>Equipamiento disponible</label><Chips multi options={['none','dumbbells','barbell','bands','bar','rings','machines']} value={a.equipment} onChange={v=>setA({...a,equipment:v})}/>
   <label>Actividades preferidas</label><div className="chips">{(['strength','running','mobility'] as const).map(k=><button type="button" className={'chip'+(a.preferredActivities.includes(k)?' on':'')} key={k} onClick={()=>setA(v=>({...v,preferredActivities:v.preferredActivities.includes(k)?v.preferredActivities.filter(x=>x!==k):[...v.preferredActivities,k]}))}>{k==='strength'?'Fuerza':k==='running'?'Running':'Movilidad'}</button>)}</div>
   <label>Molestias o limitaciones actuales</label><Chips multi options={['knee','shoulder','lower_back','hip','ankle','wrist','neck']} value={a.restrictions} onChange={v=>setA({...a,restrictions:v})}/>
   {contextField('confidence','Confianza para sostener el plan (1–10)',1,10)}
  </>}
  {step===5&&<><p className="muted">Marcá las situaciones que correspondan. Las señales de alerta requieren revisión antes de generar una rutina; no sustituyen una evaluación médica.</p>
   {Object.keys(a.redFlags).map(k=><label className="check" key={k}><input type="checkbox" checked={(a.redFlags as Record<string,boolean>)[k]} onChange={e=>setA({...a,redFlags:{...a.redFlags,[k]:e.target.checked}})}/>{t('rf_'+k)}</label>)}
   <label>¿Cada cuántas semanas querés revisar tu evaluación?</label><select value={a.trainingContext.preferredReassessmentWeeks??6} onChange={e=>setA({...a,trainingContext:{...a.trainingContext,preferredReassessmentWeeks:Number(e.target.value)}})}>{[2,4,6,8,12,16,24].map(n=><option value={n} key={n}>{n} semanas</option>)}</select>
   <p className="muted">Podés repetirla cuando quieras desde Perfil. Se conservará el historial y no se reemplazará una rutina asignada por tu profesional.</p>
  </>}
  {error&&<p className="bad" role="alert">{error}</p>}
  <div className="wizard-actions">{step>0&&<button type="button" onClick={()=>{setStep(v=>v-1);setError('');}}>← Atrás</button>}{onCancel&&<button type="button" onClick={onCancel}>Cancelar</button>}
  {step<5?<button className="primary" type="button" onClick={()=>setStep(v=>v+1)}>Continuar →</button>:<button className="primary" type="button" disabled={busy||referral||!a.equipment.length||a.daysPerWeek<1||a.daysPerWeek>6} onClick={()=>void submit()}>{busy?'Guardando…':'Guardar evaluación'}</button>}</div>
 </section>;
}

function Session({ day, index, onDone, onCancel, exerciseNames }: { exerciseNames: Record<string,string>; day: { name: string; items: Rx[]; run?: {minutes:number;intensity:string;note:string} }; index: number; onDone: (msg: string) => void; onCancel: () => void }) {
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
          <h3>{exerciseNames[it.exerciseId]??t('ex_' + it.exerciseId)}</h3><p className="muted">{it.repMin}-{it.repMax} {t('reps')} · {t('rir')} {it.rirTarget}</p>
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
type RunSplit = { km: number; seconds: number; pace: number };
type RunSummary = { date: string; km: number; minutes: number; avgPace: number; kcal: number; weightKg: number; splits: RunSplit[]; tips: string[] };
function GpsRun({ onDraft }: { onDraft: (km: number, minutes: number, weightKg: number) => void }) {
  const [active, setActive] = useState(false);
  const [touchLocked, setTouchLocked] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [meters, setMeters] = useState(0);
  const [pace, setPace] = useState<number | null>(null);
  const [weightKg, setWeightKg] = useState(70);
  const [gpsVisible,setGpsVisible]=useState(true);
  const [gpsInterrupted,setGpsInterrupted]=useState(false);
  const [status, setStatus] = useState('Necesita permiso de ubicación y HTTPS.');
  const [summary, setSummary] = useState<RunSummary | null>(()=>{try{const saved=localStorage.getItem('ff_last_run_summary');return saved?JSON.parse(saved) as RunSummary:null;}catch{return null;}});
  const [splits, setSplits] = useState<RunSplit[]>([]);
  const [unlocked, setUnlocked] = useState(0);
  const [route,setRoute]=useState<GPSPoint[]>([]);
  const routeRef=useRef<GPSPoint[]>([]);
  const resumeFlag=useRef(false);
  const [resumeSnapshot,setResumeSnapshot]=useState<{startedAt:number;meters:number;last:GPSPoint;route:GPSPoint[]}|null>(()=>{
    try{
      const raw=localStorage.getItem('ff_active_gps');
      const val=raw?JSON.parse(raw) as {startedAt:number;meters:number;last:GPSPoint;route:GPSPoint[]}:null;
      return val&&Date.now()-val.startedAt<21600000?val:null;
    }catch{return null;}
  });
  const [gap,setGap]=useState<{from:GPSPoint;to:GPSPoint;meters:number;seconds:number}|null>(null);
  const [estimatedGap,setEstimatedGap]=useState(0);
  const saveCheckpoint=(point:GPSPoint)=>{
    const arr=[...routeRef.current.slice(-499),point];routeRef.current=arr;setRoute(arr);
    try{localStorage.setItem('ff_active_gps',JSON.stringify({startedAt:startedAt.current,meters:distanceRef.current,last:point,route:arr}));}catch{}
  };
  const watchId = useRef<number | null>(null);
  const lastPoint = useRef<{lat:number;lon:number;at:number}|null>(null);
  const startedAt = useRef(0);
  const wake = useRef<{release:()=>Promise<void>}|null>(null);
  const running = useRef(false);
  const distanceRef = useRef(0);
  const splitsRef = useRef<RunSplit[]>([]);
  const splitAt = useRef(0);
  const lastPaces = useRef<number[]>([]);
  const stop = useCallback(() => {
    running.current = false;
    if (watchId.current !== null) navigator.geolocation.clearWatch(watchId.current);
    watchId.current = null;
    void wake.current?.release().catch(()=>{});
    wake.current = null;
    setActive(false);
    setTouchLocked(false);
  }, []);
  useEffect(() => () => {
    running.current = false;
    if (watchId.current !== null) navigator.geolocation.clearWatch(watchId.current);
    void wake.current?.release().catch(()=>{});
  }, []);
  useEffect(()=>{
    const visibility=()=>{setGpsVisible(document.visibilityState==='visible');if(running.current&&document.visibilityState!=='visible')setGpsInterrupted(true);};
    document.addEventListener('visibilitychange',visibility);
    return ()=>document.removeEventListener('visibilitychange',visibility);
  },[]);
  useEffect(() => {
    if (!active) return;
    const id = window.setInterval(()=>setElapsed(Math.max(0,Math.floor((Date.now()-startedAt.current)/1000))),1000);
    return ()=>clearInterval(id);
  },[active]);
  const fmt = (minutes:number|null) => minutes === null || !Number.isFinite(minutes) || minutes <= 0 ? '—:—' : Math.floor(minutes)+':'+String(Math.round((minutes%1)*60)).padStart(2,'0');
  const start = async (resume=false) => {
    if (!navigator.geolocation) { setStatus('Este navegador no ofrece GPS.'); return; }
    if (!window.isSecureContext) { setStatus('El GPS requiere HTTPS.'); return; }
    setSummary(null);setElapsed(0);setPace(null);setSplits([]);setUnlocked(0);setGpsInterrupted(false);setGap(null);
    splitsRef.current=[];lastPaces.current=[];splitAt.current=0;setEstimatedGap(0);
    if(resume&&resumeSnapshot){
      distanceRef.current=resumeSnapshot.meters;setMeters(resumeSnapshot.meters);
      lastPoint.current=resumeSnapshot.last;startedAt.current=resumeSnapshot.startedAt;
      routeRef.current=resumeSnapshot.route;setRoute(resumeSnapshot.route);resumeFlag.current=true;
    }else{
      distanceRef.current=0;setMeters(0);
      lastPoint.current=null;startedAt.current=Date.now();routeRef.current=[];setRoute([]);resumeFlag.current=false;
    }
    setResumeSnapshot(null);running.current=true;setActive(true);setStatus('Buscando señal GPS…');
    try {
      const n = navigator as Navigator & {wakeLock?:{request:(type:'screen')=>Promise<{release:()=>Promise<void>}>}};
      if (n.wakeLock) wake.current=await n.wakeLock.request('screen');
    } catch {setStatus('No se pudo mantener la pantalla encendida. Evitá bloquearla.');}
    if (!running.current) return;
    watchId.current=navigator.geolocation.watchPosition(pos=>{
      if(!running.current) return;
      const {latitude:lat,longitude:lon,accuracy,speed}=pos.coords;
      if(accuracy>40) {setStatus('Señal imprecisa; esperando una posición mejor…');return;}
      const at=pos.timestamp,prev=lastPoint.current;
      const point:GPSPoint={lat,lon,at};
      if(resumeFlag.current&&prev){
        resumeFlag.current=false;
        const missing=missingGPSGap(prev,point);
        if(missing.plausible&&missing.meters>15)setGap({from:prev,to:point,...missing});
        lastPoint.current=point;saveCheckpoint(point);
        setStatus('Se recuperó la ubicación. Revisá el tramo sin GPS antes de sumarlo.');
        return;
      }
      if(prev) {
        const rad=Math.PI/180,dlat=(lat-prev.lat)*rad,dlon=(lon-prev.lon)*rad;
        const h=Math.sin(dlat/2)**2+Math.cos(prev.lat*rad)*Math.cos(lat*rad)*Math.sin(dlon/2)**2;
        const distance=12742000*Math.asin(Math.min(1,Math.sqrt(h)));
        const seconds=(at-prev.at)/1000;
        if(seconds>0 && distance>=3 && distance/seconds<8) {
          distanceRef.current+=distance;
          setMeters(distanceRef.current);
          const speedMps = speed!==null && speed>0.6 && speed<8 ? speed : distance/seconds;
          if(speedMps>0.6) {
            const nextPace=1000/speedMps/60;
            lastPaces.current=[...lastPaces.current.slice(-4),nextPace];
            const avg=lastPaces.current.reduce((sum,x)=>sum+x,0)/lastPaces.current.length;
            setPace(avg);
          } else setPace(null);
          const wholeKm=Math.floor(distanceRef.current/1000);
          if(wholeKm>splitsRef.current.length) {
            const since=(at-startedAt.current)/1000;
            const previousElapsed=splitAt.current;
            if(since-previousElapsed>0) {
              const split={km:wholeKm,seconds:Math.round(since-previousElapsed),pace:(since-previousElapsed)/60};
              splitsRef.current=[...splitsRef.current,split];setSplits(splitsRef.current);
              splitAt.current=since;
            }
          }
          lastPoint.current=point;saveCheckpoint(point);
          setStatus('GPS activo · distancia y ritmo aproximados');
        } else if(seconds>0 && distance/seconds>=8) {
          setStatus('Se ignoró un salto GPS poco probable.');
        } else if(seconds>=15 && distance<3) {
          lastPoint.current=point;saveCheckpoint(point);setPace(null);
        }
      } else {lastPoint.current=point;saveCheckpoint(point);setStatus('Señal GPS adquirida.');}
    },e=>setStatus(e.code===1?'Ubicación denegada. Revisá los permisos.':'Sin señal GPS; la distancia puede ser incompleta.'),{enableHighAccuracy:true,maximumAge:0,timeout:15000});
  };
  const finish=()=>{
    const km=distanceRef.current/1000,mins=(Date.now()-startedAt.current)/60000;
    const fullSplits=splitsRef.current;
    const remainingKm=km-fullSplits.length;
    const remainingSecs=mins*60-splitAt.current;
    const allSplits=remainingKm>=0.1&&remainingSecs>0?[...fullSplits,{km:Math.round(km*100)/100,seconds:Math.round(remainingSecs),pace:remainingSecs/60/remainingKm}]:fullSplits;
    // Distance based approximation for running, not a wearable measurement.
    const kcal=Math.round(km*Math.max(30,Math.min(250,weightKg)));
    const validPaces=allSplits.map(x=>x.pace).filter(Number.isFinite);
    const spread=validPaces.length>1?Math.max(...validPaces)-Math.min(...validPaces):0;
    const tips=[spread>0.75?'Tus parciales variaron bastante: probá empezar más suave para sostener el ritmo.':'Buscá un ritmo cómodo y sostenible antes de acelerar.',
      'El GPS y las calorías son estimaciones; sin pulsómetro no se pueden calcular zonas cardíacas reales.',
      'Compará tu ritmo con sesiones de distancia similar, no solamente con tu carrera más rápida.'];
    const result:RunSummary={date:new Date().toISOString(),km:Number(km.toFixed(2)),minutes:Number(mins.toFixed(2)),avgPace:km>0?mins/km:0,kcal,weightKg,splits:allSplits,tips};
    stop();setSummary(result);setResumeSnapshot(null);
    try{localStorage.removeItem('ff_active_gps');}catch{}
    if(km>0.05&&mins>0)onDraft(Number(km.toFixed(2)),Number(mins.toFixed(2)),weightKg);
    try {localStorage.setItem('ff_last_run_summary',JSON.stringify(result));} catch {/* optional device storage */}
  };
  const paceGroups=splits.reduce((out,split)=>{const k=split.pace<5?'Rápido (<5:00)':split.pace<6.5?'Medio (5:00–6:30)':'Suave (>6:30)';out[k]=(out[k]||0)+1;return out;},{} as Record<string,number>);
  return <div className="card gps-run">
    <h3>Running GPS · beta</h3>
    <RunningMap points={route} gap={gap}/>
    {resumeSnapshot&&!active&&<div className="card"><p>Hay una corrida interrumpida a las {new Date(resumeSnapshot.startedAt).toLocaleTimeString('es-AR',{hour:'2-digit',minute:'2-digit'})}. Recuperamos {(resumeSnapshot.meters/1000).toFixed(2)} km medidos.</p><button className="primary" onClick={()=>void start(true)}>Retomar corrida interrumpida</button><button onClick={()=>{setResumeSnapshot(null);try{localStorage.removeItem('ff_active_gps');}catch{}}}>Descartar recuperación</button></div>}
    {gap&&<div className="card"><h4>Tramo sin GPS</h4><p>Entre estos puntos transcurrieron {Math.round(gap.seconds/60)} minutos. Distancia mínima recta: {(gap.meters/1000).toFixed(2)} km. El recorrido real podría ser más largo.</p><button onClick={()=>{distanceRef.current+=gap.meters;setMeters(distanceRef.current);setEstimatedGap(g=>g+gap.meters);setGap(null);}}>Agregar estimación mínima</button><button onClick={()=>setGap(null)}>No sumar</button></div>}
    <p className="muted">Mantené abierta la pantalla. En iOS y Android la web no garantiza GPS cuando se bloquea el teléfono o queda en segundo plano.</p>
    <div className="gps-metrics">
      <div><strong>{(meters/1000).toFixed(2)}</strong><small>km</small></div>
      <div><strong>{Math.floor(elapsed/60)}:{String(elapsed%60).padStart(2,'0')}</strong><small>tiempo</small></div>
      <div><strong>{fmt(pace)}</strong><small>ritmo actual min/km</small></div>
      <div><strong>{fmt(meters>50?elapsed/60/(meters/1000):null)}</strong><small>ritmo promedio min/km</small></div>
    </div>
    <p role="status" className="muted">{status}</p>
    {!gpsVisible&&<p className="warn">La aplicación está en segundo plano: el GPS puede interrumpirse.</p>}
    {gpsInterrupted&&<p className="warn">La app pasó a segundo plano durante la sesión. Revisá la distancia: puede estar incompleta.</p>}
    {active&&<p className="live-kcal" aria-live="off">≈{Math.round((meters/1000)*weightKg)} kcal de carrera estimadas · {weightKg} kg</p>}
    {!active ? <><label htmlFor="gps-weight">Peso para estimar energía (kg)</label><input id="gps-weight" type="number" min={30} max={250} value={weightKg} onChange={e=>setWeightKg(Number(e.target.value)||70)}/>
      <button className="primary action-full" onClick={()=>void start()}>Iniciar carrera con GPS</button></> :
      <div className="gps-actions"><button onClick={()=>setTouchLocked(true)}>Congelar pantalla</button><button onClick={finish}>Terminar carrera</button></div>}
    {touchLocked&&active&&<div className="gps-touch-lock" role="dialog" aria-label="Pantalla congelada">
      <strong>Running activo · pantalla congelada</strong>
      <div className="gps-metrics"><div><strong>{(meters/1000).toFixed(2)}</strong><small>km</small></div><div><strong>{fmt(pace)}</strong><small>min/km</small></div></div>
      <p className="muted">Solo el deslizador permite salir del bloqueo. La corrida sigue registrándose en primer plano.</p>
      <label htmlFor="unlock-slide">Deslizar para desbloquear</label>
      <input id="unlock-slide" aria-label="Deslizar para desbloquear" className="unlock-slider" type="range" min={0} max={100} value={unlocked}
        onChange={e=>{const value=Number(e.target.value);if(value>=95){setTouchLocked(false);setUnlocked(0);}else setUnlocked(value);}}
        onPointerUp={()=>setUnlocked(v=>v>=95?0:0)}
        onTouchEnd={()=>setUnlocked(0)}/> 
      <span className="muted">Deslizá de izquierda a derecha →</span>
      <small>El botón físico de suspensión no controla esta función.</small>
    </div>}
    {summary&&<div className="run-summary">
      <h3>Resumen de tu última carrera</h3>
      <div className="gps-metrics"><div><strong>{summary.km.toFixed(2)}</strong><small>km</small></div><div><strong>{fmt(summary.avgPace)}</strong><small>ritmo medio min/km</small></div><div><strong>{summary.kcal}</strong><small>kcal estimadas</small></div><div><strong>{Math.round(summary.minutes)}</strong><small>minutos</small></div></div>
      <h4>Ritmo por tramo</h4>
      {summary.splits.length?summary.splits.map((sp,i)=><p key={i} className="run-split">{i<summary.splits.length-1?'Kilómetro '+sp.km:'Tramo '+sp.km+' km'}: {fmt(sp.pace)} min/km</p>):<p className="muted">No hubo suficientes puntos GPS para calcular parciales.</p>}
      <h4>Bandas de ritmo (no zonas cardíacas)</h4>
      {Object.entries(paceGroups).map(([label,count])=><p key={label}>{label}: {count} tramo(s)</p>)}
      <h4>Ideas para mejorar</h4>{summary.tips.map(t=><p key={t} className="muted">{t}</p>)}
      <p className="muted">Calorías aproximadas: peso × kilómetros. No es gasto metabólico medido. Revisá el registro de abajo y guardalo si corresponde.</p>
    </div>}
  </div>;
}

type BrowserSpeechRecognition = {
  lang:string;continuous:boolean;interimResults:boolean;
  onresult:((event:{results:ArrayLike<{0:{transcript:string}}>;resultIndex:number})=>void)|null;
  onerror:((event:{error:string})=>void)|null;
  onend:(()=>void)|null;
  start:()=>void;stop:()=>void;
};
function VoiceDictation({onTranscript}:{onTranscript:(text:string)=>void}){
 const [active,setActive]=useState(false);
 const [error,setError]=useState('');
 const recognizer=useRef<BrowserSpeechRecognition|null>(null);
 useEffect(()=>()=>recognizer.current?.stop(),[]);
 const toggle=()=>{
  if(active){recognizer.current?.stop();setActive(false);return;}
  const w=window as Window & {SpeechRecognition?:new()=>BrowserSpeechRecognition;webkitSpeechRecognition?:new()=>BrowserSpeechRecognition};
  const Speech=w.SpeechRecognition??w.webkitSpeechRecognition;
  if(!Speech){setError('Dictado web no disponible en este navegador. Podés usar el micrófono del teclado del teléfono.');return;}
  try{
   const r=new Speech();r.lang='es-AR';r.continuous=false;r.interimResults=false;
   r.onresult=event=>{const parts:string[]=[];for(let i=event.resultIndex;i<event.results.length;i++)parts.push(event.results[i]![0].transcript);onTranscript(parts.join(' ').trim());};
   r.onerror=event=>{setError('No se pudo transcribir ('+event.error+'). Probá con el dictado del teclado.');setActive(false);};
   r.onend=()=>setActive(false);recognizer.current=r;r.start();setActive(true);setError('');
  }catch{setError('No se pudo iniciar el micrófono. Revisá los permisos.');}
 };
 return <div className="voice-input"><button type="button" onClick={toggle} aria-pressed={active}>{active?'■ Detener dictado':'🎙 Dictar por voz'}</button>{error&&<p className="muted" role="status">{error}</p>}</div>;
}
function MusicCenter(){
 const [provider,setProvider]=useState<'spotify'|'youtube'>(()=>{try{return localStorage.getItem('ff_music_provider')==='youtube'?'youtube':'spotify';}catch{return 'spotify';}});
 const [link,setLink]=useState(()=>{try{return localStorage.getItem('ff_spotify_playlist')??'';}catch{return '';}});
 const [active,setActive]=useState('');
 const [error,setError]=useState('');
 const embed=active.match(/^(?:https:\/\/open\.spotify\.com\/(?:intl-[a-z]{2}\/)?|spotify:)(playlist|album|track)[\/:]([a-zA-Z0-9]{22})(?:[?].*)?$/);
 const select=(next:'spotify'|'youtube')=>{setProvider(next);try{localStorage.setItem('ff_music_provider',next);}catch{}};
 const load=()=>{
  const match=link.trim().match(/^(?:https:\/\/open\.spotify\.com\/(?:intl-[a-z]{2}\/)?|spotify:)(playlist|album|track)[\/:]([a-zA-Z0-9]{22})(?:[?].*)?$/);
  if(!match){setError('Pegá un enlace de canción, álbum o playlist de Spotify.');return;}
  setActive(link.trim());setError('');try{localStorage.setItem('ff_spotify_playlist',link.trim());}catch{}
 };
 return <section className="card music-center"><div className="eyebrow">MÚSICA PARA ENTRENAR</div><h3>Tu música, sin salir del entrenamiento</h3>
  <div className="quick-tabs"><button className={provider==='spotify'?'selected':''} onClick={()=>select('spotify')}>Spotify</button><button className={provider==='youtube'?'selected':''} onClick={()=>select('youtube')}>YouTube Music</button></div>
  {provider==='spotify'?<><p className="muted">Pegá una playlist de Spotify. Se mostrará su reproductor oficial; no requiere conectar tu contraseña con Fondal Fit.</p>
   <label htmlFor="music-link">Enlace de Spotify</label><input id="music-link" type="url" placeholder="https://open.spotify.com/playlist/..." value={link} onChange={e=>setLink(e.target.value)}/>
   <button type="button" onClick={load}>Abrir reproductor</button>
   {error&&<p className="warn" role="alert">{error}</p>}
   {embed&&<iframe title="Reproductor de Spotify" loading="lazy" allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture" src={`https://open.spotify.com/embed/${embed[1]}/${embed[2]}`} width="100%" height="180" style={{border:0,borderRadius:12}}/>}
   <p className="muted">Los controles disponibles dependen de Spotify y tu cuenta. Control remoto completo y reproducción interna requieren otra integración y revisión de permisos.</p>
  </>:<><p className="muted">YouTube Music no ofrece aquí un control remoto equivalente. Podés abrir su aplicación y continuar escuchando desde allí.</p><a href="https://music.youtube.com/" target="_blank" rel="noopener noreferrer">Abrir YouTube Music</a></>}
 </section>;
}

function BetaCoach({initialMessage='',onMessageChange}:{initialMessage?:string;onMessageChange?:(message:string)=>void}) {
  const [status,setStatus]=useState<{available:boolean;remaining:number;dailyLimit:number}|null>(null);
  const [message,setMessage]=useState(initialMessage);
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
    <label htmlFor="coach-message">Tu consulta</label><VoiceDictation onTranscript={text=>{setMessage(prev=>(prev?prev+" ":"")+text);onMessageChange?.(text);}}/><textarea id="coach-message" rows={3} maxLength={450} value={message} onChange={e=>{setMessage(e.target.value);onMessageChange?.(e.target.value);}} placeholder="¿Cómo adapto el entrenamiento de hoy a mi objetivo?"/>
    <button className="primary action-full" disabled={working||!message.trim()||!status?.available||status.remaining<=0} onClick={()=>void submit()}>{working?'Consultando…':'Consultar al coach'}</button>
    {error&&<p className="warn" role="alert">{error}</p>}
    {answer&&<div className="coach-answer" role="status">{answer}</div>}
  </section>;
}

function Development({ isAdmin }: { isAdmin: boolean }) {
  const [confirmation,setConfirmation]=useState('');
  const [status,setStatus]=useState('');
  const [working,setWorking]=useState(false);
  const reset=async()=>{
    if(confirmation!=='REINICIAR EVALUACIONES')return;
    if(!window.confirm('¿Reiniciar las evaluaciones y planes de TODOS los deportistas? Las cuentas, vínculos y registros históricos se conservarán.'))return;
    setWorking(true);
    try{const r=await api<{affectedAthletes:number}>('POST','/api/admin/reset-onboarding',{confirmation});setStatus('Evaluación inicial reiniciada para '+r.affectedAthletes+' deportistas. Volverán a completar el cuestionario al entrar.');setConfirmation('');}
    catch{setStatus('No se pudo reiniciar. Verificá tu sesión y permisos de administrador.');}
    finally{setWorking(false);}
  };
  return <section className="card"><div className="eyebrow">FONDAL FIT · BETA</div><h2>Desarrollo y pruebas</h2>
    <p className="muted">Estado de funciones implementadas en el código. No equivale a verificación del despliegue ni a una auditoría en dispositivos reales.</p>
    <div className="development-list">
      {[
        ['Entrenamientos por objetivos','Implementado · beta'],
        ['Rutinas de profesionales y códigos','Implementado · beta'],
        ['Running GPS en primer plano','Implementado · limitación PWA'],
        ['Registro manual de distancia y velocidad','Implementado · estimaciones'],
        ['Biblioteca de 150 combinaciones de menús','Implementado · datos aproximados'],
        ['Tutor Gemini','Requiere clave del servidor'],
        ['Zonas cardíacas con sensores','Pendiente de integración'],
        ['App nativa y GPS en segundo plano','Pendiente']
      ].map(([name,state])=><div key={name}><strong>{name}</strong><span>{state}</span></div>)}
    </div>
    {isAdmin&&<div className="admin-reset"><h3>Herramienta de pruebas — administrador</h3>
      <p>Reiniciar la entrevista inicial para todas las cuentas de deportistas. Se eliminan evaluaciones y planes existentes, incluso los asignados por profesionales. Se conservan las cuentas, contraseñas, vínculos, carreras y registros de entrenamiento. Esta acción no se puede deshacer sin respaldo.</p>
      <label htmlFor="reset-confirm">Escribí REINICIAR EVALUACIONES</label>
      <input id="reset-confirm" value={confirmation} onChange={e=>setConfirmation(e.target.value)}/>
      <button className="danger action-full" disabled={working||confirmation!=='REINICIAR EVALUACIONES'} onClick={()=>void reset()}>{working?'Reiniciando…':'Reiniciar evaluaciones de todos'}</button>
      {status&&<p role="status">{status}</p>}
    </div>}
  </section>;
}

type EnergyDay={date:string;intake:number;runKcal:number;blocksKcal:number;estimatedExpenditure:number;balance:number|null;band:string;meals:{name:string;kcal:number}[];runs:{km:number;kcal:number}[];blocks:{name:string;minutes:number;kcal:number}[];provisional:boolean};
type EnergyCalendar={month:string;target:{kcal?:number;bmr?:number;tdee?:number;adjustmentPct?:number}|null;days:EnergyDay[];note:string};
const ENERGY_LABELS:Record<string,string>={red:'Superávit alto',orange:'Superávit leve',yellow:'Cerca del mantenimiento',green:'Déficit moderado estimado',blue:'Déficit alto: revisar',violet:'Déficit muy alto: atención',unknown:'Sin estimación'};
function DailyEnergyCalendar(){
 const now=new Date(),today=[now.getFullYear(),String(now.getMonth()+1).padStart(2,'0'),String(now.getDate()).padStart(2,'0')].join('-');
 const [month,setMonth]=useState(today.slice(0,7));
 const [selected,setSelected]=useState(today);
 const [result,setResult]=useState<EnergyCalendar|null>(null);
 const [error,setError]=useState('');
 const refresh=useCallback(()=>{setError('');api<EnergyCalendar>('GET',`/api/energy/calendar?month=${encodeURIComponent(month)}&timezoneOffset=${new Date().getTimezoneOffset()}`).then(setResult).catch(()=>setError('No se pudo cargar el calendario del balance energético.'));},[month]);
 useEffect(()=>{refresh();},[refresh]);
 const days=result?.days??[],byDate=new Map(days.map(d=>[d.date,d]));
 const parts=month.split('-').map(Number);const year=parts[0]??now.getFullYear(),m=parts[1]??now.getMonth()+1;
 const daysInMonth=new Date(year,m,0).getDate(),firstOffset=(new Date(year,m-1,1).getDay()+6)%7;
 const entries=Array.from({length:firstOffset+daysInMonth},(_,i)=>i<firstOffset?'':month+'-'+String(i-firstOffset+1).padStart(2,'0'));
 const chosen=byDate.get(selected);
 const move=(n:number)=>{const next=new Date(year,m-1+n,1);const value=[next.getFullYear(),String(next.getMonth()+1).padStart(2,'0')].join('-');setMonth(value);setSelected(value+'-01');};
 return <section className="card energy-calendar">
   <div className="eyebrow">ENERGÍA Y ACTIVIDAD</div><h2>Mi balance diario</h2>
   <p className="muted">Sumá comidas y carreras. Los colores representan estimaciones provisionales, nunca un diagnóstico ni una meta de restricción.</p>
   <div className="energy-month"><button onClick={()=>move(-1)} aria-label="Mes anterior">←</button><strong>{new Date(year,m-1,1).toLocaleDateString('es-AR',{month:'long',year:'numeric'})}</strong><button onClick={()=>move(1)} aria-label="Mes siguiente">→</button></div>
   <div className="energy-calendar-grid">{['L','M','M','J','V','S','D'].map((d,i)=><span className="weekday" key={i}>{d}</span>)}
     {entries.map((date,i)=>date?<button key={date} className={'energy-day '+(byDate.get(date)?.band??'empty')+(selected===date?' selected':'')} aria-pressed={selected===date} onClick={()=>setSelected(date)}><span>{Number(date.slice(-2))}</span>{byDate.has(date)&&<span className="day-dot" aria-hidden="true"/>}</button>:<span key={'blank-'+i}/>)}</div>
   {error&&<p role="alert" className="warn">{error}</p>}
   {!result?.target&&<p className="warn">Configurá tu objetivo de calorías en Nutrición para ver el balance estimado.</p>}
   <div className="energy-legend">{[['red','Superávit'],['orange','Superávit leve'],['yellow','Equilibrio'],['green','Déficit moderado'],['blue','Déficit alto'],['violet','Déficit muy alto']].map(([color,label])=><span key={color}><i className={color}/>{label}</span>)}</div>
   <div className="energy-day-summary"><h3>{new Date(selected+'T12:00:00').toLocaleDateString('es-AR',{weekday:'long',day:'numeric',month:'long'})}</h3>
    {chosen?<><p className="energy-band"><i className={chosen.band}/>{ENERGY_LABELS[chosen.band]??'Sin estimación'}</p>
      <div className="energy-figures"><div><strong>{chosen.intake}</strong><small>kcal ingeridas</small></div><div><strong>{chosen.runKcal}</strong><small>kcal por carreras (aprox.)</small></div><div><strong>{chosen.balance===null?'—':(chosen.balance>0?'+':'')+chosen.balance}</strong><small>balance diario estimado, kcal</small></div></div>
      <h4>Comidas</h4>{chosen.meals.length?chosen.meals.map((meal,i)=><p key={i}>{meal.name} · ≈{Math.round(meal.kcal)} kcal</p>):<p className="muted">No se registraron comidas.</p>}
      <h4>Bloques de entrenamiento</h4>{chosen.blocks?.length?chosen.blocks.map((b,i)=><p key={i}>{b.name} · {b.minutes} min · ≈{b.kcal} kcal activas</p>):<p className="muted">No hay otros bloques registrados.</p>}
      <h4>Carreras</h4>{chosen.runs.length?chosen.runs.map((run,i)=><p key={i}>{run.km.toFixed(2)} km · ≈{Math.round(run.kcal)} kcal</p>):<p className="muted">No hay carreras con peso registrado para estimar energía.</p>}
      <p className="muted">Balance provisional: referencia sedentaria, ejercicio registrado y alimentos declarados. No presupongas que el registro representa todas las comidas del día.</p>
     </>:<p className="muted">Todavía no hay registros para esta fecha.</p>}
   </div><details><summary>¿Cómo se calcula y qué significan los colores?</summary><p className="muted">Comparación orientativa entre alimentos registrados y gasto diario estimado, sumando la carrera. El cálculo puede contar dos veces parte del ejercicio si tu factor de actividad ya lo incluye. Los seis colores distinguen superávit, equilibrio y déficits de diferente magnitud; azul y violeta indican que conviene revisar la estimación, no son un premio. No uses un día incompleto para ajustar la alimentación.</p></details>
 </section>;
}

type FitnessBlock={name:string;kind:'calisthenics'|'strength'|'functional'|'walk';minutes:number;intensity:'light'|'moderate'|'vigorous'};
function ActivityBlocks(){
 const [blocks,setBlocks]=useState<FitnessBlock[]>([{name:'Dominadas y flexiones',kind:'calisthenics',minutes:15,intensity:'moderate'}]);
 const [weight,setWeight]=useState(70),[saved,setSaved]=useState(''),[working,setWorking]=useState(false);
 const met:Record<string,number>={calisthenics:3.8,strength:3.5,functional:5,walk:3.5};
 const total=blocks.reduce((n,b)=>n+Math.round((met[b.kind]*(b.intensity==='light'?.75:b.intensity==='vigorous'?1.5:1)-1)*3.5*weight/200*b.minutes),0);
 const save=async()=>{setWorking(true);try{const result=await api<{activeKcal:number}>('POST','/api/activity/blocks',{weightKg:weight,blocks});setSaved('Se guardaron '+result.activeKcal+' kcal activas aproximadas. Revisá Nutrición para ver el balance.');}catch{setSaved('No se pudieron guardar los bloques.');}finally{setWorking(false);}};
 return <section className="card"><div className="eyebrow">SESIÓN PERSONALIZADA</div><h2>Armá tu entrenamiento por bloques</h2>
   <p className="muted">Podés correr y después agregar dominadas, flexiones, caminata o fuerza. Estimación orientativa con MET y tiempo efectivo, excluyendo el gasto en reposo.</p>
   <label>Peso corporal (kg)</label><input type="number" min={30} max={250} value={weight} onChange={e=>setWeight(Number(e.target.value)||70)}/>
   {blocks.map((b,i)=><div className="fitness-block" key={i}>
     <label>Nombre del bloque<input value={b.name} maxLength={100} onChange={e=>setBlocks(v=>v.map((x,j)=>i===j?{...x,name:e.target.value}:x))}/></label>
     <div className="fitness-block-grid"><label>Actividad<select value={b.kind} onChange={e=>setBlocks(v=>v.map((x,j)=>i===j?{...x,kind:e.target.value as FitnessBlock['kind']}:x))}><option value="calisthenics">Calistenia</option><option value="strength">Fuerza</option><option value="functional">Funcional</option><option value="walk">Caminata</option></select></label>
       <label>Minutos<input type="number" min={1} max={240} value={b.minutes} onChange={e=>setBlocks(v=>v.map((x,j)=>i===j?{...x,minutes:Number(e.target.value)}:x))}/></label>
       <label>Intensidad<select value={b.intensity} onChange={e=>setBlocks(v=>v.map((x,j)=>i===j?{...x,intensity:e.target.value as FitnessBlock['intensity']}:x))}><option value="light">Suave</option><option value="moderate">Moderada</option><option value="vigorous">Alta</option></select></label>
     </div><button type="button" disabled={blocks.length<=1} onClick={()=>setBlocks(v=>v.filter((_,j)=>i!==j))}>Quitar bloque</button>
   </div>)}
   <button type="button" disabled={blocks.length>=12} onClick={()=>setBlocks(v=>[...v,{name:'Nuevo bloque',kind:'calisthenics',minutes:15,intensity:'moderate'}])}>+ Agregar bloque</button>
   <p className="live-kcal">≈{total} kcal activas estimadas en estos bloques</p>
   <button className="primary action-full" disabled={working||!blocks.every(b=>b.name.trim()&&b.minutes>=1&&b.minutes<=240)} onClick={()=>void save()}>{working?'Guardando…':'Guardar bloques y sumar al día'}</button>
   {saved&&<p role="status">{saved}</p>}
 </section>;
}

function Running() {
  const t = useT();
  const [d, setD] = useState<any>(null);
  const [f, setF] = useState({ km: '', minutes: '', speed: '', weightKg: '70', rpe: '5' });
  const [manualResult,setManualResult]=useState<{km:number;speed:number;kcal:number;pace:number;zone:string}|null>(null);
  const speed=Number(f.speed),km=Number(f.km);
  const derivedMinutes=km>0&&speed>0?km/speed*60:0;
  const paceFromSpeed=speed>0?60/speed:0;
  const paceZone=speed>=12?'Ritmo rápido':speed>=9?'Ritmo moderado':'Ritmo suave';
  const load = () => api('GET', '/api/runs').then(setD).catch(() => {});
  useEffect(() => { load(); }, []);
  const fmt = (p: number) => `${Math.floor(p)}:${String(Math.round((p % 1) * 60)).padStart(2, '0')}`;
  return (
    <>
      <MusicCenter />
      <ActivityBlocks />
      <GpsRun onDraft={(km,minutes,weightKg)=>setF(prev=>({...prev,km:String(km),weightKg:String(weightKg),speed:minutes>0?String(Number((km/minutes*60).toFixed(2))):''}))}/>
      <form className="card" onSubmit={async (e) => { e.preventDefault(); const minutes=derivedMinutes; if(!(km>0&&speed>0&&minutes>0))return; try{await api('POST', '/api/runs', { km, minutes, rpe: +f.rpe,weightKg:+f.weightKg });setManualResult({km,speed,kcal:Math.round(km*Math.max(30,Math.min(250,Number(f.weightKg)||70))),pace:paceFromSpeed,zone:paceZone});setF(v=>({...v,km:'',minutes:'',speed:''}));load();}catch{setManualResult(null);} }}>
        <h2>{t('running')}</h2>
        <p className="muted">Registro manual: ingresá kilómetros y velocidad promedio. El tiempo, ritmo y calorías se calculan aproximadamente.</p>
        <div className="manual-run-fields">
          <label>Distancia (km)<input required type="number" step="0.01" min="0.1" max="250" value={f.km} onChange={e=>setF({...f,km:e.target.value})}/></label>
          <label>Velocidad promedio (km/h)<input required type="number" step="0.1" min="1" max="30" value={f.speed} onChange={e=>setF({...f,speed:e.target.value})}/></label>
          <label>Peso para estimar calorías (kg)<input required type="number" min="30" max="250" value={f.weightKg} onChange={e=>setF({...f,weightKg:e.target.value})}/></label>
          <label>Esfuerzo percibido (1–10)<input required type="number" min="1" max="10" value={f.rpe} onChange={e=>setF({...f,rpe:e.target.value})}/></label>
        </div>
        {derivedMinutes>0&&<div className="manual-preview"><strong>{Math.round(derivedMinutes)} min · {fmt(paceFromSpeed)} min/km · ≈{Math.round(km*(Number(f.weightKg)||70))} kcal</strong>
          <p>{paceZone} (banda de velocidad, no zona de frecuencia cardíaca). Sin pulso medido no podemos determinar zonas fisiológicas.</p></div>}
        <p><button className="primary">{t('logRun')}</button></p></form>
      <DailyEnergyCalendar />
      {manualResult&&<div className="card"><h3>Resumen del registro manual</h3><p>{manualResult.km} km · {manualResult.speed} km/h · {fmt(manualResult.pace)} min/km · ≈{manualResult.kcal} kcal</p><p className="muted">{manualResult.zone}. No son zonas cardíacas. Estimación energética aproximada por distancia y peso; no es una medición metabólica.</p></div>}
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
  const [g,setG] = useState<{xp:number;level:number;streakWeeks:number;achievements:string[];challenges?:{id:string;title:string;progress:number;target:number}[];rewards?:{title:string;unlockedFrames:number}}|null>(null);
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
    {g&&<div className="card game-progress"><div className="eyebrow">TU AVENTURA FITNESS</div><h3>Nivel {g.level} · {g.xp} XP</h3>
      <p className="muted">{g.rewards?.title??'Aprendiz del movimiento'} · {g.streakWeeks} semanas activas consecutivas</p>
      <div className="game-xp-track" role="progressbar" aria-label="Progreso del nivel" aria-valuenow={Math.min(100,Math.round(g.xp/Math.max(1,g.level*g.level*50)*100))} aria-valuemin={0} aria-valuemax={100}><span style={{width:`${Math.min(100,Math.round(g.xp/Math.max(1,g.level*g.level*50)*100))}%`}}/></div>
      <h4>Desafíos</h4>{g.challenges?.map(c=><div className="challenge" key={c.id}><span>{c.title}</span><strong>{c.progress}/{c.target}</strong></div>)}
      <h4>Logros desbloqueados</h4><div className="chips">{g.achievements.map(x=><span className="badge ok" key={x}>{({'first_session':'Primera sesión','five_sessions':'5 sesiones','ten_sessions':'10 sesiones','twentyfive_sessions':'25 sesiones','fifty_sessions':'50 sesiones','first_run':'Primera carrera','five_runs':'5 carreras','ten_runs':'10 carreras','streak_4_weeks':'4 semanas constantes','streak_8_weeks':'8 semanas constantes','recovery_logged':'Cuidás tu recuperación','consistent_week':'Semana constante','balanced_week':'Fuerza y cardio'} as Record<string,string>)[x]??t('ach_'+x)}</span>)}</div>
      <p className="muted">Las recompensas reconocen constancia, no entrenar más de lo recomendado. El descanso también cuenta.</p>
    </div>}
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
function LearningTips({topic}:{topic:'nutrition'|'training'}) {
  const topics=topic==='nutrition'?[
    ['Déficit y superávit','Un déficit significa consumir menos energía que la estimada para mantener el peso; un superávit, más. La estimación inicial se ajusta según la evolución real.'],
    ['Proteínas y objetivos','Las necesidades dependen de peso, actividad y contexto clínico. La cifra calculada es una referencia, no una obligación universal.'],
    ['Porciones estimadas','Aceites, salsas, tamaño de las porciones y cocción pueden modificar mucho las calorías. Confirmá los valores antes de guardarlos.']
  ]:[
    ['¿Qué significa RIR?','Repeticiones en reserva: cuántas repeticiones más creés que podrías completar con buena técnica. RIR 2 equivale aproximadamente a dos repeticiones restantes.'],
    ['Cómo progresar las cargas','Cuando completás todas las series en el extremo superior del rango con técnica y RIR adecuados, puede considerarse aumentar la carga gradualmente.'],
    ['Técnica antes que peso','Priorizar control, rango de movimiento tolerable y consistencia. Si aparece dolor inusual, detené el ejercicio y reevaluá.']
  ];
  return <div className="card learning-tips"><div className="eyebrow">FONDAL APRENDE</div><h3>Entendé lo que estás haciendo</h3>{topics.map(([title,body])=><details key={title}><summary>{title}</summary><p>{body}</p></details>)}<p className="muted">Material introductorio. No reemplaza orientación individual de un profesional.</p></div>;
}

function FoodLibrary({onUse}:{onUse:(name:string,portions:Portion[])=>void}) {
  const [index,setIndex]=useState(0);
  const [q,setQ]=useState('');
  const [skip,setSkip]=useState<string[]>([]);
  const [chosen,setChosen]=useState<Portion[]>(MENUS[0]!.ingredients.map(i=>({...i})));
  const [course,setCourse]=useState(0);
  const [xp,setXp]=useState(0);
  const [answer,setAnswer]=useState<number|null>(null);
  const matches=MENUS.filter(menu=>menu.title.toLowerCase().includes(q.toLowerCase()) && !menu.ingredients.some(i=>skip.includes(i.id)));
  const menu=matches[index % Math.max(matches.length,1)];
  useEffect(()=>{if(menu)setChosen(menu.ingredients.map(x=>({...x})));},[menu?.id]);
  const total=nutrition(chosen);
  return <section className="card meals-library">
    <div className="eyebrow">MENÚS INTERCAMBIABLES</div><h2>150 platos para combinar</h2>
    <p className="muted">Son combinaciones de ingredientes, no recetas culinarias completas. Cantidades y calorías son aproximadas y editables.</p>
    <label>Buscar un ingrediente o plato</label><input value={q} onChange={e=>{setQ(e.target.value);setIndex(0);}} placeholder="Pollo, carne, arroz, lentejas…"/>
    <label>Ingredientes a evitar (elegilos para excluir platos)</label>
    <div className="chips">{FOODS.filter(f=>f.group==='protein').map(f=><button type="button" className={'chip'+(skip.includes(f.id)?' on':'')} key={f.id} onClick={()=>{setSkip(v=>v.includes(f.id)?v.filter(x=>x!==f.id):[...v,f.id]);setIndex(0);}}>{f.name}</button>)}</div>
    {menu?<><div className="menu-title"><h3>{menu.title}</h3><p className="muted">{matches.length} opciones disponibles</p></div>
      {chosen.map((item,i)=><div className="meal-ingredient" key={i}>
        <select aria-label="Ingrediente" value={item.id} onChange={e=>setChosen(v=>v.map((it,j)=>i===j?{...it,id:e.target.value}:it))}>
          {FOODS.map(f=><option value={f.id} key={f.id}>{f.name}</option>)}
        </select>
        <label>Gramos<input type="number" min={0} max={2000} value={item.grams} onChange={e=>setChosen(v=>v.map((it,j)=>i===j?{...it,grams:Number(e.target.value)}:it))}/></label>
      </div>)}
      <div className="nutrition-total"><strong>{Math.round(total.kcal)} kcal</strong><span>Proteínas {Math.round(total.proteinG)} g · Carbos {Math.round(total.carbsG)} g · Grasas {Math.round(total.fatG)} g</span></div>
      <div className="row"><button onClick={()=>setChosen(v=>[...v,{id:'olive',grams:5}])}>Añadir ingrediente</button><button onClick={()=>setIndex(i=>i+1)}>Cambiar por otro plato ↻</button></div>
      <button className="primary action-full" onClick={()=>onUse(menu.title,chosen)}>Pasar al registro de hoy</button>
    </>:<p className="muted">No hay platos con esos filtros. Probá quitar un ingrediente excluido.</p>}
    <details className="learning-lesson" open><summary>Aprendé mientras comés · {xp} XP</summary>
      <h4>{THEORY[course]!.title}</h4><p>{THEORY[course]!.body}</p>
      <button disabled={answer===course} onClick={()=>{setXp(x=>x+10);setAnswer(course);}}>Entendido +10 XP</button>
      <button onClick={()=>{setCourse(i=>(i+1)%THEORY.length);setAnswer(null);}}>Próxima microlección</button>
      <p className="muted">XP local de práctica: todavía no se sincroniza con el perfil.</p>
    </details>
  </section>;
}

function VirtualMentorChoice({onCoach,onProfessional}:{onCoach:()=>void;onProfessional:()=>void}) {
  const [mode,setMode]=useState<'virtual'|'real'>(()=>{try{return localStorage.getItem('ff_mentor_mode')==='real'?'real':'virtual';}catch{return 'virtual';}});
  const choose=(next:'virtual'|'real')=>{setMode(next);try{localStorage.setItem('ff_mentor_mode',next);}catch{}};
  return <div className="card mentor-choice">
    <div className="eyebrow">TU ACOMPAÑAMIENTO</div><h2>¿Con quién vas a entrenar?</h2>
    <div className="mentor-options">
      <button className={mode==='real'?'selected':''} onClick={()=>choose('real')}><strong>Profesor real</strong><span>Usá el código que te dio tu entrenador, recibí sus rutinas y compartí tu progreso.</span></button>
      <button className={mode==='virtual'?'selected':''} onClick={()=>choose('virtual')}><strong>Tutor virtual</strong><span>Consultá a Fondal Coach, recibí explicaciones y mantené tu propio plan.</span></button>
    </div>
    <button className="primary action-full" onClick={mode==='real'?onProfessional:onCoach}>{mode==='real'?'Vincular profesor →':'Hablar con el tutor →'}</button>
    <p className="muted">El tutor requiere Gemini configurado. El modo elegido se guarda en este dispositivo; no cancela un vínculo profesional existente.</p>
  </div>;
}

function Nutrition() {
  const [d,setD]=useState<any>(null);
  const [p,setP]=useState({sex:'f',weightKg:70,heightCm:170,age:30,activity:1.375,goal:'general',adjustmentPct:0});
  const [m,setM]=useState({meal:'',kcal:'',proteinG:'',carbsG:'',fatG:'',waterMl:''});
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [estimateNote,setEstimateNote]=useState('');
  const [editTarget,setEditTarget]=useState(false);
  const [quick,setQuick]=useState('');
  const [portions,setPortions]=useState<Portion[]>([]);
  const load=()=>api('GET','/api/nutrition').then(setD).catch(()=>setError('No se pudo cargar la alimentación.'));
  useEffect(()=>{load();},[]);
  const calc=async()=>{setError('');try{await api('POST','/api/nutrition/target',p);setEditTarget(false);load();}catch{setError('No se pudo calcular el objetivo.');}};
  const estimate=async()=>{if(!m.meal.trim())return;setBusy(true);setError('');try{
    const r=await api<{kcal:number;proteinG:number;carbsG:number;fatG:number;explanation:string}>('POST','/api/nutrition/estimate',{description:m.meal});
    setM(v=>({...v,kcal:String(Math.round(r.kcal)),proteinG:String(Math.round(r.proteinG)),carbsG:String(Math.round(r.carbsG)),fatG:String(Math.round(r.fatG))}));
    setEstimateNote(r.explanation);
  }catch(e){const code=e instanceof ApiError?e.body?.error:'';
    setError(code==='ai_consent_required'?'Activá la memoria IA en Perfil para usar esta estimación.':code==='coach_unconfigured'?'La estimación IA necesita una clave Gemini configurada en el servidor.':'No se pudo estimar la comida. Podés ingresar los valores manualmente.');
  }finally{setBusy(false);}};
  const add=async(e:React.FormEvent)=>{e.preventDefault();setError('');try{await api('POST','/api/nutrition/log',{meal:m.meal,kcal:+m.kcal||0,proteinG:+m.proteinG||0,carbsG:+m.carbsG||0,fatG:+m.fatG||0,waterMl:+m.waterMl||0});setM({meal:'',kcal:'',proteinG:'',carbsG:'',fatG:'',waterMl:''});setEstimateNote('');load();}catch{setError('No se pudo guardar la comida.');}};
  const num=(k:'weightKg'|'heightCm'|'age')=><input type="number" value={p[k]} onChange={e=>setP({...p,[k]:Number(e.target.value)})}/>;
  const target=d?.target;
  return <section>
    <DailyEnergyCalendar />
    <div className="card"><h2>Tu objetivo de energía</h2>
      {target&&<><p className="metric"><strong>{target.kcal}</strong><span>kcal por día (estimadas)</span></p>
        <p>Consumidas: {Math.round(d.today.kcal)} kcal · Restantes: {Math.round(target.kcal-d.today.kcal)} kcal</p>
        <p>Proteínas: {Math.round(d.today.proteinG)} / {target.proteinG} g</p>
        <div className="bar"><i style={{width:`${Math.max(0,Math.min(100,d.today.kcal/target.kcal*100))}%`}}/></div>
        <details><summary>¿De dónde sale este número?</summary>
          <p>Metabolismo basal estimado: {target.bmr??'sin registro'} kcal. Gasto diario estimado: {target.tdee??'sin registro'} kcal.</p>
          <p>Ajuste elegido: {target.adjustmentPct??'sin registro'} %. El cálculo usa Mifflin-St Jeor y un factor de actividad. No mide tu gasto real.</p>
          <p>El valor debe revisarse según peso, entrenamiento, hambre, adherencia y condiciones clínicas. Un déficit mayor no siempre es mejor.</p>
          {target.floored&&<p className="warn">Se aplicó un piso conservador de energía.</p>}
        </details>
        <button onClick={()=>setEditTarget(v=>!v)}>{editTarget?'Cerrar edición':'Modificar objetivo'}</button>
      </>}
      {(!target||editTarget)&&<div className="target-editor">
        <p className="muted">Elegí un ajuste. Un déficit agresivo no es adecuado para todas las personas; consultá si tenés condiciones de salud relevantes.</p>
        <label>Sexo usado por la fórmula</label><select value={p.sex} onChange={e=>setP({...p,sex:e.target.value})}><option value="f">Femenino</option><option value="m">Masculino</option></select>
        <label>Peso (kg)</label>{num('weightKg')}<label>Altura (cm)</label>{num('heightCm')}<label>Edad</label>{num('age')}
        <label>Actividad habitual</label><select value={p.activity} onChange={e=>setP({...p,activity:Number(e.target.value)})}>{[[1.2,'Sedentaria'],[1.375,'Ligera'],[1.55,'Moderada'],[1.725,'Alta']].map(([v,label])=><option key={v} value={v}>{label}</option>)}</select>
        <label>Objetivo</label><select value={p.goal} onChange={e=>setP({...p,goal:e.target.value})}>{[['general','Mantenimiento'],['fat_loss','Reducir grasa'],['hypertrophy','Hipertrofia'],['strength','Fuerza'],['endurance','Resistencia'],['hybrid','Atleta híbrido']].map(([v,label])=><option key={v} value={v}>{label}</option>)}</select>
        <label>Balance energético</label><select value={p.adjustmentPct} onChange={e=>setP({...p,adjustmentPct:Number(e.target.value)})}>{[[-20,'Déficit alto (-20%)'],[-15,'Déficit moderado (-15%)'],[-10,'Déficit leve (-10%)'],[0,'Mantenimiento'],[5,'Superávit leve (+5%)'],[10,'Superávit moderado (+10%)']].map(([v,label])=><option key={v} value={v}>{label}</option>)}</select>
        <button className="primary action-full" onClick={()=>void calc()}>Calcular y explicar mi objetivo</button>
      </div>}
    </div>
    <FoodLibrary onUse={(name,items)=>{const result=nutrition(items);setM(v=>({...v,meal:name,kcal:String(Math.round(result.kcal)),proteinG:String(Math.round(result.proteinG)),carbsG:String(Math.round(result.carbsG)),fatG:String(Math.round(result.fatG))}));setEstimateNote('Valores aproximados del menú. Revisá la preparación y las cantidades antes de guardar.');setQuick('');setPortions(items);}}/>
    <form className="card" onSubmit={add}><h2>¿Qué comiste?</h2>
      <p className="muted">Escribí naturalmente qué y cuánto comiste. La IA estimará porciones; revisá los números antes de guardar.</p>
      <label>Registro rápido sin IA</label><input value={quick} placeholder="pollo 150 g, arroz 200 g, tomate 100 g" onChange={e=>setQuick(e.target.value)}/><button type="button" onClick={()=>{const items=parseSimpleFood(quick);if(!items.length){setError('No reconocí ingredientes. Probá pollo, carne, arroz, papa, huevo o verduras.');return;}setPortions(items);setM(v=>({...v,meal:quick}));const val=nutrition(items);setM(v=>({...v,meal:quick,kcal:String(Math.round(val.kcal)),proteinG:String(Math.round(val.proteinG)),carbsG:String(Math.round(val.carbsG)),fatG:String(Math.round(val.fatG))}));setEstimateNote('Cálculo estimado de alimentos reconocidos; revisá las cantidades y agregados no reconocidos.');setError('');}}>Calcular con alimentos básicos</button>
      {portions.length>0&&<p className="muted">Ingredientes reconocidos: {portions.map(x=>FOODS.find(f=>f.id===x.id)?.name+' '+x.grams+' g').join(' · ')}</p>}
      <textarea required rows={3} value={m.meal} onChange={e=>setM({...m,meal:e.target.value})} placeholder="Ej.: comí dos bifes medianos, arroz y una ensalada con aceite"/>
      <button type="button" disabled={busy||!m.meal.trim()} onClick={()=>void estimate()}>{busy?'Estimando…':'Estimar calorías con IA'}</button>
      {estimateNote&&<p className="muted">{estimateNote}</p>}
      <p className="muted">Valores editables: kcal, proteínas, carbohidratos, grasas y agua.</p>
      <div className="nutrition-fields">{(['kcal','proteinG','carbsG','fatG','waterMl'] as const).map(k=><label key={k}>{k==='kcal'?'Calorías':k==='proteinG'?'Proteínas (g)':k==='carbsG'?'Carbohidratos (g)':k==='fatG'?'Grasas (g)':'Agua (ml)'}<input type="number" min={0} value={m[k]} onChange={e=>setM({...m,[k]:e.target.value})}/></label>)}</div>
      <button className="primary action-full">Guardar comida</button>
    </form>
    {error&&<p role="alert" className="warn">{error}</p>}
    <LearningTips topic="nutrition"/>
  </section>;
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

type ProItem = {exerciseId:string;sets:number;repMin:number;repMax:number;rirTarget:number;load:number};
type ProDay = {name:string;items:ProItem[];run?:{minutes:number;intensity:'easy'|'moderate';note:string}};
const EXERCISE_IDS=['air_squat','goblet_squat','back_squat','romanian_deadlift','glute_bridge','bench_press','dumbbell_press','push_up','incline_push_up','dumbbell_row','band_row','pull_up','reverse_lunge','step_up_low','plank','dead_bug','farmer_carry','hip_flow','thoracic_rotation'];
function ProfessionalProgram({ athletes }: { athletes:{id:number;name:string}[] }) {
  const t=useT();
  const [code,setCode]=useState('');
  const [templates,setTemplates]=useState<{id:number;name:string;days:ProDay[]}[]>([]);
  const [exerciseCatalog,setExerciseCatalog]=useState<{id:string;name:string;level:number;skill:string|null}[]>([]);
  const [name,setName]=useState('Mi programa personalizado');
  const [aiInstruction,setAiInstruction]=useState('');
  const [aiWorking,setAiWorking]=useState(false);
  const [aiMessage,setAiMessage]=useState('');
  const generateDraft=async()=>{
    if(aiInstruction.trim().length<10)return;
    setAiWorking(true);setAiMessage('');
    try{
      const result=await api<{draft:{name:string;days:ProDay[]};disclaimer:string}>('POST','/api/pro/ai-plan-draft',{instruction:aiInstruction});
      setName(result.draft.name);setDays(result.draft.days);setAiMessage(result.disclaimer);
    }catch(e){
      const code=e instanceof ApiError?e.body?.error:'';
      setAiMessage(code==='coach_unconfigured'?'Gemini no está configurado en el servidor. Podés seguir creando la rutina manualmente.':'No se pudo generar el borrador. Probá con una instrucción más concreta.');
    }finally{setAiWorking(false);}
  };
  const [days,setDays]=useState<ProDay[]>([{name:'Día 1',items:[{exerciseId:'goblet_squat',sets:3,repMin:8,repMax:12,rirTarget:2,load:0}]}]);
  const [athleteId,setAthleteId]=useState(0);
  const [result,setResult]=useState('');
  const [feedback,setFeedback]=useState<{workouts:{date:string;items:{exerciseId:string;sets:{weight:number;reps:number}[]}[]}[];runs:{km:number;minutes:number;created_at:string}[]}|null>(null);
  const load=()=>api<{id:number;name:string;days:ProDay[]}[]>('GET','/api/pro/templates').then(setTemplates).catch(()=>{});
  useEffect(()=>{api<{code:string}>('GET','/api/pro/code').then(x=>setCode(x.code)).catch(()=>{});api<{id:string;name:string;level:number;skill:string|null}[]>('GET','/api/exercises').then(setExerciseCatalog).catch(()=>{});load();},[]);
  const editDay=(index:number,change:Partial<ProDay>)=>setDays(ds=>ds.map((d,i)=>i===index?{...d,...change}:d));
  const save=async()=>{setResult('');try{await api('POST','/api/pro/templates',{name,days});setResult('Rutina guardada. Ahora podés asignarla a un alumno.');load();}catch{setResult('Revisá los días y ejercicios antes de guardar.');}};
  const assign=async(templateId:number)=>{if(!athleteId)return;try{await api('POST',`/api/pro/templates/${templateId}/assign`,{athleteId});setResult('Rutina asignada. El alumno la verá en su inicio.');}catch{setResult('No se pudo asignar. Verificá que el alumno esté vinculado.');}};
  const getFeedback=async(id:number)=>{try{const data=await api<typeof feedback>('GET',`/api/pro/athletes/${id}/training-feedback`);setFeedback(data);}catch{setResult('No se pudo consultar el seguimiento.');}};
  return <section className="card pro-program">
    <h2>Mi estudio de entrenamiento</h2><p className="muted">Armá sesiones de fuerza y cardio independientemente. Una jornada puede tener ambos; no hay límite semanal de seis días en las rutinas del profesional.</p>
    <div className="ai-builder">
      <h3>Crear rutina hablando con la IA</h3>
      <p className="muted">Describí el objetivo, días disponibles, ejercicios, músculos y equipamiento. La IA prepara un borrador que podés revisar y modificar antes de guardarlo.</p>
      <VoiceDictation onTranscript={text=>setAiInstruction(prev=>(prev?prev+' ':'')+text)}/>
      <textarea rows={4} maxLength={1500} value={aiInstruction} onChange={e=>setAiInstruction(e.target.value)} placeholder="Ej.: armá 4 días de fuerza y 2 de running, prioridad glúteos y tren posterior, con un día de descanso. Explicá la progresión."/>
      <button className="primary action-full" disabled={aiWorking||aiInstruction.trim().length<10} onClick={()=>void generateDraft()}>{aiWorking?'Preparando borrador…':'Proponer rutina con IA'}</button>
      {aiMessage&&<p className="muted" role="status">{aiMessage}</p>}
      <p className="muted">Las calorías por sesión son estimaciones, no objetivos garantizados. No se guarda ni asigna nada sin tu confirmación.</p>
    </div>
    <div className="pro-code"><span>Código para alumnos</span><strong>{code||'Cargando…'}</strong>{code&&<button onClick={()=>navigator.clipboard?.writeText(code)}>Copiar</button>}</div>
    <label>Nombre del programa</label><input value={name} maxLength={100} onChange={e=>setName(e.target.value)}/>
    {days.map((day,i)=><div className="pro-day" key={i}>
      <div className="row"><h3>Jornada {i+1}</h3><button disabled={days.length<=1} onClick={()=>setDays(ds=>ds.filter((_,j)=>j!==i))}>Quitar</button></div>
      <label>Nombre</label><input value={day.name} onChange={e=>editDay(i,{name:e.target.value})}/>
      <h4>Fuerza (opcional si hacés cardio)</h4>
      {day.items.map((item,j)=><div className="pro-exercise" key={j}>
        <label>Ejercicio</label><select value={item.exerciseId} onChange={e=>editDay(i,{items:day.items.map((v,k)=>k===j?{...v,exerciseId:e.target.value}:v)})}>{(exerciseCatalog.length?exerciseCatalog:EXERCISE_IDS.map(id=>({id,name:t('ex_'+id),level:1,skill:null}))).map(ex=><option key={ex.id} value={ex.id}>{ex.name} · nivel {ex.level}</option>)}</select>
        <div className="pro-numbers">{([['sets','Series'],['repMin','Rep. mín'],['repMax','Rep. máx'],['rirTarget','RIR'],['load','kg iniciales']] as [keyof ProItem,string][]).map(([key,label])=><label key={key}>{label}<input type="number" min={0} value={item[key]} onChange={e=>editDay(i,{items:day.items.map((v,k)=>k===j?{...v,[key]:Number(e.target.value)}:v)})}/></label>)}</div>
        <button onClick={()=>editDay(i,{items:day.items.filter((_,k)=>k!==j)})}>Quitar ejercicio</button>
      </div>)}
      <button onClick={()=>editDay(i,{items:[...day.items,{exerciseId:'push_up',sets:3,repMin:8,repMax:12,rirTarget:2,load:0}]})}>+ Añadir ejercicio</button>
      <label className="check"><input type="checkbox" checked={!!day.run} onChange={e=>editDay(i,{run:e.target.checked?{minutes:30,intensity:'easy',note:'Ritmo conversacional'}:undefined})}/>Incluir carrera o cardio este día</label>
      {day.run&&<><label>Duración de carrera (minutos)</label><input type="number" min={5} max={240} value={day.run.minutes} onChange={e=>editDay(i,{run:{...day.run!,minutes:Number(e.target.value)}})}/>
      <label>Intensidad</label><select value={day.run.intensity} onChange={e=>editDay(i,{run:{...day.run!,intensity:e.target.value as 'easy'|'moderate'}})}><option value="easy">Suave</option><option value="moderate">Moderada</option></select>
      <label>Indicaciones</label><input value={day.run.note} maxLength={300} onChange={e=>editDay(i,{run:{...day.run!,note:e.target.value}})}/></>}
    </div>)}
    <div className="row"><button disabled={days.length>=14} onClick={()=>setDays(ds=>[...ds,{name:'Día '+(ds.length+1),items:[],run:{minutes:30,intensity:'easy',note:'Ritmo cómodo'}}])}>+ Añadir jornada</button><button className="primary" onClick={()=>void save()}>Guardar rutina</button></div>
    {result&&<p role="status" className="muted">{result}</p>}
    <h3>Asignar rutinas</h3>
    <label>Alumno vinculado</label><select value={athleteId} onChange={e=>setAthleteId(Number(e.target.value))}><option value={0}>Elegí un alumno</option>{athletes.map(a=><option key={a.id} value={a.id}>{a.name}</option>)}</select>
    {templates.map(template=><div className="template-entry" key={template.id}><strong>{template.name}</strong><small>{template.days.length} jornadas</small><button disabled={!athleteId} onClick={()=>void assign(template.id)}>Asignar a alumno</button></div>)}
    {athleteId>0&&<button className="action-full" onClick={()=>void getFeedback(athleteId)}>Ver evolución del alumno</button>}
    {feedback&&<div className="card"><h3>Seguimiento reciente</h3><p>{feedback.workouts.length} sesiones de fuerza · {feedback.runs.length} carreras registradas</p>
      {feedback.workouts.slice(0,8).map((w,i)=><details key={i}><summary>{w.date.slice(0,10)} · {w.items.length} ejercicios</summary>{w.items.map((it,j)=><p key={j}>{t('ex_'+it.exerciseId)}: {it.sets.map(set=>`${set.weight} kg × ${set.reps}`).join(' · ')}</p>)}</details>)}
      {feedback.runs.slice(0,5).map((v,i)=><p key={i}>{v.created_at.slice(0,10)} · {v.km} km · {v.minutes} min</p>)}
    </div>}
  </section>;
}

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
      <ProfessionalProgram athletes={list}/>
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
function Settings({ me, refresh, onLang, onLogout, onReassess }: { me: Me; refresh: () => void; onLang: (l: Lang) => void; onLogout: () => void; onReassess?: () => void }) {
  const t = useT();
  const { lang } = useContext(LangCtx);
  const [links, setLinks] = useState<any[]>([]);
  const [history,setHistory]=useState<{date:string;assessment:Partial<AssessmentValues>}[]>([]);
  const loadAssessments=()=>api<{date:string;assessment:Partial<AssessmentValues>}[]>('GET','/api/assessments').then(setHistory).catch(()=>{});
  useEffect(()=>{if(me.role==='athlete')loadAssessments();},[me.role]);
  const [joinCode,setJoinCode] = useState('');
  const [joinResult,setJoinResult] = useState('');
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
        <div className="card"><h3>Mi evaluación física</h3>
          <p className="muted">Repetí tu evaluación para actualizar objetivos y registrar cómo cambió tu condición física. Conservamos evaluaciones anteriores.</p>
          {history[0]&&<p>Última evaluación: {history[0].date.slice(0,10)} · {history[0].assessment.specificGoals?.join(', ')||'Objetivo general'}</p>}
          {history[0]&&<p className="muted">Revisión orientativa: cada {history[0].assessment.trainingContext?.preferredReassessmentWeeks??6} semanas, o cuando cambie tu condición.</p>}
          <button className="primary action-full" onClick={onReassess}>Rehacer mi evaluación</button>
          {history.length>1&&<details><summary>Historial de evaluaciones ({history.length})</summary>{history.map((h,i)=><p key={i}>{h.date.slice(0,10)} · {h.assessment.targetDescription||h.assessment.goal}</p>)}</details>}
        </div>

        <div className="card"><h3>{t('consentTitle')}</h3>
          {CONSENT_KEYS.filter((k) => k !== 'terms' && k !== 'health_data').map((k) => <label key={k} className="check"><input type="checkbox" checked={!!me.consents[k]} onChange={(e) => toggle(k, e.target.checked)} />{t('c_' + k)}</label>)}</div>
        <div className="card"><h3>Vincularme con mi entrenador</h3><p className="muted">Pedile el código a tu profesional. Al vincularte podrá asignarte una rutina y revisar los entrenamientos que registres.</p><label>Código de vinculación</label><input value={joinCode} onChange={e=>setJoinCode(e.target.value.trim().toUpperCase())} placeholder="Ingresá el código"/><button className="primary action-full" disabled={!me.consents.share_with_pro||!joinCode} onClick={async()=>{try{const r=await api<{professional:string}>('POST','/api/links/join-code',{code:joinCode});setJoinResult('Vinculado con '+r.professional);setJoinCode('');loadLinks();}catch{setJoinResult('No se pudo vincular. Revisá el código.');}}}>Unirme a mi entrenador</button>{!me.consents.share_with_pro&&<p className="warn">Activá el consentimiento para compartir con el profesional.</p>}{joinResult&&<p role="status">{joinResult}</p>}</div><div className="card"><h3>{t('invitations')}</h3>
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
