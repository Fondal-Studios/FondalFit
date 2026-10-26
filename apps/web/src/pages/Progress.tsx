import { useRef, useState } from 'react';
import { api } from '../api';
import { parseBodyComposition, parseGpx, parseWeightCsv, parseWeightMeasurement, simplifyRoute, trackStats } from '@fondal/engine';
import { BarChart, LineChart } from '../charts';
import { Chips, Loading, useApp, useLang, useLoad, useT } from '../ctx';
import { Page, useNav } from '../nav';

const fmtDay = (lang: string) => (x: number) => new Date(x).toLocaleDateString(lang, { day: 'numeric', month: 'short' });
const fmtPace = (sec: number) => (sec > 0 ? `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}` : '–');

export function ProgressHub() {
  const t = useT(), nav = useNav();
  const prog = useLoad<{ sessions: { date: string; volume: number }[]; total: number }>('/api/progress');
  const goals = useLoad<{ targets: unknown[] }>('/api/goals');
  const week = useLoad<{ week: string; metrics: { sessions: number; activeDays: number; activeMinutes: number } }>('/api/challenges');
  return (
    <Page title={t('progress')}>
      <div className="grid2">
        <button className="tile" onClick={() => nav.push('progress_lifts')}><b>🏋️</b><span>{t('pr_lifts')}</span></button>
        <button className="tile" onClick={() => nav.push('progress_run')}><b>🏃</b><span>{t('pr_run')}</span></button>
        <button className="tile" onClick={() => nav.push('progress_body')}><b>⚖️</b><span>{t('pr_body')}</span></button>
        <button className="tile" onClick={() => nav.push('devices')}><b>🔗</b><span>{t('pr_devices')}</span></button>
      </div>
      <div className="card"><h3>{t('thisWeek')}</h3>
        {week.data ? <div className="grid3"><div className="tile"><b>{week.data.metrics.sessions}</b><span>{t('sessionsDone')}</span></div><div className="tile"><b>{week.data.metrics.activeDays}</b><span>{t('activeDays')}</span></div><div className="tile"><b>{week.data.metrics.activeMinutes}</b><span>{t('activeMinutes')}</span></div></div> : <Loading err={week.err} retry={week.reload} />}
        <p className="muted small">{t('who150')}</p></div>
      <div className="card"><h3>{t('sessionsDone')}: {prog.data?.total ?? '–'}</h3>
        {prog.data && prog.data.sessions.length > 0 && <BarChart title={t('volumePerSession')} unit="kg" bars={prog.data.sessions.slice(-12).map((s) => ({ label: new Date(s.date).toLocaleDateString(undefined, { day: 'numeric', month: 'numeric' }), value: Math.round(s.volume) }))} />}
        {prog.data && !prog.data.sessions.length && <div className="empty"><div className="em">📈</div><p>{t('noData')}</p></div>}</div>
      {goals.data && goals.data.targets.length === 0 && <div className="card"><p className="muted">{t('noGoalsYet')}</p><button onClick={() => nav.push('wizard')}>{t('setGoals')}</button></div>}
    </Page>
  );
}

