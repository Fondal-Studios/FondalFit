import {useEffect,useState} from 'react';
import {api} from '../api';
import type {Me} from '../ctx';
type Category='medical'|'fitness';
type Profile={id:number;category:Category;displayName:string;specialty:string;credentials:string;license?:string;description:string;phone:string;city:string;area:string;modality:'online'|'in_person'|'both';lat:number|null;lon:number|null;verified:boolean;published?:boolean;distanceKm?:number|null};
const categoryName=(c:Category)=>c==='medical'?'Profesional de salud':'Entrenador / profesor';
const whatsapp=(phone:string,name:string)=>'https://wa.me/'+phone.replace(/\D/g,'')+'?text='+encodeURIComponent('Hola, encontré tu perfil en Fondal Fit y quisiera consultar por un turno con '+name+'.');
export function Directory(){
 const [category,setCategory]=useState<'all'|Category>('all'),[city,setCity]=useState('Cafayate'),[near,setNear]=useState<{lat:number;lon:number}|null>(null);
 const [profiles,setProfiles]=useState<Profile[]>([]),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const search=async(c=category,t=city,loc=near)=>{
  setBusy(true);setError('');
  const params=new URLSearchParams({category:c,city:t});
  if(loc){params.set('lat',String(loc.lat));params.set('lon',String(loc.lon));}
  try{const data=await api<{items:Profile[]}>('GET','/api/directory?'+params);setProfiles(data.items);}
  catch{setError('No se pudo consultar el directorio.');}finally{setBusy(false);}
 };
 useEffect(()=>{void search();},[]);
 const nearby=()=>{
  if(!navigator.geolocation){setError('Tu dispositivo no ofrece geolocalización. Buscá por ciudad.');return;}
  navigator.geolocation.getCurrentPosition(p=>{const loc={lat:p.coords.latitude,lon:p.coords.longitude};setNear(loc);setCity('');void search(category,'',loc);},()=>setError('No se pudo obtener tu ubicación. Podés buscar por ciudad.'),{enableHighAccuracy:false,timeout:10000});
 };
 return <section className="card directory"><h2>Encontrá un profesional</h2>
  <p className="muted">Médicos y profesores verificados. Elegí a quién consultar, por ubicación o modalidad. El contacto no comparte automáticamente tus datos de salud.</p>
  <div className="directory-controls">
   <label>Especialidad<select value={category} onChange={e=>setCategory(e.target.value as 'all'|Category)}><option value="all">Todos</option><option value="medical">Médicos y salud</option><option value="fitness">Entrenadores y gimnasios</option></select></label>
   <label>Ciudad<input value={city} onChange={e=>setCity(e.target.value)} placeholder="Ej.: Cafayate"/></label>
  </div>
  <div className="row"><button className="primary" disabled={busy} onClick={()=>void search()}>{busy?'Buscando…':'Buscar profesionales'}</button><button onClick={nearby}>Cerca de mí</button></div>
  {error&&<p role="alert" className="warn">{error}</p>}
  {profiles.length===0&&!busy&&<p className="muted">No hay perfiles verificados con esos filtros. Probá otra ciudad o buscá en todas las especialidades.</p>}
  {profiles.map(p=><article className="directory-result" key={p.id+'-'+p.category}>
   <div className="row between"><strong>{p.displayName}</strong><span className="badge ok">Verificado</span></div>
   <p>{categoryName(p.category)} · {p.specialty}</p>
   <p className="muted">{p.city}{p.area?', '+p.area:''}{p.distanceKm!==null&&p.distanceKm!==undefined?' · ≈'+p.distanceKm+' km en línea recta':''} · {p.modality==='both'?'Presencial y virtual':p.modality==='online'?'Virtual':'Presencial'}</p>
   {p.description&&<p>{p.description}</p>}
   <div className="row"><a className="directory-contact" href={whatsapp(p.phone,p.displayName)} target="_blank" rel="noopener noreferrer">Consultar por WhatsApp</a>
    {p.lat!==null&&p.lon!==null&&<a href={'https://www.openstreetmap.org/?mlat='+p.lat+'&mlon='+p.lon+'#map=15/'+p.lat+'/'+p.lon} target="_blank" rel="noopener noreferrer">Ver zona en mapa</a>}
   </div>
  </article>)}
 </section>;
}
const empty=(name:string,category:Category):Profile=>({id:0,category,displayName:name,specialty:'',credentials:'',license:'',description:'',phone:'',city:'Cafayate',area:'',modality:'both',lat:null,lon:null,verified:false,published:true});
export function MyProfessionalProfile({me,category,onSaved}:{me:Me;category:Category;onSaved?:()=>void}){
 const [profile,setProfile]=useState<Profile>(empty(me.name,category)),[status,setStatus]=useState(''),[saving,setSaving]=useState(false);
 useEffect(()=>{api<Profile[]>('GET','/api/profiles/me').then(rows=>setProfile(rows.find(x=>x.category===category)??empty(me.name,category))).catch(()=>{});},[category,me.name]);
 const set=<K extends keyof Profile>(key:K,value:Profile[K])=>setProfile(p=>({...p,[key]:value}));
 const save=async()=>{setSaving(true);try{await api('PUT','/api/profiles/me',profile);setStatus('Perfil enviado a verificación. No será público hasta su aprobación.');onSaved?.();}catch{setStatus('No se pudo guardar. Revisá los datos y el número internacional de WhatsApp.');}finally{setSaving(false);}};
 return <section className="card professional-profile"><h2>{category==='medical'?'Mi perfil de salud':'Mi perfil de entrenador'}</h2>
  <p className="muted">La afiliación es gratuita durante la beta. Las credenciales y matrícula se revisan antes de publicar. No se solicitan documentos de pacientes.</p>
  <p className={profile.verified?'ok':'warn'}>{profile.verified?'Perfil verificado':'Pendiente de verificación'}</p>
  <div className="profile-fields">
   <label>Nombre público<input value={profile.displayName} onChange={e=>set('displayName',e.target.value)}/></label>
   <label>Especialidad<input placeholder={category==='medical'?'Medicina del ejercicio, nutrición clínica…':'Calistenia, fuerza, running…'} value={profile.specialty} onChange={e=>set('specialty',e.target.value)}/></label>
   <label>Formación / título<input value={profile.credentials} onChange={e=>set('credentials',e.target.value)}/></label>
   <label>{category==='medical'?'Matrícula profesional':'Certificación (si corresponde)'}<input value={profile.license??''} onChange={e=>set('license',e.target.value)}/></label>
   <label>WhatsApp internacional (solo números, ej. 5493875467519)<input inputMode="tel" value={profile.phone} onChange={e=>set('phone',e.target.value)}/></label>
   <label>Ciudad<input value={profile.city} onChange={e=>set('city',e.target.value)}/></label>
   <label>Zona o barrio<input value={profile.area} onChange={e=>set('area',e.target.value)}/></label>
   <label>Modalidad<select value={profile.modality} onChange={e=>set('modality',e.target.value as Profile['modality'])}><option value="both">Presencial y virtual</option><option value="in_person">Presencial</option><option value="online">Virtual</option></select></label>
   <label>Presentación<textarea rows={3} value={profile.description} onChange={e=>set('description',e.target.value)}/></label>
  </div>
  <div className="card"><strong>Ubicación aproximada en el mapa (opcional)</strong><p className="muted">Si querés aparecer por cercanía, podés compartir una zona aproximada. Redondeamos la ubicación a unos 1 km; no guardamos tu dirección exacta.</p>
    <button onClick={()=>{if(!navigator.geolocation){setStatus('GPS no disponible. Podés mantener solo la ciudad.');return;}navigator.geolocation.getCurrentPosition(pos=>{setProfile(p=>({...p,lat:Math.round(pos.coords.latitude*100)/100,lon:Math.round(pos.coords.longitude*100)/100}));setStatus('Zona aproximada cargada. Guardá el perfil para enviarla a verificación.');},()=>setStatus('No se pudo obtener ubicación. La ciudad alcanza para el buscador.'),{enableHighAccuracy:false,timeout:10000});}}>Usar mi zona aproximada</button>
    {profile.lat!==null&&<p className="muted">Zona aproximada: {profile.lat}, {profile.lon} <button onClick={()=>setProfile(p=>({...p,lat:null,lon:null}))}>Quitar ubicación</button></p>}
  </div>
  <label className="check"><input type="checkbox" checked={!!profile.published} onChange={e=>set('published',e.target.checked)}/>Quiero aparecer en el buscador una vez verificado</label>
  <button className="primary" disabled={saving||!profile.specialty.trim()||!profile.phone.trim()} onClick={()=>void save()}>{saving?'Guardando…':'Guardar y solicitar verificación'}</button>
  {status&&<p role="status">{status}</p>}
 </section>;
}
export function MedicalPanel({me}:{me:Me}){
 return <div><section className="card"><h2>Panel de salud</h2><p>Gestioná tu perfil profesional y las consultas que lleguen por contacto directo. Los pacientes no comparten automáticamente sus registros ni laboratorios.</p>
  <p className="muted">La recepción de estudios, agenda clínica y seguimiento de pacientes requieren un módulo con consentimiento específico y permisos separados. No están habilitados en esta beta.</p></section>
  <MyProfessionalProfile me={me} category="medical"/>
 </div>;
}
export function AdminPanel(){
 const [profiles,setProfiles]=useState<(Profile&{email:string;license:string})[]>([]),[name,setName]=useState('NanoGM'),[accounts,setAccounts]=useState<{id:number;name:string;email:string;role:string;mode:string}[]>([]),[error,setError]=useState('');
 const load=()=>api<(Profile&{email:string;license:string})[]>('GET','/api/admin/professionals').then(setProfiles).catch(()=>setError('Acceso administrativo no disponible.'));
 useEffect(()=>{void load();},[]);
 const verify=async(p:Profile,verified:boolean)=>{try{await api('POST','/api/admin/professionals/verify',{userId:p.id,category:p.category,verified});load();}catch{setError('No se pudo actualizar la verificación.');}};
 const lookup=async()=>{try{const data=await api<{users:typeof accounts}>('GET','/api/admin/accounts/lookup?name='+encodeURIComponent(name));setAccounts(data.users);}catch{setError('No se pudo consultar la cuenta.');}};
 return <div><section className="card"><h2>Administración Fondal Fit</h2><p className="muted">Control de perfiles profesionales. Solo las cuentas autorizadas por el servidor pueden aprobar credenciales.</p>
  <label>Buscar cuenta por nombre exacto<input value={name} onChange={e=>setName(e.target.value)}/></label><button onClick={()=>void lookup()}>Verificar cuenta</button>
  {accounts.map(a=><div key={a.id} className="directory-result"><p>{a.name} · ID {a.id} · {a.email} · {a.role} · {a.mode}</p>
   {a.name.toLowerCase()==='nanogm'&&<button onClick={async()=>{if(!window.confirm('¿Confirmás que este ID y correo corresponden a tu cuenta NanoGM?'))return;try{await api('POST','/api/admin/accounts/grant-founder',{userId:a.id,expectedEmail:a.email});setError('Permisos de fundador asignados. El perfil médico quedó pendiente de verificación de matrícula.');load();}catch{setError('No se pudo asignar. Verificá el ID y correo.');}}}>Habilitar administrador, entrenador y salud para NanoGM</button>}
   </div>)}{accounts.length===0&&<p className="muted">Sin resultados cargados.</p>}
  {error&&<p className="warn" role="alert">{error}</p>}
 </section>
 <section className="card"><h2>Afiliaciones y verificación</h2>{profiles.map(p=><div className="directory-result" key={p.id+'-'+p.category}><strong>{p.displayName} · {categoryName(p.category)}</strong><p>{p.specialty} · {p.city} · {p.email}</p><p>Matrícula / certificación: {p.license||'No informada'}</p><p>{p.verified?'Verificado':'Pendiente'}</p><div className="row"><button onClick={()=>void verify(p,true)}>Aprobar credenciales</button><button onClick={()=>void verify(p,false)}>Revocar</button></div></div>)}</section>
 </div>;
}
