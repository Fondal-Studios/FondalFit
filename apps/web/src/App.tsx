import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { api, hasToken, setToken } from './api';
import { initialLang, LangCtx, LangPicker, LANGS, useT, type Lang, type Me } from './ctx';
import { translate } from './i18n';
import { Consents, ProApprovals, Progress, Recovery, Settings } from './pages/Legacy';
import { Home } from './pages/Home';
import { More } from './pages/More';
import {ProfessionalHub} from './pages/ProfessionalHub';
import {WeeklyRankings} from './pages/WeeklyRankings';
import {GymStudio} from './pages/GymStudio';
import {Directory,MyProfessionalProfile,MedicalPanel,AdminPanel} from './pages/Directory';

// Heavier screens load on demand: faster first paint on the free server and slow phones.
const Wizard = lazy(() => import('./pages/Wizard').then((m) => ({ default: m.Wizard })));
const Train = lazy(() => import('./pages/Train').then((m) => ({ default: m.Train })));
const Cardio = lazy(() => import('./pages/Cardio').then((m) => ({ default: m.Cardio })));
const Food = lazy(() => import('./pages/Food').then((m) => ({ default: m.Food })));
const Coach = lazy(() => import('./pages/Coach').then((m) => ({ default: m.Coach })));
const Science = lazy(() => import('./pages/Science').then((m) => ({ default: m.Science })));