export function LiftProgress() {
  const t = useT(), lang = useLang(), nav = useNav();
  const list = useLoad<{ exercises: { id: string; sessions: number; bestE1rm: number; last: string }[] }>('/api/progress/exercises');
  const [sel, setSel] = useState<string | null>(null);
  const cur = sel ?? list.data?.exercises[0]?.id ?? null;
  const ser = useLoad<{ series: { date: string; e1rm: number; topWeight: number; volume: number }[] }>(`/api/progress/exercise/${cur ?? 'none'}`, [cur]);
  if (!list.data) return <Page title={t('pr_lifts')}><Loading err={list.err} retry={list.reload} /></Page>;
  if (!list.data.exercises.length) return <Page title={t('pr_lifts')}><div className="empty"><div className="em">🏋️</div><p>{t('noLiftsYet')}</p><button className="primary" onClick={() => nav.go('train')}>{t('nav_train')}</button></div></Page>;
  const s = (ser.data?.series ?? []).filter((x) => x.e1rm > 0 || x.topWeight > 0);
  return (
    <Page title={t('pr_lifts')}>
      <div className="chips" style={{ marginBottom: 8 }}>{list.data.exercises.slice(0, 12).map((e) => <button key={e.id} className={'chip' + (e.id === cur ? ' on' : '')} onClick={() => setSel(e.id)}>{t('ex_' + e.id)}</button>)}</div>
      {cur && <div className="card"><h3>{t('ex_' + cur)}</h3>
        {s.length ? <>
          <LineChart title={t('e1rm')} unit="kg" points={s.map((x) => ({ x: Date.parse(x.date), y: x.e1rm }))} fmtX={fmtDay(lang)} />
          <LineChart title={t('topWeight')} unit="kg" color="var(--info)" points={s.map((x) => ({ x: Date.parse(x.date), y: x.topWeight }))} fmtX={fmtDay(lang)} />
          <BarChart title={t('volumePerSession')} unit="kg" color="#a78bfa" bars={s.slice(-10).map((x) => ({ label: fmtDay(lang)(Date.parse(x.date)), value: x.volume }))} />
          <p className="muted small">{t('e1rmNote')}</p></> : <Loading err={ser.err} retry={ser.reload} />}
        <button className="link" onClick={() => nav.push('exercise', { id: cur })}>{t('howTo')} →</button></div>}
    </Page>
  );
}

export function RunProgress() {
  const t = useT(), lang = useLang();
  const r = useLoad<{ series: { week: string; runKm: number; runs: number; bikeKm: number; avgPaceSecKm: number }[]; longestRunKm: number; fastestPaceSecKm: number | null; totalRunKm: number }>('/api/progress/running');
  if (!r.data) return <Page title={t('pr_run')}><Loading err={r.err} retry={r.reload} /></Page>;
  const d = r.data;
  if (!d.series.length) return <Page title={t('pr_run')}><div className="empty"><div className="em">🏃</div><p>{t('noRunsYet')}</p></div></Page>;
  const paced = d.series.filter((s) => s.avgPaceSecKm > 0);
  return (
    <Page title={t('pr_run')}>
      <div className="grid3"><div className="tile"><b>{d.totalRunKm}</b><span>{t('totalKm')}</span></div><div className="tile"><b>{d.longestRunKm}</b><span>{t('longestRun')} (km)</span></div><div className="tile"><b>{d.fastestPaceSecKm ? fmtPace(d.fastestPaceSecKm) : '–'}</b><span>{t('bestPace')} (min/km)</span></div></div>
      <div className="card"><BarChart title={t('weeklyKm')} unit="km" bars={d.series.map((s) => ({ label: new Date(s.week).toLocaleDateString(lang, { day: 'numeric', month: 'numeric' }), value: s.runKm }))} />
        {paced.length > 1 && <LineChart title={t('avgPace')} unit="min/km" invertGood color="var(--info)" points={paced.map((s) => ({ x: Date.parse(s.week), y: Math.round((s.avgPaceSecKm / 60) * 100) / 100 }))} fmtX={fmtDay(lang)} fmtY={(v) => fmtPace(Math.round(v * 60))} />}
        {d.series.some((s) => s.bikeKm > 0) && <BarChart title={t('weeklyBikeKm')} unit="km" color="#f59e0b" bars={d.series.map((s) => ({ label: new Date(s.week).toLocaleDateString(lang, { day: 'numeric', month: 'numeric' }), value: s.bikeKm }))} />}
        <p className="muted small">{t('paceNote')}</p></div>
    </Page>
  );
}

const FIELDS = ['weightKg', 'bodyFatPct', 'waistCm', 'chestCm', 'hipCm', 'armCm', 'thighCm'] as const;
const UNIT: Record<string, string> = { weightKg: 'kg', bodyFatPct: '%', waistCm: 'cm', chestCm: 'cm', hipCm: 'cm', armCm: 'cm', thighCm: 'cm' };

