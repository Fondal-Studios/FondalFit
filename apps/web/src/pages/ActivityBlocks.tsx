import {useEffect,useState} from 'react';
import {api} from '../api';
type Block={name:string;kind:'calisthenics'|'strength'|'functional'|'walk';minutes:number;intensity:'light'|'moderate'|'vigorous'};
export function CustomBlocks({onSaved}:{onSaved?:()=>void}){
 const [blocks,setBlocks]=useState<Block[]>([{name:'Dominadas y flexiones',kind:'calisthenics',minutes:15,intensity:'moderate'}]);
 const [status,setStatus]=useState(''),[busy,setBusy]=useState(false);
 const patch=(i:number,p:Partial<Block>)=>setBlocks(v=>v.map((b,j)=>i===j?{...b,...p}:b));
 const save=async()=>{setBusy(true);setStatus('');try{const data=await api('POST','/api/activity/blocks',{blocks}) as {activeKcal:number};setStatus('Actividad guardada · ≈'+data.activeKcal+' kcal activas estimadas');onSaved?.();}catch{setStatus('No se pudo registrar. Completá tu peso en Comida → Perfil.');}finally{setBusy(false);}};
 return <div className="card"><h3>Mi entrenamiento por bloques</h3><p className="muted">Sumá dominadas, flexiones u otras actividades después de correr. Las calorías dependen de duración, intensidad y peso, no solo de contar repeticiones.</p>
 {blocks.map((b,i)=><div className="activity-block" key={i}>
  <label>Bloque<input value={b.name} onChange={e=>patch(i,{name:e.target.value})}/></label>
  <div className="row"><label>Tipo<select value={b.kind} onChange={e=>patch(i,{kind:e.target.value as Block['kind']})}><option value="calisthenics">Calistenia</option><option value="strength">Fuerza</option><option value="functional">Funcional</option><option value="walk">Caminata</option></select></label>
   <label>Minutos<input type="number" min={1} max={240} value={b.minutes} onChange={e=>patch(i,{minutes:Number(e.target.value)})}/></label>
   <label>Intensidad<select value={b.intensity} onChange={e=>patch(i,{intensity:e.target.value as Block['intensity']})}><option value="light">Suave</option><option value="moderate">Moderada</option><option value="vigorous">Alta</option></select></label></div>
  <button disabled={blocks.length===1} onClick={()=>setBlocks(x=>x.filter((_,j)=>i!==j))}>Quitar</button>
 </div>)}
 <div className="row"><button disabled={blocks.length>=12} onClick={()=>setBlocks(x=>[...x,{name:'Nuevo bloque',kind:'strength',minutes:15,intensity:'moderate'}])}>+ Agregar bloque</button><button className="primary" disabled={busy||blocks.some(x=>!x.name.trim()||x.minutes<1||x.minutes>240)} onClick={()=>void save()}>{busy?'Guardando…':'Guardar actividad'}</button></div>{status&&<p role="status">{status}</p>}
 </div>;
}
type Day={date:string;intake:number;exerciseKcal:number;expense:number;balance:number|null;band:string;meals:{name:string;kcal:number}[];sessions:string[]};
const labels:Record<string,string>={red:'Superávit alto',orange:'Superávit leve',yellow:'Equilibrio estimado',green:'Déficit moderado estimado',blue:'Déficit alto (revisar)',violet:'Déficit muy alto (revisar)',unknown:'Faltan datos'};
export function EnergyCalendar(){
 const d=new Date();const [month,setMonth]=useState(d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0'));
 const [data,setData]=useState<{days:Day[];baselineKcal:number}|null>(null),[selected,setSelected]=useState(d.toLocaleDateString('sv-SE'));
 const [error,setError]=useState('');
 const fetchMonth=async()=>{try{const r=await api('GET','/api/energy/calendar?month='+month+'&timezoneOffset='+new Date().getTimezoneOffset()) as {days:Day[];baselineKcal:number};setData(r);setError('');}catch{setError('No se pudo cargar el calendario.');}};
 useEffect(()=>{void fetchMonth();},[month]);
 return <div className="card"><h3>Calendario de energía y actividad</h3><label>Mes<input type="month" value={month} onChange={e=>setMonth(e.target.value)}/></label><button onClick={()=>void fetchMonth()}>Mostrar calendario</button>{error&&<p role="alert">{error}</p>}
 {data&&<><div className="energy-dates">{data.days.map(day=><button key={day.date} className={'energy-date '+day.band} onClick={()=>setSelected(day.date)}>{day.date.slice(-2)}</button>)}</div><div className="energy-legend">{Object.entries(labels).filter(([key])=>key!=='unknown').map(([key,value])=><span key={key}><i className={key}/>{value}</span>)}</div>
 {data.days.filter(day=>day.date===selected).map(day=><section key={day.date}><h4>{day.date}</h4><p>{labels[day.band]} · Consumidas {Math.round(day.intake)} kcal · Actividad ≈{Math.round(day.exerciseKcal)} kcal · Gasto estimado ≈{day.expense} kcal · Balance {day.balance===null?'sin datos':day.balance+' kcal'}</p>{day.meals.map((m,i)=><p key={i}>{m.name} · {m.kcal} kcal</p>)}{day.sessions.map((a,i)=><p key={i}>{a}</p>)}</section>)}</>}
 <p className="muted">BMR: gasto basal en reposo. NEAT: movimiento cotidiano no deportivo. La referencia sedentaria y el ejercicio son estimaciones, el NEAT no se mide; los déficits intensos no son premios.</p>
 </div>;
}
