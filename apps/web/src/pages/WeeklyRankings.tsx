import {useEffect,useState} from 'react';
import {api} from '../api';
type Metric='strength'|'run_distance'|'run_pace'|'sprint_100m'|'sessions';
const metrics:{id:Metric;name:string;unit:string}[]=[
 {id:'strength',name:'Carga máxima registrada',unit:'kg'},{id:'run_distance',name:'Distancia corrida semanal',unit:'km'},
 {id:'run_pace',name:'Velocidad de carrera',unit:'km/h'},{id:'sprint_100m',name:'Velocidad en 100 metros',unit:'km/h'},
 {id:'sessions',name:'Sesiones completadas',unit:'sesiones'}
];
export function WeeklyRankings(){
 const [metric,setMetric]=useState<Metric>('run_distance'),[data,setData]=useState<{weekStart:string;entries:{rank:number;name:string;value:number;self:boolean}[];note:string}|null>(null);
 const [error,setError]=useState('');
 useEffect(()=>{setError('');api<typeof data>('GET','/api/rankings/weekly?metric='+metric).then(setData).catch(()=>setError('No se pudo cargar el ranking.'));},[metric]);
 return <section className="card"><h2>Rankings deportivos semanales</h2><p className="muted">Comparaciones voluntarias. No se premia entrenar en exceso ni quemar más calorías. Los datos de GPS son estimados.</p>
  <label>Disciplina<select value={metric} onChange={e=>setMetric(e.target.value as Metric)}>{metrics.map(m=><option value={m.id} key={m.id}>{m.name}</option>)}</select></label>
  {data&&<><p className="muted">Semana del {data.weekStart}</p>{data.entries.length?data.entries.map(e=><div className={'ranking-entry '+(e.self?'self':'')} key={e.rank}><strong>#{e.rank} {e.name}{e.self?' (vos)':''}</strong><span>{e.value.toLocaleString('es-AR')} {metrics.find(m=>m.id===metric)?.unit}</span></div>):<p className="muted">Aún no hay participantes con registros válidos esta semana.</p>}<p className="muted">{data.note}</p></>}
  {error&&<p role="alert">{error}</p>}
  <p className="muted">Para participar activá «Aparecer en rankings» en Perfil. Tu nombre y resultado se mostrarán a otros participantes.</p>
 </section>;
}
