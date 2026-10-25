import {useEffect,useState} from 'react';
import {api} from '../api';
type Athlete={id:number;name:string;email:string;lastSession:string|null;sessions30:number;pendingApprovals:number;recovery:{score:number;alerts:string[]}|null};
type Template={id:number;name:string;goal:string;days:Day[]};
type Day={name:string;kind:'strength'|'cardio';items:{exerciseId:string;sets:number;repMin:number;repMax:number;rirTarget:number;load:number}[];cardio?:{modality:'run'|'bike';type:'zone2'|'intervals'|'tempo'|'long'|'walkrun';durationMin:number}};
type Feedback={workouts:{date:string;exercises:{exerciseId:string;best:{weight:number;reps:number}}[]}[];activities:{sport:string;distance_m:number;duration_sec:number;started_at:string}[];recovery:{score:number;at:string}[]};
const defaultDay=():Day=>({name:'Fuerza',kind:'strength',items:[{exerciseId:'push_up',sets:3,repMin:8,repMax:12,rirTarget:2,load:0}]});
export function ProfessionalHub(){
 const [athletes,setAthletes]=useState<Athlete[]>([]),[templates,setTemplates]=useState<Template[]>([]),[code,setCode]=useState('');
 const [selected,setSelected]=useState<number|null>(null),[feedback,setFeedback]=useState<Feedback|null>(null);
 const [name,setName]=useState('Rutina personalizada'),[goal,setGoal]=useState('general'),[days,setDays]=useState<Day[]>([defaultDay()]);
 const [exercises,setExercises]=useState<{id:string;name:string}[]>([]);
 const [status,setStatus]=useState(''),[email,setEmail]=useState(''),[busy,setBusy]=useState(false);
 const refresh=()=>{api<Athlete[]>('GET','/api/pro/athletes').then(setAthletes).catch(()=>setStatus('No se pudo cargar la lista de alumnos.'));
  api<Template[]>('GET','/api/pro/templates').then(setTemplates).catch(()=>{});
  api<{code:string}>('GET','/api/pro/code').then(x=>setCode(x.code)).catch(()=>{});
 };
 useEffect(()=>{refresh();api<{id:string;name:string}[]>('GET','/api/exercises').then(setExercises).catch(()=>{});},[]);
 useEffect(()=>{if(selected!==null)api<Feedback>('GET',`/api/pro/athletes/${selected}/training-feedback`).then(setFeedback).catch(()=>setFeedback(null));},[selected]);
 const patchDay=(i:number,p:Partial<Day>)=>setDays(v=>v.map((d,j)=>i===j?{...d,...p}:d));
 const save=async()=>{setBusy(true);try{await api('POST','/api/pro/templates',{name,goal,days});setStatus('Rutina guardada. Elegí un alumno para asignarla.');refresh();}catch{setStatus('Revisá la rutina: cada jornada debe tener ejercicios o cardio.');}finally{setBusy(false);}};
 const assign=async(id:number)=>{if(selected===null)return;try{await api('POST',`/api/pro/templates/${id}/assign`,{athleteId:selected});setStatus('Rutina asignada al alumno; se conservan las versiones anteriores.');}catch{setStatus('No se pudo asignar la rutina.');}};
 return <div className="professional-hub">
  <section className="card"><h2>Mi gimnasio · Panel profesional</h2><p className="muted">Vinculá alumnos, asigná programas y consultá sus registros desde un mismo lugar.</p>
   <div className="pro-kpis"><div><strong>{athletes.length}</strong><small>Alumnos</small></div><div><strong>{athletes.filter(a=>a.sessions30>0).length}</strong><small>Activos 30 días</small></div><div><strong>{athletes.filter(a=>a.pendingApprovals>0).length}</strong><small>Con pendientes</small></div></div>
   <p>Tu código de vinculación: <strong className="pro-enrollment-code">{code||'Cargando…'}</strong></p><button disabled={!code} onClick={()=>void navigator.clipboard?.writeText(code)}>Copiar código</button>
   <form onSubmit={async e=>{e.preventDefault();try{await api('POST','/api/pro/invites',{email});setStatus('Invitación enviada si la cuenta existe.');setEmail('');}catch{setStatus('No se pudo enviar.');}}}><label>Invitar por correo<input type="email" required value={email} onChange={e=>setEmail(e.target.value)} placeholder="alumno@correo.com"/></label><button className="primary">Invitar</button></form>
  </section>
  <section className="card"><h2>Seguimiento de alumnos</h2>
   {athletes.length===0?<p className="muted">Todavía no hay alumnos vinculados. Compartí tu código.</p>:athletes.map(a=><button className={'pro-athlete-row '+(selected===a.id?'selected':'')} key={a.id} onClick={()=>setSelected(a.id)}><strong>{a.name}</strong><span>{a.sessions30} sesiones / 30 días · {a.lastSession?'Última: '+a.lastSession.slice(0,10):'Sin sesiones'}</span>{a.pendingApprovals>0&&<span className="warn">{a.pendingApprovals} pendientes</span>}</button>)}
   {selected!==null&&<div className="pro-feedback"><h3>Evolución · {athletes.find(a=>a.id===selected)?.name}</h3>
    {feedback?<><p>Últimos {feedback.workouts.length} entrenamientos y {feedback.activities.length} actividades aeróbicas</p>
      {feedback.workouts.slice(0,8).map((w,i)=><details key={i}><summary>{w.date.slice(0,10)} · {w.exercises.length} ejercicios</summary>{w.exercises.map((e,j)=><p key={j}>{exercises.find(x=>x.id===e.exerciseId)?.name??e.exerciseId}: {e.best?.weight??0} kg × {e.best?.reps??0}</p>)}</details>)}
      {feedback.activities.slice(0,5).map((a,i)=><p key={i}>{a.started_at.slice(0,10)} · {a.sport} · {(a.distance_m/1000).toFixed(2)} km</p>)}
      {feedback.recovery[0]&&<p>Última recuperación: {feedback.recovery[0].score}/100</p>}
    </>:<p className="muted">Cargando seguimiento…</p>}</div>}
  </section>
  <section className="card"><h2>Diseñador de rutinas</h2><p className="muted">Creá fuerza y cardio por separado. Podés agregar hasta siete jornadas y asignar la rutina a cualquier alumno vinculado.</p>
   <label>Nombre del programa<input value={name} onChange={e=>setName(e.target.value)}/></label><label>Objetivo<select value={goal} onChange={e=>setGoal(e.target.value)}>{['general','strength','hypertrophy','endurance','fat_loss','recomposition','vo2max','mobility'].map(x=><option key={x} value={x}>{x}</option>)}</select></label>
   {days.map((day,i)=><div className="pro-plan-day" key={i}><div className="row"><strong>Jornada {i+1}</strong><button disabled={days.length===1} onClick={()=>setDays(v=>v.filter((_,j)=>i!==j))}>Quitar</button></div>
    <label>Nombre<input value={day.name} onChange={e=>patchDay(i,{name:e.target.value})}/></label>
    <label>Tipo<select value={day.kind} onChange={e=>patchDay(i,{kind:e.target.value as Day['kind'],items:e.target.value==='cardio'?[]:day.items.length?day.items:defaultDay().items,cardio:e.target.value==='cardio'?{modality:'run',type:'zone2',durationMin:30}:undefined})}><option value="strength">Fuerza / calistenia</option><option value="cardio">Running / ciclismo</option></select></label>
    {day.kind==='cardio'?<><label>Duración (min)<input type="number" min={5} max={360} value={day.cardio?.durationMin??30} onChange={e=>patchDay(i,{cardio:{...day.cardio!,durationMin:Number(e.target.value)}})}/></label><label>Sesión<select value={day.cardio?.type??'zone2'} onChange={e=>patchDay(i,{cardio:{...day.cardio!,type:e.target.value as NonNullable<Day['cardio']>['type']}})}>{['zone2','intervals','tempo','long','walkrun'].map(x=><option key={x}>{x}</option>)}</select></label></>:<>
     {day.items.map((item,j)=><div className="pro-plan-exercise" key={j}><label>Ejercicio<select value={item.exerciseId} onChange={e=>patchDay(i,{items:day.items.map((x,k)=>j===k?{...x,exerciseId:e.target.value}:x)})}>{(exercises.length?exercises:[{id:'push_up',name:'Flexiones'}]).map(x=><option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
      <div className="pro-input-grid">{(['sets','repMin','repMax','rirTarget','load'] as const).map(key=><label key={key}>{({sets:'Series',repMin:'Rep. mín.',repMax:'Rep. máx.',rirTarget:'RIR',load:'Carga kg'} as const)[key]}<input type="number" min={0} value={item[key]} onChange={e=>patchDay(i,{items:day.items.map((x,k)=>j===k?{...x,[key]:Number(e.target.value)}:x)})}/></label>)}</div><button onClick={()=>patchDay(i,{items:day.items.filter((_,k)=>j!==k)})}>Quitar ejercicio</button></div>)}
     <button onClick={()=>patchDay(i,{items:[...day.items,{exerciseId:'push_up',sets:3,repMin:8,repMax:12,rirTarget:2,load:0}]})}>+ Ejercicio</button>
    </>}
   </div>)}
   <div className="row"><button disabled={days.length>=7} onClick={()=>setDays(v=>[...v,defaultDay()])}>+ Jornada</button><button className="primary" disabled={busy} onClick={()=>void save()}>Guardar programa</button></div>
   <h3>Mis programas guardados</h3>{templates.map(t=><div className="pro-template" key={t.id}><strong>{t.name}</strong><span>{t.days.length} jornadas</span><button disabled={selected===null} onClick={()=>void assign(t.id)}>Asignar al alumno seleccionado</button></div>)}
   {status&&<p role="status">{status}</p>}
  </section>
 </div>;
}
