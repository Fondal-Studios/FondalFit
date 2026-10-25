import {useEffect,useMemo,useState} from 'react';
import {api} from '../api';
import type {Me} from '../ctx';
type Category='doctor'|'trainer'|'gym';
type Listing={user_id:number;name:string;category:Category;specialty:string;description:string;city:string;region:string;country:string;latitude:number|null;longitude:number|null;whatsapp:string;remote:boolean};
type Profile={category:Category;specialty:string;description:string;city:string;region:string;country:string;latitude:number|null;longitude:number|null;whatsapp:string;remote:boolean};
const blank:Profile={category:'trainer',specialty:'Entrenamiento personalizado',description:'',city:'',region:'',country:'Argentina',latitude:null,longitude:null,whatsapp:'',remote:false};
const titles:Record<Category,string>={doctor:'Médico',trainer:'Profesor / entrenador',gym:'Gimnasio'};
const distanceKm=(a:{lat:number;lon:number},b:{lat:number;lon:number})=>{
 const rad=Math.PI/180,dLat=(b.lat-a.lat)*rad,dLon=(b.lon-a.lon)*rad;
 const h=Math.sin(dLat/2)**2+Math.cos(a.lat*rad)*Math.cos(b.lat*rad)*Math.sin(dLon/2)**2;
 return 12742*Math.asin(Math.min(1,Math.sqrt(h)));
};
export function ProfessionalDirectory({me}:{me:Me}){
 const [list,setList]=useState<Listing[]>([]),[category,setCategory]=useState<'all'|Category>('all'),[query,setQuery]=useState('');
 const [location,setLocation]=useState<{lat:number;lon:number}|null>(null),[status,setStatus]=useState('');
 const [profile,setProfile]=useState<Profile>(blank),[hasProfile,setHasProfile]=useState(false),[review,setReview]=useState<(Listing&{email:string})[]>([]);
 const [saving,setSaving]=useState(false),[selected,setSelected]=useState<number|null>(null);
 const load=()=>api<Listing[]>('GET','/api/directory').then(setList).catch(()=>setStatus('No se pudo cargar el directorio.'));
 useEffect(()=>{load();api<{profile:Profile|null}>('GET','/api/directory/me').then(r=>{if(r.profile){setProfile(r.profile);setHasProfile(true);}}).catch(()=>{});
  if(me.isAdmin)api<(Listing&{email:string})[]>('GET','/api/directory/review').then(setReview).catch(()=>{});
 },[me.isAdmin]);
 const visible=useMemo(()=>list.filter(p=>(category==='all'||p.category===category)&&(!query.trim()||[p.name,p.city,p.region,p.specialty].join(' ').toLowerCase().includes(query.toLowerCase()))).map(p=>({...p,distance:location&&p.latitude!==null&&p.longitude!==null?distanceKm(location,{lat:p.latitude,lon:p.longitude}):null})).sort((a,b)=>(a.distance??1e9)-(b.distance??1e9)),[list,category,query,location]);
 const near=()=>{if(!navigator.geolocation){setStatus('Este dispositivo no ofrece geolocalización. Buscá por ciudad.');return;}
  navigator.geolocation.getCurrentPosition(p=>{setLocation({lat:p.coords.latitude,lon:p.coords.longitude});setStatus('Resultados ordenados por cercanía aproximada.');},()=>setStatus('Ubicación no disponible. Podés buscar por ciudad.'),{enableHighAccuracy:false,timeout:12000,maximumAge:600000});
 };
 const save=async()=>{setSaving(true);setStatus('');try{await api('PUT','/api/directory/me',profile);setHasProfile(true);setStatus('Solicitud enviada a revisión. No se publicará hasta verificar tu identidad y credenciales.');}catch{setStatus('No se pudo enviar. Revisá el WhatsApp internacional, la descripción y los campos obligatorios.');}finally{setSaving(false);}};
 const action=async(id:number,approved:boolean)=>{try{await api('POST','/api/directory/review/'+id,{approved});setReview(v=>v.filter(x=>x.user_id!==id));setStatus(approved?'Perfil verificado y publicado.':'Solicitud rechazada.');load();}catch{setStatus('No se pudo actualizar la revisión.');}};
 return <div className="directory-page">
  <section className="card"><h2>Encontrá un profesional cerca tuyo</h2><p className="muted">Profesores, gimnasios y profesionales médicos con perfil verificado. Contactá directamente por WhatsApp; contactar no comparte tus estudios ni tus datos de salud.</p>
   <div className="directory-filters"><label>Especialidad<select value={category} onChange={e=>setCategory(e.target.value as 'all'|Category)}><option value="all">Todos</option><option value="doctor">Médicos</option><option value="trainer">Entrenadores</option><option value="gym">Gimnasios</option></select></label>
   <label>Ciudad, nombre o especialidad<input type="search" value={query} placeholder="Ej.: Cafayate, running, calistenia" onChange={e=>setQuery(e.target.value)}/></label></div>
   <button onClick={near}>Usar mi ubicación para ordenar por cercanía</button><p className="muted">La ubicación del deportista no se guarda ni se envía al servidor. Solo se utiliza en tu dispositivo.</p>
  </section>
  <section className="card"><h3>Profesionales disponibles ({visible.length})</h3>
   {visible.length===0?<p className="muted">Todavía no hay perfiles verificados que coincidan. Podés probar otra ciudad o categoría.</p>:visible.map(p=><article className="directory-result" key={p.user_id}><h3>{p.name}</h3><p><strong>{titles[p.category]}</strong> · {p.specialty}</p><p>{p.city}, {p.region} · {p.remote?'También atiende online':'Presencial'}{p.distance!==null?' · ≈'+p.distance.toFixed(1)+' km':''}</p><p className="muted">{p.description}</p>
    <div className="row"><a className="directory-contact" target="_blank" rel="noopener noreferrer" href={`https://wa.me/${p.whatsapp}?text=${encodeURIComponent('Hola, encontré tu perfil en Fondal Fit y quisiera consultar por una cita o entrenamiento.')}`}>Consultar por WhatsApp</a>
    {p.latitude!==null&&p.longitude!==null&&<button onClick={()=>setSelected(selected===p.user_id?null:p.user_id)}>Ver ubicación aproximada</button>}</div>
    {selected===p.user_id&&p.latitude!==null&&p.longitude!==null&&<iframe title={'Mapa de '+p.name} className="directory-map" loading="lazy" referrerPolicy="no-referrer" src={`https://www.openstreetmap.org/export/embed.html?bbox=${p.longitude-.018}%2C${p.latitude-.012}%2C${p.longitude+.018}%2C${p.latitude+.012}&layer=mapnik&marker=${p.latitude}%2C${p.longitude}`}/>}
   </article>)}
  </section>
  {me.mode==='pro'&&<section className="card"><h2>{hasProfile?'Editar mi perfil profesional':'Afiliarme gratis como profesional'}</h2><p className="muted">Beta gratuita. La publicación requiere verificación manual de identidad, matrícula o credenciales. No hay cobros habilitados.</p>
   <div className="directory-filters"><label>Tipo<select value={profile.category} onChange={e=>setProfile(p=>({...p,category:e.target.value as Category}))}><option value="trainer">Entrenador</option><option value="doctor">Médico</option><option value="gym">Gimnasio</option></select></label>
   <label>Especialidad<input value={profile.specialty} onChange={e=>setProfile(p=>({...p,specialty:e.target.value}))}/></label></div>
   <label>Descripción profesional<textarea rows={3} value={profile.description} onChange={e=>setProfile(p=>({...p,description:e.target.value}))} placeholder="Formación, servicios, modalidad de atención y experiencia"/></label>
   <div className="directory-filters"><label>Ciudad<input value={profile.city} onChange={e=>setProfile(p=>({...p,city:e.target.value}))}/></label><label>Provincia / región<input value={profile.region} onChange={e=>setProfile(p=>({...p,region:e.target.value}))}/></label><label>País<input value={profile.country} onChange={e=>setProfile(p=>({...p,country:e.target.value}))}/></label><label>WhatsApp internacional (solo números)<input inputMode="tel" value={profile.whatsapp} placeholder="549..." onChange={e=>setProfile(p=>({...p,whatsapp:e.target.value.replace(/\D/g,'')}))}/></label></div>
   <label className="check"><input type="checkbox" checked={profile.remote} onChange={e=>setProfile(p=>({...p,remote:e.target.checked}))}/> También ofrezco consultas o entrenamiento a distancia</label>
   <button onClick={()=>{if(!navigator.geolocation){setStatus('GPS no disponible.');return;}navigator.geolocation.getCurrentPosition(p=>{setProfile(v=>({...v,latitude:Math.round(p.coords.latitude*100)/100,longitude:Math.round(p.coords.longitude*100)/100}));setStatus('Ubicación aproximada incorporada (precisión ≈1 km).');},()=>setStatus('No se pudo obtener la ubicación. Podés publicar solo la ciudad.'),{enableHighAccuracy:false});}}>Usar ubicación aproximada de mi gimnasio o consultorio</button>
   <p className="muted">No publiques tu domicilio particular. El punto se redondea para evitar mostrar una dirección exacta.</p>
   <div className="row"><button className="primary" disabled={saving} onClick={()=>void save()}>{saving?'Enviando…':'Enviar perfil a verificación'}</button>{hasProfile&&<button onClick={async()=>{await api('DELETE','/api/directory/me');setStatus('Perfil ocultado del directorio.');load();}}>Ocultar mi perfil</button>}</div>
  </section>}
  {me.isAdmin&&<section className="card"><h2>Verificación de profesionales</h2><p className="warn">Comprobá la matrícula, la identidad y la formación por un canal externo antes de aprobar. Este botón no realiza la verificación automáticamente.</p>{review.length===0?<p className="muted">No hay solicitudes pendientes.</p>:review.map(p=><div className="directory-result" key={p.user_id}><strong>{p.name} · {p.email}</strong><p>{titles[p.category]} · {p.specialty} · {p.city}</p><p>{p.description}</p><div className="row"><button onClick={()=>void action(p.user_id,true)}>Aprobar tras verificar</button><button onClick={()=>void action(p.user_id,false)}>Rechazar</button></div></div>)}</section>}
  {status&&<p className="card" role="status">{status}</p>}
 </div>;
}
