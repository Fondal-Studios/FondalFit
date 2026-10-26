import { useState } from 'react';
import { BarChart, LineChart } from '../charts';
import { Chips, Loading, useLang, useLoad, useT } from '../ctx';
import { Page } from '../nav';

interface Stats {
  generatedAt: string;
  users: { total: number; athletes: number; pros: number; newToday: number; new7d: number; new30d: number };
  activity: { dau: number; wau: number; mau: number; stickiness: number };
  retention: Record<'d1' | 'd7' | 'd30', { eligible: number; retained: number }>;
  usage30d: { workouts: number; gpsActivities: number; gpsKm: number; foodLogs: number; coachMessages: number; assessments: number };
  pro: { links: number; pending: number; templates: number };
  subscription: { trialActive: number; trialExpired: number; canceled: number };
  languages: { lang: string; c: number }[];
  consents: { aiMemory: number; shareWithPro: number };
  series: { day: string; signups: number; active: number }[];
}
interface UserRow { id: number; email: string; name: string; role: string; pro_enabled: number; mode: string | null; lang: string; created_at: string; last_seen_at: string | null; plan: string; trial_ends_at: string; canceled_at: string | null }

/** Founder telemetry: aggregates and the account list. Never shows anyone's health, food, location or training content. */
export function Admin() {
  const t = useT(), lang = useLang();
  const s = useLoad<Stats>('/api/admin/stats');
  const [tab, setTab] = useState(['overview']);
  const [q, setQ] = useState(''), [page, setPage] = useState(0);
  const users = useLoad<{ users: UserRow[]; total: number }>(`/api/admin/users?q=${encodeURIComponent(q)}&page=${page}`, [q, page]);
  if (!s.data) return <Page title={t('admin')}><Loading err={s.err} retry={s.reload} /></Page>;
  const d = s.data;
  const pct = (r: { eligible: number; retained: number }) => (r.eligible ? `${Math.round((r.retained / r.eligible) * 100)}%` : '–');
  const lbl = (day: string) => new Date(day + 'T12:00:00').toLocaleDateString(lang, { day: 'numeric', month: 'numeric' });
  return (
    <Page title={t('admin')} sub={`${t('privacyAdmin')}`}>
      <Chips options={['overview', 'users']} value={tab} onChange={setTab} label={(x) => t('adm_' + x)} />
      {tab[0] === 'overview' ? (
        <>
          <div className="grid3"><div className="tile"><b>{d.users.total}</b><span>{t('adm_total')}</span></div><div className="tile"><b>{d.activity.dau}</b><span>DAU</span></div><div className="tile"><b>{d.activity.mau}</b><span>MAU</span></div></div>
          <div className="grid3"><div className="tile"><b>{d.users.newToday}</b><span>{t('adm_newToday')}</span></div><div className="tile"><b>{d.users.new7d}</b><span>{t('adm_new7')}</span></div><div className="tile"><b>{d.activity.wau}</b><span>WAU</span></div></div>
          <div className="card"><BarChart title={t('adm_signups30')} unit={t('adm_accounts')} bars={d.series.map((x) => ({ label: lbl(x.day), value: x.signups }))} />
            <LineChart title={t('adm_active30')} unit={t('adm_users')} color="var(--info)" points={d.series.map((x, i) => ({ x: i, y: x.active }))} fmtX={(i) => lbl(d.series[Math.round(i)]!.day)} /></div>
          <div className="card"><h3>{t('adm_retention')}</h3><div className="grid3">{(['d1', 'd7', 'd30'] as const).map((k) => <div className="tile" key={k}><b>{pct(d.retention[k])}</b><span>{k.toUpperCase()} ({d.retention[k].retained}/{d.retention[k].eligible})</span></div>)}</div>
            <p className="muted small">{t('adm_stickiness')}: {d.activity.stickiness}%</p></div>
          <div className="card"><h3>{t('adm_usage')}</h3>
            <table className="simple"><tbody>
              <tr><td>{t('sessionsDone')}</td><td>{d.usage30d.workouts}</td></tr><tr><td>GPS</td><td>{d.usage30d.gpsActivities} · {d.usage30d.gpsKm} km</td></tr>
              <tr><td>{t('adm_foodLogs')}</td><td>{d.usage30d.foodLogs}</td></tr><tr><td>{t('coach')}</td><td>{d.usage30d.coachMessages}</td></tr><tr><td>{t('adm_assessments')}</td><td>{d.usage30d.assessments}</td></tr></tbody></table></div>
          <div className="card"><h3>{t('adm_accountsMix')}</h3>
            <table className="simple"><tbody>
              <tr><td>{t('athlete')}</td><td>{d.users.athletes}</td></tr><tr><td>{t('pro')}</td><td>{d.users.pros}</td></tr><tr><td>{t('adm_links')}</td><td>{d.pro.links} ({d.pro.pending} {t('pending')})</td></tr><tr><td>{t('adm_templates')}</td><td>{d.pro.templates}</td></tr>
              <tr><td>{t('adm_trialActive')}</td><td>{d.subscription.trialActive}</td></tr><tr><td>{t('adm_trialExpired')}</td><td>{d.subscription.trialExpired}</td></tr><tr><td>{t('canceled')}</td><td>{d.subscription.canceled}</td></tr>
              <tr><td>{t('language')}</td><td>{d.languages.map((l) => `${l.lang.toUpperCase()} ${l.c}`).join(' · ')}</td></tr>
              <tr><td>{t('adm_consents')}</td><td>{t('c_ai_memory')}: {d.consents.aiMemory} · {t('c_share_with_pro')}: {d.consents.shareWithPro}</td></tr></tbody></table></div>
          <p className="muted small">{new Date(d.generatedAt).toLocaleString()}</p>
        </>
      ) : (
        <div className="card">
          <input type="search" aria-label={t('search')} placeholder={t('adm_searchUsers')} value={q} onChange={(e) => { setQ(e.target.value); setPage(0); }} />
          {!users.data ? <Loading err={users.err} retry={users.reload} /> : <>
            <p className="muted small">{users.data.total} {t('results')}</p>
            <div style={{ overflowX: 'auto' }}><table className="simple"><thead><tr><th>{t('name')}</th><th>{t('email')}</th><th>{t('adm_mode')}</th><th>{t('adm_created')}</th><th>{t('adm_lastSeen')}</th></tr></thead><tbody>
              {users.data.users.map((u) => <tr key={u.id}><td>{u.name}</td><td>{u.email}</td><td>{u.role === 'pro' || u.pro_enabled ? `${t('pro')}${u.mode ? '·' + u.mode : ''}` : t('athlete')}</td><td>{u.created_at.slice(0, 10)}</td><td>{u.last_seen_at ? u.last_seen_at.slice(0, 10) : '–'}</td></tr>)}</tbody></table></div>
            <div className="row" style={{ marginTop: 8 }}><button disabled={page === 0} onClick={() => setPage(page - 1)}>‹</button><span style={{ textAlign: 'center' }}>{page + 1}</span><button disabled={(page + 1) * 25 >= users.data.total} onClick={() => setPage(page + 1)}>›</button></div></>}
        </div>
      )}
    </Page>
  );
}
