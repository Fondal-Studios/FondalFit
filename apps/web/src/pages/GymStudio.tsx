import {useEffect,useState} from 'react';
import {api} from '../api';
type Gym={id:number;owner_id:number;name:string;city:string;area:string;member_type?:string;status?:string};
type Member={id:number;name:string;email:string;member_type:'coach'|'athlete';status:string;assigned_coach_id:number|null};
type Activity={id:number;sessions30:number;lastActivity:string|null};
type Detail={gym:Gym;members:Member[];activity:Activity[];plan:{plan:string;status:string};checkoutEnabled:boolean};
type Invitations={invitations:{id:number;name:string;city:string;member_type:string}[]};
type Collection={owned:Gym[];connected:Gym[]};
export function GymStudio({athlete=false}:{athlete?:boolean}){
 const [list,setList]=useState<Collection|null>(null),[invites,setInvites]=useState<Invitations|null>(null);
 const [selected,setSelected]=useState<number|null>(null),[detail,setDetail]=useState<Detail|null>(null),[name,setName]=useState(''),[city,setCity]=useState('Cafayate'),[area,setArea]=useState('');
 const [email,setEmail]=useState(''),[kind,setKind]=useState<'coach'|'athlete'>('athlete');
 const [status,setStatus]=useState(''),[busy,setBusy]=useState(false);
 const refresh=async()=>{try{const [gyms,requests]=await Promise.all([api<Collection>('GET','/api/gyms'),api<Invitations>('GET','/api/gyms/invitations')]);setList(gyms);setInvites(requests);if(selected!==null&&!athlete)await fetchDetails(selected);}catch{setStatus('No se pudo cargar la información de gimnasios.');}};
 const fetchDetails=async(id:number)=>{try{setDetail(await api<Detail>('GET','/api/gyms/'+id));setSelected(id);}catch{setStatus('No tenés acceso a ese gimnasio.');}};
 useEffect(()=>{void refresh();},[]);
 const accept=async(id:number)=>{setBusy(true);try{await api('POST',`/api/gyms/${id}/invitations/accept`);setStatus('Vinculación confirmada.');await refresh();}catch{setStatus('No pudimos aceptar la invitación. Si sos alumno, activá el permiso de compartir con profesionales desde Ajustes.');}finally{setBusy(false);}};
 const create=async()=>{setBusy(true);try{const result=await api<{id:number}>('POST','/api/gyms',{name,city,area});setName('');setStatus('Gimnasio creado en beta gratuita.');await refresh();await fetchDetails(result.id);}catch{setStatus('No se pudo crear el gimnasio. Verificá que estés en modo Entrenador.');}finally{setBusy(false);}};
 const invite=async()=>{if(selected===null)return;setBusy(true);try{await api('POST',`/api/gyms/${selected}/invite`,{email,memberType:kind});setStatus('Invitación preparada. La persona debe aceptar desde su propia cuenta.');setEmail('');await refresh();}catch{setStatus('No se pudo invitar. Solo el titular invita entrenadores; confirmá que no superaste los límites beta.');}finally{setBusy(false);}};
 const assign=async(member:number,coach:number|null)=>{if(selected===null)return;try{await api('PUT',`/api/gyms/${selected}/members/${member}/assign`,{coachId:coach});setStatus('Asignación actualizada. Para compartir rutinas, usá además el código de vinculación del entrenador.');await fetchDetails(selected);}catch{setStatus('No se pudo asignar el alumno. Se requiere consentimiento activo.');}};
 const remove=async(member:number)=>{if(selected===null)return;try{await api('POST',`/api/gyms/${selected}/members/${member}/remove`);setStatus('Acceso revocado.');await fetchDetails(selected);}catch{setStatus('Solo el titular puede quitar miembros.');}};
 return <div className="gym-studio"><section className="card"><h2>{athlete?'Mis gimnasios':'Administrar gimnasio'}</h2><p className="muted">{athlete?'Aceptá las invitaciones de gimnasios donde entrenás. Tu historial de salud no se comparte automáticamente.':'Organizá profesores y alumnos con invitaciones, seguimiento de actividad y asignación de responsables.'}</p>
  {invites?.invitations.map(x=><div className="gym-member" key={x.id}><strong>{x.name} · {x.city}</strong><span>Invitación como {x.member_type==='coach'?'profesor':'alumno'}</span><button disabled={busy} className="primary" onClick={()=>void accept(x.id)}>Aceptar invitación</button></div>)}
  {list&&[...list.owned,...list.connected].map(g=>athlete?<div key={g.id} className="gym-member"><strong>{g.name}</strong><span>{g.city}{g.area?', '+g.area:''} · Miembro activo</span></div>:<button key={g.id} className={'gym-row '+(selected===g.id?'on':'')} onClick={()=>void fetchDetails(g.id)}><strong>{g.name}</strong><span>{g.city}{g.area?', '+g.area:''} · {g.owner_id===undefined?'Miembro':'Gimnasio'}</span></button>)}
  {list&&list.owned.length+list.connected.length===0&&<p className="muted">Todavía no pertenecés a ningún gimnasio.</p>}
  </section>
  {!athlete&&<><section className="card"><h3>Crear un gimnasio</h3><p className="muted">Beta gratuita. Hasta cinco gimnasios por propietario, con un límite de cien miembros cada uno.</p>
   <label>Nombre<input value={name} onChange={e=>setName(e.target.value)} placeholder="Mi gimnasio"/></label>
   <label>Ciudad<input value={city} onChange={e=>setCity(e.target.value)}/></label>
   <label>Zona<input value={area} onChange={e=>setArea(e.target.value)}/></label>
   <button className="primary" disabled={busy||name.trim().length<3||city.trim().length<2} onClick={()=>void create()}>Crear gimnasio</button>
  </section>
  {detail&&<section className="card"><h2>{detail.gym.name}</h2><p className="muted">{detail.gym.city} · {detail.plan.plan==='beta_free'?'Beta gratuita':'Plan '+detail.plan.plan}</p>
   <div className="pro-kpis"><div><strong>{detail.members.filter(m=>m.member_type==='coach'&&m.status==='active').length}</strong><small>Profesores</small></div><div><strong>{detail.members.filter(m=>m.member_type==='athlete'&&m.status==='active').length}</strong><small>Alumnos</small></div><div><strong>{detail.activity.filter(a=>a.sessions30>0).length}</strong><small>Activos 30 días</small></div></div>
   <h3>Invitar al equipo</h3><div className="row"><label>Correo<input type="email" value={email} onChange={e=>setEmail(e.target.value)} placeholder="persona@correo.com"/></label>
   <label>Rol<select value={kind} onChange={e=>setKind(e.target.value as 'athlete'|'coach')}><option value="athlete">Alumno</option><option value="coach">Profesor</option></select></label></div>
   <button className="primary" disabled={busy||!email.includes('@')} onClick={()=>void invite()}>Enviar invitación</button>
   <p className="muted">Si la cuenta existe, verá la invitación en Fondal Fit. Su aceptación es necesaria para incorporarse.</p>
   <h3>Miembros y seguimiento</h3>{detail.members.length===0&&<p className="muted">Todavía no hay alumnos ni profesores.</p>}
   {detail.members.map(m=>{const act=detail.activity.find(a=>a.id===m.id);return <div className="gym-member" key={m.id}>
      <strong>{m.name}</strong><span>{m.member_type==='coach'?'Profesor':'Deportista'} · {m.status==='active'?'Activo':m.status==='pending'?'Pendiente':'Revocado'}</span>
      {m.member_type==='athlete'&&m.status==='active'&&<><p>{act?.sessions30??0} sesiones en 30 días · Última: {act?.lastActivity?.slice(0,10)??'Sin registros'}</p>
       <label>Profesor responsable<select value={m.assigned_coach_id??''} onChange={e=>void assign(m.id,e.target.value?Number(e.target.value):null)}><option value="">Sin asignar</option>
        {[{id:detail.gym.owner_id,name:'Titular'},...detail.members.filter(x=>x.member_type==='coach'&&x.status==='active')].map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label></>}
      <button onClick={()=>void remove(m.id)}>Quitar acceso</button>
    </div>;})}
  </section>}
  <section className="card"><h3>Planes para gimnasios</h3><p><strong>Beta gratuita activa</strong>. Futuro plan orientativo: USD 49/mes por gimnasio (sin cobro configurado).</p>
   <p className="muted">No hay checkout ni renovación automática. Primero validamos organización, asistencia y utilidad comercial.</p>
  </section></>}
  {status&&<p className="card" role="status">{status}</p>}
 </div>;
}
