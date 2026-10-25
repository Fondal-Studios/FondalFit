import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { acceptPoint, simplifyRoute, trackStats, type GeoPoint, type Sport } from '@fondal/engine';
import { Loading, Chips, useLoad, useT } from '../ctx';
import { TrackMap,plausibleGap } from './TrackMap';

const KEY = 'ff_track';
type Status = 'idle' | 'waiting' | 'running' | 'paused';

const fmtTime = (s: number) => { const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60); return `${h ? h + ':' : ''}${String(m).padStart(h ? 2 : 1, '0')}:${String(s % 60).padStart(2, '0')}`; };
const fmtPace = (sec: number) => (sec > 0 && sec < 3600 ? `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}` : '–');

/** Live GPS tracking (foreground). Fixes are filtered for accuracy and plausibility; the engine computes distance and pace. */
export function Cardio() {
  const t = useT();
  const [sport, setSport] = useState<Sport>('run');
  const [status, setStatus] = useState<Status>('idle');
  const [points, setPoints] = useState<GeoPoint[]>([]);
  const [now, setNow] = useState(Date.now());
  const [startedAt, setStartedAt] = useState(0);
  const [msg, setMsg] = useState('');
  const [saved, setSaved] = useState<{ id: number;estimatedKcal:number|null } | null>(null);
  const [gapMeters,setGapMeters]=useState(0);
  const [gapCandidate,setGapCandidate]=useState<{meters:number;seconds:number}|null>(null);
  const [locked,setLocked]=useState(false);
  const [unlock,setUnlock]=useState(0);
  const profile=useLoad<{assessment:{profile:{weightKg:number}}|null}>('/api/assessment');
  const weightKg=profile.data?.assessment?.profile?.weightKg??null;
  const watch = useRef<number | null>(null);
  const wake = useRef<{ release: () => Promise<void> } | null>(null);
  const last = useRef<GeoPoint | undefined>(undefined);
  const hist = useLoad<{ activities: any[]; weekRunKm: number; alerts: string[] }>('/api/activities');
  const [unfinished, setUnfinished] = useState<{ sport: Sport; startedAt: number; points: GeoPoint[] } | null>(null);

  useEffect(() => { try { const s = localStorage.getItem(KEY); if (s) setUnfinished(JSON.parse(s)); } catch { /* ignore */ } }, []);
  useEffect(()=>{if(!locked)return;const prev=document.body.style.overflow;document.body.style.overflow='hidden';return()=>{document.body.style.overflow=prev;};},[locked]);
  useEffect(() => { if (status !== 'running') return; const id = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(id); }, [status]);
  useEffect(() => () => stopWatch(), []); // eslint-disable-line

  const persist = (pts: GeoPoint[], sp: Sport, st: number) => { try { localStorage.setItem(KEY, JSON.stringify({ sport: sp, startedAt: st, points: pts.slice(-4000) })); } catch { /* ignore */ } };
  const stopWatch = () => {
    if (watch.current !== null) { navigator.geolocation.clearWatch(watch.current); watch.current = null; }
    wake.current?.release().catch(() => {}); wake.current = null;
  };

  const begin = useCallback((sp: Sport, st: number, initial: GeoPoint[]) => {
    if (!('geolocation' in navigator)) { setMsg(t('gpsUnsupported')); return; }
    if (!window.isSecureContext) { setMsg(t('needHttps')); return; }
    setMsg(''); setSaved(null); setSport(sp); setStartedAt(st); setPoints(initial); last.current = initial[initial.length - 1];setGapCandidate(null);
    setStatus(initial.length ? 'running' : 'waiting');
    (navigator as any).wakeLock?.request('screen').then((w: any) => { wake.current = w; }).catch(() => {});
    watch.current = navigator.geolocation.watchPosition(
      (pos) => {
        const p: GeoPoint = { lat: pos.coords.latitude, lon: pos.coords.longitude, t: pos.timestamp, acc: pos.coords.accuracy, alt: pos.coords.altitude ?? undefined };
        setStatus((s) => (s === 'waiting' ? 'running' : s));
        if(!acceptPoint(last.current,p,sp))return;
        const prior=last.current;
        if(prior&&p.t-prior.t>30000){
          const missing=plausibleGap(prior,p,sp);
          if(missing.allowed)setGapCandidate({meters:missing.meters,seconds:missing.seconds});
        }
        last.current=p;setMsg('');
        setPoints(prev=>{const next=[...prev,p];persist(next,sp,st);return next;});
      },
      (e) => { setMsg(e.code === 1 ? t('gpsDenied') : t('gpsWait')); if (e.code === 1) { stopWatch(); setStatus('idle'); } },
      { enableHighAccuracy: true, maximumAge: 1000, timeout: 20000 },
    );
  }, [t]);

  const pause = () => { stopWatch(); setStatus('paused'); persist(points, sport, startedAt); };
  const resume = () => begin(sport, startedAt, points);
  const discard = () => { stopWatch();setLocked(false);setGapCandidate(null);setGapMeters(0); try { localStorage.removeItem(KEY); } catch { /* ignore */ } setPoints([]); setStatus('idle'); setUnfinished(null); };

  const s = trackStats(points);
  const totalDistance=s.distanceM+gapMeters;
  const elapsed = startedAt ? Math.round(((status === 'running' ? now : points[points.length - 1]?.t ?? now) - startedAt) / 1000) : 0;

  const finish = async () => {
    stopWatch();
    if (totalDistance < 50 || s.movingSec < 30) { setMsg(t('tooShort')); discard(); return; }
    try {
      const r = await api('POST', '/api/activities', { sport, startedAt: new Date(startedAt).toISOString(), durationSec: Math.max(elapsed, s.movingSec), movingSec: s.movingSec, distanceM: Math.round(totalDistance), avgPaceSecKm: totalDistance>0?Math.round(elapsed*1000/totalDistance):0, elevGainM: s.elevGainM, route: simplifyRoute(points),recoveredGapM:Math.round(gapMeters) });
      setSaved(r); setMsg(t('actSaved')); try { localStorage.removeItem(KEY); } catch { /* ignore */ }
      setStatus('idle'); setPoints([]);setGapMeters(0);setGapCandidate(null);setLocked(false); hist.reload();
    } catch { setMsg(t('netError')); setStatus('paused'); persist(points, sport, startedAt); }
  };

  const bike = sport === 'bike';
  const paceAvg=totalDistance>0?Math.round(elapsed*1000/totalDistance):0;
  const kcal=weightKg?Math.round((totalDistance/1000)*weightKg*(sport==='run'?1:sport==='walk'?.55:.6)):null;
  return (
    <>
      {unfinished && status === 'idle' && (
        <div className="card"><p>{t('unfinished')}</p>
          <div className="row"><button className="primary" onClick={() => { setUnfinished(null); begin(unfinished.sport, unfinished.startedAt, unfinished.points); }}>{t('resumeTrack')}</button><button className="danger" onClick={discard}>{t('discard')}</button></div></div>
      )}
      <div className="card">
        {status === 'idle' && <><Chips options={['run', 'bike', 'walk']} value={[sport]} onChange={(v) => setSport(v[0] as Sport)} />
          <p><button className="primary big" onClick={() => begin(sport, Date.now(), [])}>{t('startTrack')}</button></p><p className="muted">{t('gpsNote')}</p></>}
        {status !== 'idle' && <>
          <div className="metrics">
            <div><span>{t('time')}</span><b>{fmtTime(elapsed)}</b></div>
            <div><span>{t('distance')}</span><b>{(totalDistance / 1000).toFixed(2)} km</b></div>
            <div><span>{bike ? t('speedNow') : t('paceNow')}</span><b>{bike ? (s.currentPaceSecKm ? (3600 / s.currentPaceSecKm).toFixed(1) + ' km/h' : '–') : fmtPace(s.currentPaceSecKm)}</b></div>
            <div><span>{bike ? t('speedNow') + ' Ø' : t('paceAvg')}</span><b>{bike ? s.avgSpeedKmh + ' km/h' : fmtPace(paceAvg)}</b></div>
            <div><span>{t('elev')}</span><b>{s.elevGainM} m</b></div>
            <div><span>Calorías estimadas</span><b>{kcal===null?'Ingresá tu peso':`≈${kcal} kcal`}</b></div>
          </div>
          {status === 'waiting' && <p className="muted" role="status">{t('gpsWait')}</p>}
          <TrackMap points={points} />
          {gapCandidate&&<div className="card"><strong>Tramo sin GPS</strong><p>Pasaron {Math.round(gapCandidate.seconds/60)} min y hay al menos {(gapCandidate.meters/1000).toFixed(2)} km entre ubicaciones. El camino real es desconocido.</p><button onClick={()=>{setGapMeters(v=>v+gapCandidate.meters);setGapCandidate(null);}}>Sumar distancia recta mínima</button><button onClick={()=>setGapCandidate(null)}>No sumar</button></div>}
          <div className="row">
            {status === 'running' && <button onClick={()=>setLocked(true)}>Congelar pantalla</button>}
            {status === 'running' && <button onClick={pause}>{t('pauseTrack')}</button>}
            {status === 'paused' && <button className="primary" onClick={resume}>{t('resumeTrack')}</button>}
            <button className="primary" onClick={finish} disabled={status === 'waiting'}>{t('stopSave')}</button>
            <button className="danger" onClick={discard}>{t('discard')}</button>
          </div>
        </>}
        {msg && <p className="warn" role="status">{msg}</p>}
        {saved && <p className="ok">{t('actSaved')} · {saved.estimatedKcal===null?'Sin peso registrado para estimar calorías':`≈${saved.estimatedKcal} kcal`}. Aparecerá en Inicio.</p>}
      </div>
      <div className="card"><h3>{t('history')}</h3>
        {!hist.data ? <Loading err={hist.err} retry={hist.reload} /> : <>
          <p className="muted">{t('weekRun')}: <b>{hist.data.weekRunKm}</b></p>
          {hist.data.alerts.map((a) => <p key={a} className="warn" role="alert">{t('a_' + a)}</p>)}
          {!hist.data.activities.length && <p className="muted">{t('noActivities')}</p>}
          {hist.data.activities.map((a) => <p key={a.id} className="muted">{String(a.started_at).slice(0, 10)} · {t(a.sport)} · {(a.distance_m / 1000).toFixed(2)} km · {fmtTime(a.moving_sec)} · {a.sport === 'bike' ? (a.moving_sec ? ((a.distance_m / a.moving_sec) * 3.6).toFixed(1) + ' km/h' : '–') : fmtPace(a.avg_pace_sec_km) + ' /km'}</p>)}</>}
      </div>
      {locked&&<div className="cardio-lock" role="dialog" aria-modal="true" aria-label="Pantalla de carrera congelada">
       <h2>Corrida activa · pantalla bloqueada</h2>
       <div className="metrics"><div><span>Tiempo</span><b>{fmtTime(elapsed)}</b></div><div><span>Distancia</span><b>{(totalDistance/1000).toFixed(2)} km</b></div><div><span>Ritmo promedio</span><b>{fmtPace(paceAvg)} /km</b></div><div><span>Calorías</span><b>{kcal===null?'—':`≈${kcal}`}</b></div></div>
       <p>Deslizá el control hasta el extremo derecho para desbloquear. Otros toques no detienen la corrida.</p>
       <label htmlFor="cardio-unlock">Deslizar para desbloquear</label>
       <input id="cardio-unlock" type="range" min={0} max={100} value={unlock} onChange={e=>{const value=Number(e.target.value);if(value>=95){setLocked(false);setUnlock(0);}else setUnlock(value);}} onTouchEnd={()=>setUnlock(0)} onPointerUp={()=>setUnlock(0)}/>
       </div>}
    </>
  );
}

function Route({ points }: { points: GeoPoint[] }) {
  if (points.length < 2) return null;
  const lats = points.map((p) => p.lat), lons = points.map((p) => p.lon);
  const [minLa, maxLa, minLo, maxLo] = [Math.min(...lats), Math.max(...lats), Math.min(...lons), Math.max(...lons)];
  const k = Math.cos((((minLa + maxLa) / 2) * Math.PI) / 180);
  const w = Math.max((maxLo - minLo) * k, 1e-5), h = Math.max(maxLa - minLa, 1e-5), sc = 180 / Math.max(w, h);
  const pts = points.filter((_, i) => i % Math.ceil(points.length / 200) === 0).map((p) => `${((p.lon - minLo) * k * sc + 10).toFixed(1)},${((maxLa - p.lat) * sc + 10).toFixed(1)}`).join(' ');
  return <svg viewBox={`0 0 ${w * sc + 20} ${h * sc + 20}`} className="route" role="img" aria-label="route"><polyline points={pts} fill="none" stroke="var(--accent)" strokeWidth="3" strokeLinejoin="round" strokeLinecap="round" /></svg>;
}
