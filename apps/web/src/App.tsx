import {GymStudio} from './pages/GymStudio';
import {Tutorial,useTutorialStatus} from './pages/Tutorial';
import { lazy, Suspense, useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, hasToken, setToken } from './api';
import { AppCtx, initialLang, LangCtx, LangPicker, useApp, useT, type Lang, type Me } from './ctx';
import { translate } from './i18n';
import { NavProvider, Page, type Screen, useNav } from './nav';
import { Consents, Recovery } from './pages/Legacy';
import { More } from './pages/More';
import { ProfessionalHub } from './pages/ProfessionalHub';
import { WeeklyRankings } from './pages/WeeklyRankings';
import { Directory, MyProfessionalProfile, MedicalPanel, AdminPanel } from './pages/Directory';

// Heavier screens load on demand: faster first paint on the free server and slow phones.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const L = (f: () => Promise<Record<string, unknown>>, k: string) => lazy(() => f().then((m) => ({ default: m[k] as React.ComponentType<any> })));
const Home = L(() => import('./pages/Home'), 'Home');
const Train = L(() => import('./pages/Train'), 'Train');
const Cardio = L(() => import('./pages/Cardio'), 'Cardio');
const Food = L(() => import('./pages/Food'), 'Food');
const Wizard = L(() => import('./pages/Wizard'), 'Wizard');
const Session = L(() => import('./pages/Session'), 'Session');
const Calendar = L(() => import('./pages/Calendar'), 'Calendar');
const DayDetail = L(() => import('./pages/Calendar'), 'DayDetail');
const AddFood = L(() => import('./pages/AddFood'), 'AddFood');
const ExerciseLibrary = L(() => import('./pages/Library'), 'ExerciseLibrary');
const ExerciseDetail = L(() => import('./pages/Library'), 'ExerciseDetail');
const RoutineLibrary = L(() => import('./pages/Library'), 'RoutineLibrary');
const RoutineDetail = L(() => import('./pages/Library'), 'RoutineDetail');
const ProgressHub = L(() => import('./pages/Progress'), 'ProgressHub');
const LiftProgress = L(() => import('./pages/Progress'), 'LiftProgress');
const RunProgress = L(() => import('./pages/Progress'), 'RunProgress');
const BodyProgress = L(() => import('./pages/Progress'), 'BodyProgress');
const Devices = L(() => import('./pages/Progress'), 'Devices');
const Challenges = L(() => import('./pages/Social'), 'Challenges');
const Coach = L(() => import('./pages/Coach'), 'Coach');
const CoachMemory = L(() => import('./pages/Coach'), 'CoachMemory');
const Science = L(() => import('./pages/Science'), 'Science');
const Settings = L(() => import('./pages/Settings'), 'Settings');
const Admin = L(() => import('./pages/Admin'), 'Admin');
const ProStudents = L(() => import('./pages/Pro'), 'ProStudents');
const ProStudent = L(() => import('./pages/Pro'), 'ProStudent');
const ProStudio = L(() => import('./pages/Pro'), 'ProStudio');
const StudioEditor = L(() => import('./pages/Pro'), 'StudioEditor');
const ProApprovals = L(() => import('./pages/Pro'), 'ProApprovals');

export function App() {
  const [lang, setLang] = useState<Lang>(initialLang);
  const [me, setMe] = useState<Me | null>(null);
  const [ready, setReady] = useState(!hasToken());
  const [toastMsg, setToastMsg] = useState('');
  const t = useCallback((k: string, vars?: Record<string, string | number>) => translate(lang, k, vars), [lang]);
  const ctx = useMemo(() => ({ lang, t }), [lang, t]);

  const toast = useCallback((m: string) => { setToastMsg(m); window.setTimeout(() => setToastMsg((x) => (x === m ? '' : x)), 3200); }, []);
  const changeLang = (l: Lang) => {
    setLang(l);
    try { localStorage.setItem('ff_lang', l); } catch { /* ignore */ }
    document.documentElement.lang = l;
    if (me) api('PATCH', '/api/me', { lang: l }).catch(() => {});
  };
  const refresh = useCallback(async () => {
    try { setMe(await api<Me>('GET', '/api/me')); } catch { setToken(null); setMe(null); }
    setReady(true);
  }, []);
  useEffect(() => { document.documentElement.lang = lang; if (hasToken()) refresh(); }, []); // eslint-disable-line

  if (!ready) return null;
  return (
    <LangCtx.Provider value={ctx}>
      <main>
        {me ? (
          <AppCtx.Provider value={{ me, refresh, onLang: changeLang, onLogout: () => { setToken(null); setMe(null); }, toast }}><Shell key={me.mode} /></AppCtx.Provider>
        ) : <Auth lang={lang} onLang={changeLang} onDone={refresh} />}
        {toastMsg && <div className="toast" role="status">{toastMsg}</div>}
        <p className="muted small">{t('disclaimer')}</p>
      </main>
    </LangCtx.Provider>
  );
}