export function BodyProgress() {
  const t = useT(), lang = useLang(), { toast } = useApp();
  const m = useLoad<{ entries: ({ id: number; day: string } & Record<string, number | string>)[]; latest: Record<string, number> }>('/api/measurements');
  const [metric, setMetric] = useState<string>('weightKg');
  const [vals, setVals] = useState<Record<string, string>>({});
  const [apply, setApply] = useState(true);
  if (!m.data) return <Page title={t('pr_body')}><Loading err={m.err} retry={m.reload} /></Page>;
  const pts = m.data.entries.filter((e) => typeof e[metric] === 'number').map((e) => ({ x: Date.parse(e.day), y: e[metric] as number }));
  const save = async () => {
    const body: Record<string, unknown> = { source: 'manual' };
    for (const k of FIELDS) if (vals[k]) body[k] = Number(vals[k]!.replace(',', '.'));
    if (Object.keys(body).length === 1) return;
    try { const r = await api('POST', '/api/measurements', { ...body, applyToProfile: apply && !!body.weightKg }); toast(r.targetUpdated ? t('savedTargetUpdated') : t('saved')); setVals({}); m.reload(); } catch { toast(t('invalid')); }
  };
  return (
    <Page title={t('pr_body')}>
      <div className="card"><Chips options={FIELDS.filter((f) => m.data!.entries.some((e) => typeof e[f] === 'number'))} value={[metric]} onChange={(v) => setMetric(v[0]!)} label={(f) => t('me_' + f)} />
        {pts.length ? <LineChart title={t('me_' + metric)} unit={UNIT[metric]!} points={pts} fmtX={fmtDay(lang)} invertGood={metric !== 'armCm' && metric !== 'chestCm' && metric !== 'thighCm'} /> : <div className="empty"><div className="em">⚖️</div><p>{t('noData')}</p></div>}
        <p className="muted small">{t('measureNote')}</p></div>
      <div className="card"><h3>{t('addMeasurement')}</h3>
        <div className="grid2">{FIELDS.map((f) => <label key={f}>{t('me_' + f)} ({UNIT[f]})<input inputMode="decimal" value={vals[f] ?? ''} placeholder={m.data!.latest[f] !== undefined ? String(m.data!.latest[f]) : ''} onChange={(e) => setVals({ ...vals, [f]: e.target.value })} /></label>)}</div>
        <label className="check"><input type="checkbox" checked={apply} onChange={(e) => setApply(e.target.checked)} />{t('updateTargets')}</label>
        <button className="primary" onClick={save}>{t('save')}</button></div>
      {m.data.entries.length > 0 && <div className="card"><h3>{t('history')}</h3><table className="simple"><thead><tr><th>{t('date')}</th>{FIELDS.slice(0, 3).map((f) => <th key={f}>{t('me_' + f)}</th>)}<th /></tr></thead><tbody>
        {[...m.data.entries].reverse().slice(0, 12).map((e) => <tr key={e.id}><td>{e.day}</td>{FIELDS.slice(0, 3).map((f) => <td key={f}>{typeof e[f] === 'number' ? e[f] : '–'}</td>)}<td><button aria-label={t('remove')} style={{ minHeight: 32, padding: '0 8px' }} onClick={async () => { await api('DELETE', `/api/measurements/${e.id}`); m.reload(); }}>✕</button></td></tr>)}</tbody></table></div>}
    </Page>
  );
}