export function App() {
  const [lang, setLang] = useState<Lang>(initialLang);
  const [me, setMe] = useState<Me | null>(null);
  const [ready, setReady] = useState(!hasToken());
  const t = useCallback((k: string, vars?: Record<string, string | number>) => translate(lang, k, vars), [lang]);
  const ctx = useMemo(() => ({ lang, t }), [lang, t]);

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
        {me ? <Shell key={me.mode} me={me} refresh={refresh} onLang={changeLang} onLogout={() => { setToken(null); setMe(null); }} /> : <Auth lang={lang} onLang={changeLang} onDone={refresh} />}
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
const MORE_TABS = ['coach', 'science', 'recovery', 'progress', 'rankings', 'directory', 'gyms', 'profile', 'settings'];
const PRO_TABS = ['athletes', 'gyms', 'approvals', 'directory', 'settings'];
const MEDICAL_TABS=['medical_panel','directory','settings'];
const ADMIN_TABS=['admin_panel','directory','settings'];
const NAV: Record<string, string> = { home: 'nav_home', train: 'nav_train', cardio: 'nav_cardio', food: 'nav_nutrition', more: 'nav_more', athletes: 'athletes', approvals: 'approvals', settings: 'settings', rankings:'rankings',gyms:'Gimnasios',directory:'Profesionales',profile:'Afiliarme',medical_panel:'Salud',admin_panel:'Administración' };
const ICON: Record<string, string> = { home: '🏠', train: '🏋️', cardio: '📍', food: '🍽️', more: '☰', athletes: '👥', approvals: '✅', settings: '⚙️',rankings:'🏆',gyms:'🏢',directory:'🔎',profile:'🩺',medical_panel:'🩺',admin_panel:'🛡️' };

function Shell({ me, refresh, onLang, onLogout }: { me: Me; refresh: () => void; onLang: (l: Lang) => void; onLogout: () => void }) {
  const t = useT();
  const isPro = me.mode === 'pro';
  const isMedical=me.mode==='medical';
  const isAdminMode=me.mode==='admin';
  const [switching,setSwitching]=useState(false);
  const [modeError,setModeError]=useState('');
  const switchMode=async(next:'athlete'|'pro'|'medical'|'admin')=>{
    if(switching||me.mode===next)return;
    setSwitching(true);setModeError('');
    try{
      if(next==='pro'&&!me.canPro)await api('POST','/api/me/pro');
      await api('POST','/api/me/mode',{mode:next});
      await refresh();
    }catch{setModeError('No se pudo cambiar de interfaz. Revisá si tu perfil está habilitado.');}
    finally{setSwitching(false);}
  };
  const tabs=isAdminMode?ADMIN_TABS:isMedical?MEDICAL_TABS:isPro?PRO_TABS:ATHLETE_TABS;
  const [tab, setTab] = useState(tabs[0]!);
  const needsConsent = me.mode==='athlete' && !(me.consents.terms && me.consents.health_data);
  const go = (k: string) => { setTab(k); window.scrollTo({ top: 0 }); };
  const navActive = MORE_TABS.includes(tab) && me.mode==='athlete' ? 'more' : tab;
  const wizard = tab === 'wizard';
  return (
    <>
      <header className="top"><div><h1>{t('app')}</h1><small className="mode-label">{({athlete:'Deportista',pro:'Entrenador físico',medical:'Profesional de salud',admin:'Administrador'} as const)[me.mode]}</small></div><div className="mode-actions"><button onClick={()=>go('settings')}>Usuario / Ajustes</button><button onClick={onLogout}>{t('logout')}</button></div></header>
      {modeError&&<p className="warn" role="alert">{modeError}</p>}
      {needsConsent ? <Consents me={me} refresh={refresh} /> : (
        <Suspense fallback={<p className="muted" role="status">{t('loading')}</p>}>
          {wizard && <Wizard onDone={() => go('train')} onCancel={() => go('home')} />}
          {tab === 'home' && <Home me={me} go={go} />}
          {tab === 'train' && <Train onWizard={() => go('wizard')} onCardio={() => go('cardio')} />}
          {tab === 'cardio' && <Cardio />}
          {tab === 'food' && <Food onWizard={() => go('wizard')} />}
          {tab === 'more' && <More go={go} />}
          {tab === 'coach' && <><BackToMore go={go} /><Coach memory={!!me.consents.ai_memory} /></>}
          {tab === 'science' && <><BackToMore go={go} /><Science /></>}
          {tab === 'recovery' && <><BackToMore go={go} /><Recovery /></>}
          {tab === 'progress' && <><BackToMore go={go} /><Progress /></>}
          {tab === 'athletes' && <ProfessionalHub />}
          {tab === 'gyms' && <GymStudio athlete={me.mode==='athlete'}/>}
          {tab === 'directory' && <Directory />}
          {tab === 'profile' && <MyProfessionalProfile me={me} category="medical" onSaved={refresh}/>}
          {tab === 'medical_panel' && <MedicalPanel me={me}/>}
          {tab === 'admin_panel' && <AdminPanel/>}
          {tab === 'rankings' && <WeeklyRankings />}
          {tab === 'approvals' && <ProApprovals />}
          {tab === 'settings' && <><section className="card"><h2>Mi cuenta · Cambiar interfaz</h2><p className="muted">Elegí qué herramientas querés usar. El cambio no borra entrenamientos ni vínculos.</p><div className="mode-selector">{(['athlete','pro','medical','admin'] as const).map(m=><button key={m} className={me.mode===m?'on':''} disabled={switching||(m==='medical'&&!me.canMedical)||(m==='admin'&&!me.isAdmin)} onClick={()=>void switchMode(m)}>{({athlete:'Deportista',pro:'Entrenador físico',medical:'Profesional de salud',admin:'Administrador'} as const)[m]}{me.mode===m?' ✓':''}</button>)}</div>{!me.canMedical&&<p className="muted">Para habilitar Salud, completá tu perfil profesional y solicitá verificación.</p>}</section>{me.mode==='athlete'&&<MyProfessionalProfile me={me} category="medical" onSaved={refresh}/>}<Settings me={me} refresh={refresh} onLang={onLang} onLogout={onLogout} onWizard={() => go('wizard')} /></>}
          <nav className="tabs" aria-label="main">{tabs.map((k) => <button key={k} className={navActive === k ? 'on' : ''} aria-current={navActive === k ? 'page' : undefined} onClick={() => go(k)}><span aria-hidden>{ICON[k]}</span>{['directory','profile','medical_panel','admin_panel','gyms'].includes(k)?NAV[k]:k==='rankings'?'Ranking':t(NAV[k]!)}</button>)}</nav>
        </Suspense>
      )}
    </>
  );
}
const BackToMore = ({ go }: { go: (k: string) => void }) => { const t = useT(); return <button className="link" onClick={() => go('more')}>← {t('nav_more')}</button>; };
void LANGS;