function Auth({ lang, onLang, onDone }: { lang: Lang; onLang: (l: Lang) => void; onDone: () => void }) {
  const t = useT();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [f, setF] = useState({ email: '', password: '', name: '', role: 'athlete' });
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setErr(''); setBusy(true);
    try {
      const r = mode === 'login' ? await api('POST', '/api/auth/login', { email: f.email, password: f.password }) : await api('POST', '/api/auth/register', { ...f, lang });
      setToken(r.token); onDone();
    } catch { setErr(t('invalid')); } finally { setBusy(false); }
  };
  return (
    <form onSubmit={submit} className="card">
      <h1>{t('app')}</h1>
      <LangPicker lang={lang} onLang={onLang} />
      {mode === 'register' && <>
        <label htmlFor="name">{t('name')}</label><input id="name" required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
        <label htmlFor="role">{t('role')}</label>
        <select id="role" value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })}><option value="athlete">{t('athlete')}</option><option value="pro">{t('pro')}</option></select>
        <p className="muted small">{t('roleSwitchNote')}</p>
      </>}
      <label htmlFor="email">{t('email')}</label><input id="email" type="email" required autoComplete="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />
      <label htmlFor="pw">{t('password')}</label><input id="pw" type="password" minLength={8} required autoComplete={mode === 'login' ? 'current-password' : 'new-password'} value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} />
      {err && <p className="bad" role="alert">{err}</p>}
      <p className="row"><button className="primary" disabled={busy}>{busy ? t('loading') : mode === 'login' ? t('login') : t('register')}</button>
        <button type="button" onClick={() => setMode(mode === 'login' ? 'register' : 'login')}>{mode === 'login' ? t('register') : t('login')}</button></p>
      {mode === 'register' && <p className="muted">{t('trialNote')}</p>}
    </form>
  );
}

const ATHLETE_TABS = ['home', 'train', 'cardio', 'food', 'more'];
const PRO_TABS = ['students', 'studio', 'gyms', 'approvals', 'more'];
const MEDICAL_TABS = ['medical_panel', 'directory', 'settings'];
const ADMIN_TABS = ['admin', 'admin_panel', 'directory', 'settings'];
const NAV: Record<string, string> = { home: 'nav_home', train: 'nav_train', cardio: 'nav_cardio', food: 'nav_nutrition', more: 'nav_more', students: 'athletes', studio: 'studio', gyms: 'Gimnasios', approvals: 'approvals', medical_panel: 'navHealth', directory: 'navDirectory', settings: 'settings', admin: 'admin', admin_panel: 'navAdminPanel' };
const ICON: Record<string, string> = { home: '🏠', train: '🏋️', cardio: '📍', food: '🍽️', more: '☰', students: '👥', studio: '📝', gyms: '🏢', approvals: '✅', medical_panel: '🩺', directory: '🔎', settings: '⚙️', admin: '📊', admin_panel: '🛡️' };

function Shell() {
  const { me } = useApp();
  const tabs = me.mode === 'admin' ? ADMIN_TABS : me.mode === 'medical' ? MEDICAL_TABS : me.mode === 'pro' ? PRO_TABS : ATHLETE_TABS;
  return <NavProvider initialTab={tabs[0]!} render={(nav, stack) => <Frame tabs={tabs} tab={nav.tab} go={nav.go} stack={stack} />} />;
}

