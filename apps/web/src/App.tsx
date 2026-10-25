import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
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
            {tab === 'today' && <><div className="hero card"><div className="eyebrow">TU PLAN PERSONAL</div><h2>Entrená con un propósito.</h2><p>Tu sesión se ajusta a la evaluación inicial y al progreso que registres.</p><div className="hero-note">Empezá por la sesión que corresponde a tu plan.</div></div><Training /></>}
            {tab === 'progress' && <Progress />}
            {tab === 'wellness' && (wellness === 'running' ? <Running /> : wellness === 'nutrition' ? <Nutrition /> : wellness === 'recovery' ? <Recovery /> : <div className="feature-grid">
              <button className="feature-card" onClick={() => setWellness('running')}><span className="feature-icon">↗</span><strong>{t('running')}</strong><small>Distancia, ritmos y registro de carreras</small><span>Ver actividad →</span></button>
              <button className="feature-card" onClick={() => setWellness('nutrition')}><span className="feature-icon">◉</span><strong>{t('nutrition')}</strong><small>Comidas, energía y proteínas diarias</small><span>Ver alimentación →</span></button>
              <button className="feature-card" onClick={() => setWellness('recovery')}><span className="feature-icon">☾</span><strong>{t('recovery')}</strong><small>Sueño, fatiga y disponibilidad</small><span>Ver recuperación →</span></button>
            </div>)}
            {tab === 'settings' && <Settings me={me} refresh={refresh} onLang={onLang} onLogout={onLogout} />}
          </>}
          <nav className="tabs" aria-label="Navegación principal">
            {(isPro ? [['today', 'Inicio', '⌂'], ['settings', 'Perfil', '◎']] : [['today', 'Hoy', '⌂'], ['progress', 'Progreso', '▥'], ['wellness', 'Bienestar', '♡'], ['settings', 'Perfil', '◎']]).map(([key, label, symbol]) => <button key={key} className={tab === key ? 'on' : ''} aria-current={tab === key ? 'page' : undefined} onClick={() => navigate(key)}><span className="nav-icon" aria-hidden="true">{symbol}</span><span>{label}</span></button>)}
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
interface PlanRes { version?: number; plan: { days: { name: string; items: Rx[] }[] } | null }

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
  const load = useCallback(() => api<PlanRes>('GET', '/api/plan').then(setRes).catch(() => setMsg(t('offline'))), [t]);
  useEffect(() => { load(); }, [load]);
  if (!res) return <p className="muted">{msg}</p>;
  if (!res.plan) return <Assessment onDone={load} />;
  if (session !== null) return <Session day={res.plan.days[session]!} index={session} onDone={(m) => { setMsg(m); setSession(null); load(); }} />;
  return (
    <>
      <p className="muted">{t('planVersion')} {res.version}</p>
      {msg && <p className="ok" role="status">{msg}</p>}
      {res.plan.days.map((d, i) => (
        <div className="card" key={i}>
          <div className="row"><h3>{d.name}</h3><button className="primary" onClick={() => setSession(i)}>{t('startSession')}</button></div>
          {d.items.map((it) => <p key={it.exerciseId}>{t('ex_' + it.exerciseId)} <span className="muted">· {it.sets}×{it.repMin}-{it.repMax} · {t('rir')} {it.rirTarget}{it.load ? ` · ${it.load} kg` : ''}</span></p>)}
        </div>
      ))}
    </>
  );
}