/** Bluetooth scale (Web Bluetooth, Chrome/Android), CSV weight import and GPX activity import: all through the same API as manual entry. */
export function Devices() {
  const t = useT(), { toast } = useApp();
  const [status, setStatus] = useState('');
  const [reading, setReading] = useState<{ weightKg: number; bodyFatPct?: number } | null>(null);
  const csv = useRef<HTMLInputElement>(null), gpx = useRef<HTMLInputElement>(null);
  const bt = (navigator as unknown as { bluetooth?: { requestDevice: (o: unknown) => Promise<any> } }).bluetooth;

  const connect = async () => {
    setStatus(t('btSearching')); setReading(null);
    try {
      const dev = await bt!.requestDevice({ filters: [{ services: ['weight_scale'] }], optionalServices: ['body_composition'] });
      const gatt = await dev.gatt.connect();
      const svc = await gatt.getPrimaryService('weight_scale');
      const ch = await svc.getCharacteristic('weight_measurement');
      let weight: { weightKg: number } | null = null, fat: number | undefined;
      try { const bc = await (await gatt.getPrimaryService('body_composition')).getCharacteristic('body_composition_measurement'); await bc.startNotifications(); bc.addEventListener('characteristicvaluechanged', (e: any) => { const f = parseBodyComposition(e.target.value); if (f) { fat = f.bodyFatPct; setReading((r) => (r ? { ...r, bodyFatPct: f.bodyFatPct } : r)); } }); } catch { /* optional service */ }
      await ch.startNotifications();
      ch.addEventListener('characteristicvaluechanged', (e: any) => {
        const w = parseWeightMeasurement(e.target.value);
        if (w) { weight = w; setReading({ weightKg: w.weightKg, bodyFatPct: fat }); setStatus(t('btGot')); }
      });
      setStatus(t('btStepOn'));
      void weight;
    } catch (e) { setStatus((e as Error).name === 'NotFoundError' ? t('btCancelled') : t('btFailed')); }
  };
  const saveReading = async () => {
    if (!reading) return;
    await api('POST', '/api/measurements', { weightKg: reading.weightKg, ...(reading.bodyFatPct ? { bodyFatPct: reading.bodyFatPct } : {}), source: 'scale', applyToProfile: true });
    toast(t('savedTargetUpdated')); setReading(null);
  };
  const importCsv = async (f: File) => {
    const rows = parseWeightCsv(await f.text());
    if (!rows.length) { toast(t('importEmpty')); return; }
    const r = await api('POST', '/api/measurements/bulk', { rows: rows.slice(0, 400) });
    toast(`${t('imported')}: ${r.added} (${t('skipped')}: ${r.skipped})`);
  };
  const importGpx = async (f: File) => {
    const pts = parseGpx(await f.text());
    if (pts.length < 5) { toast(t('importEmpty')); return; }
    const s = trackStats(pts);
    if (s.distanceM < 100) { toast(t('importEmpty')); return; }
    const sport = s.avgSpeedKmh > 14 ? 'bike' : s.avgSpeedKmh > 7.5 ? 'run' : 'walk';
    const dur = Math.round((pts[pts.length - 1]!.t - pts[0]!.t) / 1000);
    await api('POST', '/api/activities', { sport, startedAt: new Date(pts[0]!.t).toISOString(), durationSec: dur, movingSec: s.movingSec, distanceM: s.distanceM, avgPaceSecKm: sport === 'bike' ? 0 : Math.round((dur * 1000) / s.distanceM), elevGainM: s.elevGainM, route: simplifyRoute(pts) });
    toast(`${t('imported')}: ${t(sport)} ${(s.distanceM / 1000).toFixed(1)} km`);
  };

  return (
    <Page title={t('pr_devices')}>
      <div className="card"><h3>⚖️ {t('btScale')}</h3><p className="muted">{t('btScaleHelp')}</p>
        {bt ? <button className="primary" onClick={connect}>{t('btConnect')}</button> : <p className="warn">{t('btUnsupported')}</p>}
        {status && <p role="status">{status}</p>}
        {reading && <div className="card"><p className="big">{reading.weightKg} kg{reading.bodyFatPct ? ` · ${reading.bodyFatPct}%` : ''}</p><button className="primary" onClick={saveReading}>{t('saveReading')}</button></div>}
        <p className="muted small">{t('btNote')}</p></div>
      <div className="card"><h3>📄 {t('csvWeights')}</h3><p className="muted">{t('csvHelp')}</p>
        <input ref={csv} type="file" accept=".csv,text/csv,text/plain" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void importCsv(f); e.target.value = ''; }} /><button onClick={() => csv.current?.click()}>{t('chooseFile')}</button></div>
      <div className="card"><h3>🗺️ {t('gpxImport')}</h3><p className="muted">{t('gpxHelp')}</p>
        <input ref={gpx} type="file" accept=".gpx,application/gpx+xml,text/xml" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void importGpx(f); e.target.value = ''; }} /><button onClick={() => gpx.current?.click()}>{t('chooseFile')}</button></div>
      <div className="card"><h3>🍎 Apple Health / Health Connect</h3><p className="muted">{t('healthBridgeNote')}</p></div>
    </Page>
  );
}