function Frame({ tabs, tab, go, stack }: { tabs: string[]; tab: string; go: (k: string) => void; stack: Screen[] }) {
  const t = useT();
  const nav = useNav();
  const { me, refresh } = useApp();
  const [professionalNotices,setProfessionalNotices]=useState<{code:string;category?:string;message:string}[]>([]);
  useEffect(()=>{
    if(!(me.canPro||me.mode==='medical'||me.mode==='admin'))return;
    let active=true;
    api<{notifications:{code:string;category?:string;message:string}[]}>('GET','/api/profiles/notifications').then(r=>{if(active)setProfessionalNotices(r.notifications);}).catch(()=>{});
    return()=>{active=false;};
  },[me.id,me.mode,me.canPro]);
  const tutorial=useTutorialStatus(me.id,me.mode);
  useEffect(()=>{const show=()=>tutorial.show();window.addEventListener('fondal:show-tutorial',show);return()=>window.removeEventListener('fondal:show-tutorial',show);},[tutorial.show]);
  const needsConsent = me.mode === 'athlete' && !(me.consents.terms && me.consents.health_data);
  const top = stack[stack.length - 1];
  const active = tabs.includes(tab) ? tab : tabs[0]!;
  const switchMode = async (m: 'athlete' | 'pro') => { if (m === me.mode) return; await api('POST', '/api/me/mode', { mode: m }); await refresh(); };
  const modes = me.availableModes ?? (['athlete', 'pro'] as const);
  return (
    <>
      <header className="top">
        <h1>{t('app')}</h1>
        <button className="tutorial-help-button" type="button" onClick={tutorial.show} aria-label="Ver tutorial de Fondal Fit">? Guía</button>
        {!me.canPro && me.mode === 'athlete' && <button className="linkbtn" onClick={() => nav.push('settings')}>🎓 {t('proModeShort')}</button>}
        {(me.canPro || me.mode === 'medical' || me.mode === 'admin') && <div className="modepill" role="group" aria-label={t('accountMode')}>{modes.map((m) => <button key={m} className={me.mode === m ? 'on' : ''} aria-pressed={me.mode === m} onClick={() => void switchMode(m as 'athlete' | 'pro')}>{t(m === 'pro' ? 'pro' : m === 'medical' ? 'navHealth' : m === 'admin' ? 'admin' : 'athlete')}</button>)}</div>}
      </header>
      {professionalNotices.length>0&&<section className="card" role="status" aria-label="Notificaciones profesionales"><h2>Notificaciones profesionales ({professionalNotices.length})</h2><ul>{professionalNotices.map((n,i)=><li key={n.code+'-'+(n.category??i)}>{n.message}</li>)}</ul><button type="button" onClick={()=>nav.push('profile')}>Completar mi perfil profesional</button><button type="button" onClick={()=>api<{notifications:typeof professionalNotices}>('GET','/api/profiles/notifications').then(r=>setProfessionalNotices(r.notifications)).catch(()=>{})}>Actualizar avisos</button></section>}
      {!needsConsent&&tutorial.open&&<Tutorial initial onClose={tutorial.hide}/>}
      {needsConsent ? <Consents me={me} refresh={refresh} /> : (
        <Suspense fallback={<div className="skeleton" role="status" aria-label={t('loading')} />}>
          {top ? <ScreenView s={top} /> : <TabView tab={active} />}
          <nav className="tabs" aria-label="main">{tabs.map((k) => <button key={k} className={!top && active === k ? 'on' : ''} aria-current={!top && active === k ? 'page' : undefined} onClick={() => go(k)}><span aria-hidden>{ICON[k]}</span>{k==='gyms'?'Gimnasios':t(NAV[k]!)}</button>)}</nav>
        </Suspense>
      )}
    </>
  );
}

function TabView({ tab }: { tab: string }): ReactNode {
  const { me } = useApp();
  switch (tab) {
    case 'home': return <Home />;
    case 'train': return <Train />;
    case 'cardio': return <Cardio />;
    case 'food': return <Food />;
    case 'students': return <ProStudents />;
    case 'studio': return <ProStudio />;
    case 'gyms': return <GymStudio/>;
    case 'approvals': return <ProApprovals />;
    case 'medical_panel': return <MedicalPanel me={me} />;
    case 'directory': return <Directory />;
    case 'admin_panel': return <AdminPanel />;
    case 'settings': return <Settings />;
    case 'admin': return <Admin />;
    default: return <More />;
  }
}

function ScreenView({ s }: { s: Screen }): ReactNode {
  const nav = useNav(), t = useT(), { me, refresh } = useApp();
  const p = (s.props ?? {}) as Record<string, any>;
  switch (s.name) {
    case 'wizard': return <Wizard onDone={() => nav.go('home')} onCancel={nav.back} />;
    case 'exercises': return <ExerciseLibrary />;
    case 'exercise': return <ExerciseDetail id={p.id} />;
    case 'routines': return <RoutineLibrary />;
    case 'routine': return <RoutineDetail id={p.id} />;
    case 'session': return <Session day={p.day} index={p.index ?? 99} free={!!p.free} name={p.name} />;
    case 'calendar': return <Calendar />;
    case 'dayDetail': return <DayDetail date={p.date} />;
    case 'addFood': return <AddFood date={p.date} />;
    case 'progress': return <ProgressHub />;
    case 'progress_lifts': return <LiftProgress />;
    case 'progress_run': return <RunProgress />;
    case 'progress_body': return <BodyProgress />;
    case 'devices': return <Devices />;
    case 'challenges': return <Challenges />;
    case 'coach': return <Coach />;
    case 'coach_memory': return <CoachMemory />;
    case 'science': return <Page title={t('science')}><Science /></Page>;
    case 'recovery': return <Recovery />;
    case 'rankings': return <Page title={t('ranking')}><WeeklyRankings /></Page>;
    case 'directory': return <Page title={t('navDirectory')}><Directory /></Page>;
    case 'profile': return <Page title={t('affiliate')}><MyProfessionalProfile me={me} category="medical" onSaved={refresh} /></Page>;
    case 'hub': return <Page title={t('athletes')}><ProfessionalHub /></Page>;
    case 'gyms': return <Page title="Gimnasios"><GymStudio athlete={me.mode==='athlete'}/></Page>;
    case 'settings': return <Settings />;
    case 'admin': return <Admin />;
    case 'student': return <ProStudent id={p.id} />;
    case 'studio_edit': return <StudioEditor id={p.id} />;
    default: return <Page title="?"><p className="muted">{t('noResults')}</p></Page>;
  }
}