function Assessment({ onDone }: { onDone: () => void }) {
  const t = useT();
  const [a, setA] = useState({ goal: 'general', daysPerWeek: 3, experience: 'beginner', equipment: ['none'] as string[], restrictions: [] as string[], redFlags: { chestPain: false, dizziness: false, recentSurgery: false, pregnancy: false, medication: false } });
  const [referral, setReferral] = useState(false);
  return (
    <div className="card">
      <h2>{t('assessTitle')}</h2>
      <label>{t('goal')}</label><Chips options={['general', 'strength', 'hypertrophy', 'endurance', 'fat_loss', 'mobility']} value={[a.goal]} onChange={(v) => setA({ ...a, goal: v[0]! })} />
      <label htmlFor="days">{t('days')}</label><input id="days" type="number" min={1} max={6} value={a.daysPerWeek} onChange={(e) => setA({ ...a, daysPerWeek: Number(e.target.value) })} />
      <label>{t('experience')}</label><Chips options={['beginner', 'intermediate', 'advanced']} value={[a.experience]} onChange={(v) => setA({ ...a, experience: v[0]! })} />
      <label>{t('equipment')}</label><Chips multi options={['none', 'dumbbells', 'barbell', 'bands', 'bar']} value={a.equipment} onChange={(v) => setA({ ...a, equipment: v })} />
      <label>{t('restrictions')}</label><Chips multi options={['knee', 'shoulder', 'lower_back', 'hip', 'ankle', 'wrist', 'neck']} value={a.restrictions} onChange={(v) => setA({ ...a, restrictions: v })} />
      <h3>{t('redFlagsTitle')}</h3>
      {Object.keys(a.redFlags).map((k) => <label key={k} className="check"><input type="checkbox" checked={(a.redFlags as Record<string, boolean>)[k]} onChange={(e) => setA({ ...a, redFlags: { ...a.redFlags, [k]: e.target.checked } })} />{t('rf_' + k)}</label>)}
      {referral && <p className="warn" role="alert">{t('referral')}</p>}
      <button className="primary" onClick={async () => { const r = await api('POST', '/api/assessment', a); if (r.referral) setReferral(true); else onDone(); }}>{t('generate')}</button>
    </div>
  );
}

function Session({ day, index, onDone }: { day: { name: string; items: Rx[] }; index: number; onDone: (msg: string) => void }) {
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
      <h2>{day.name}</h2>
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

function Running() {
  const t = useT();
  const [d, setD] = useState<any>(null);
  const [f, setF] = useState({ km: '', minutes: '', rpe: '5' });
  const load = () => api('GET', '/api/runs').then(setD).catch(() => {});
  useEffect(() => { load(); }, []);
  const fmt = (p: number) => `${Math.floor(p)}:${String(Math.round((p % 1) * 60)).padStart(2, '0')}`;
  return (
    <>
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

function Progress() {
  const t = useT();
  const [d, setD] = useState<{ sessions: { date: string; volume: number; sets: number }[]; total: number } | null>(null);
  const [g, setG] = useState<{ xp: number; level: number; streakWeeks: number; achievements: string[] } | null>(null);
  useEffect(() => { api('GET', '/api/progress').then(setD).catch(() => {}); api('GET', '/api/gamification').then(setG).catch(() => {}); }, []);
  if (!d) return <div className="card"><h2>{t('progress')}</h2><p className="muted">Cargando tu evolución…</p></div>;
  const max = Math.max(1, ...d.sessions.map((s) => s.volume));
  return (
    <>
    {g && <div className="card"><h2>{t('level')} {g.level} · {g.xp} XP</h2><p>{t('streak')}: {g.streakWeeks}</p><div className="chips">{g.achievements.map((x) => <span key={x} className="badge ok">{t('ach_' + x)}</span>)}</div><p className="muted">{t('gamNote')}</p></div>}
    <div className="card"><h2>{t('progress')}</h2>
      {!d.total ? <p className="muted">{t('noData')}</p> : <><p className="metric"><strong>{d.total}</strong><span>{t('sessionsDone')}</span></p><p className="muted">Volumen por sesión (kg). Cada barra representa un entrenamiento.</p>
        {d.sessions.slice(-14).map((s, i) => <div key={i}><span className="muted">{s.date.slice(0, 10)} · {Math.round(s.volume)} kg</span><div className="bar"><i style={{ width: `${(s.volume / max) * 100}%` }} /></div></div>)}</>}
    </div>
    </>
  );
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
