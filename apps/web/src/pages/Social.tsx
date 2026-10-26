import { useState } from 'react';
import { api, ApiError } from '../api';
import { Bar, Loading, useApp, useLoad, useT } from '../ctx';
import { Page } from '../nav';

export function Challenges() {
  const t = useT(), { toast } = useApp();
  const ch = useLoad<{ week: string; points: number; challenges: { id: string; target: number; value: number; pct: number; done: boolean; points: number }[] }>('/api/challenges');
  const rk = useLoad<{ enabled: boolean; alias?: string; zone?: string; week: string; zoneSize?: number; minZoneSize: number; leaderboard?: { rank: number; alias: string; points: number; me: boolean }[] | null; myRank?: number; myPoints?: number }>('/api/ranking');
  const [alias, setAlias] = useState(''), [zone, setZone] = useState('');
  const [busy, setBusy] = useState(false);

  const join = async () => {
    setBusy(true);
    try { await api('PUT', '/api/ranking', { enabled: true, alias, zone }); toast(t('rankingOn')); rk.reload(); }
    catch (e) { toast(e instanceof ApiError && e.status === 409 ? t('aliasTaken') : t('invalid')); } finally { setBusy(false); }
  };
  const leave = async () => { await api('PUT', '/api/ranking', { enabled: false }); toast(t('rankingOff')); rk.reload(); };

  return (
    <Page title={t('challenges')} sub={ch.data?.week}>
      {!ch.data ? <Loading err={ch.err} retry={ch.reload} /> : (
        <div className="card hero"><div className="row between"><h3>{t('weekChallenges')}</h3><b className="ok">{ch.data.points} {t('weekPoints')}</b></div>
          {ch.data.challenges.map((c) => <div key={c.id} style={{ margin: '10px 0' }}><div className="row between"><span>{c.done ? '✅ ' : ''}{t('ch_' + c.id)}</span><span>{c.value}/{c.target} · +{c.points}</span></div><Bar pct={c.pct} /></div>)}
          <p className="muted small">{t('pointsExplain')}</p></div>
      )}
      <div className="card"><h3>🏆 {t('zoneRanking')}</h3>
        {!rk.data ? <Loading err={rk.err} retry={rk.reload} /> : !rk.data.enabled ? (
          <>
            <p className="muted">{t('rankingIntro')}</p>
            <label>{t('alias')}<input value={alias} maxLength={20} placeholder="corredor_42" onChange={(e) => setAlias(e.target.value)} /></label>
            <label>{t('zone')}<input value={zone} maxLength={60} placeholder={t('zonePlaceholder')} onChange={(e) => setZone(e.target.value)} /></label>
            <p className="muted small">{t('rankingPrivacy')}</p>
            <button className="primary" disabled={busy || alias.length < 3 || zone.trim().length < 2} onClick={join}>{t('joinRanking')}</button>
          </>
        ) : (
          <>
            <p className="muted">{rk.data.zone} · {rk.data.zoneSize} {t('participants')} · <b>{rk.data.alias}</b></p>
            {!rk.data.leaderboard ? <div className="card alert"><p>{t('zoneTooSmall', { n: rk.data.minZoneSize })}</p></div> : (
              <table className="simple"><thead><tr><th>#</th><th>{t('alias')}</th><th>{t('points')}</th></tr></thead><tbody>
                {rk.data.leaderboard.map((r) => <tr key={r.rank} style={r.me ? { background: '#16261c', fontWeight: 700 } : undefined}><td>{r.rank}</td><td>{r.alias}{r.me ? ` (${t('you')})` : ''}</td><td>{r.points}</td></tr>)}</tbody></table>
            )}
            <p className="muted small">{t('rankingPrivacy')}</p>
            <button className="danger" onClick={leave}>{t('leaveRanking')}</button>
          </>
        )}
      </div>
    </Page>
  );
}
