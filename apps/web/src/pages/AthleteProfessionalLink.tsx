import {useState, type FormEvent} from 'react';
import {api} from '../api';
import {useApp,useLoad} from '../ctx';

type Link={id:number;status:string;proName:string};
const formatStatus=(value:string)=>({active:'Vinculado',pending:'Invitación pendiente',revoked:'Revocado'} as Record<string,string>)[value]??value;

export function AthleteProfessionalLink(){
 const {me,refresh}=useApp();
 const links=useLoad<Link[]>('/api/links');
 const [code,setCode]=useState('');
 const [busy,setBusy]=useState(false);
 const [message,setMessage]=useState('');
 const [error,setError]=useState('');
 const allow=!!me.consents.share_with_pro;
 const join=async(e:FormEvent)=>{
  e.preventDefault();
  const normalized=code.toUpperCase().replace(/\s|-/g,'');
  if(!/^[A-Z0-9]{6,12}$/.test(normalized))return setError('El código debe contener entre 6 y 12 letras o números.');
  setBusy(true);setMessage('');setError('');
  try{
   const r=await api<{proName:string}>('POST','/api/links/join-code',{code:normalized});
   setMessage('Vinculación realizada con '+r.proName+'. Ahora figura en tus profesionales.');
   setCode('');links.reload();
  }catch(e){
   const status=(e as {status?:number}).status;
   setError(status===404?'No encontramos un profesional con ese código. Verificá que sea el correcto.':status===403?'Para vincularte debés autorizar compartir datos con el profesional.':'No se pudo completar la vinculación. Intentá nuevamente.');
  }finally{setBusy(false);}
 };
 const toggle=async()=>{
  setBusy(true);setError('');
  try{await api('PUT','/api/consents',{share_with_pro:true});await refresh();links.reload();}
  catch{setError('No se pudo guardar la autorización para compartir datos.');}
  finally{setBusy(false);}
 };
 return <section className="card" aria-label="Vincularme con mi profesional">
  <h3>Vincularme con mi profesional</h3>
  <p className="muted">¿Tu entrenador, profesor, kinesiólogo, nutricionista o médico te dio un código? Ingresalo acá para vincular tu cuenta con la suya.</p>
  {!allow&&<div className="card">
   <p>Antes de unirte, autorizá compartir tu información de entrenamiento y salud con el profesional vinculado. Podés revocar el acceso cuando quieras.</p>
   <button className="primary" type="button" disabled={busy} onClick={()=>void toggle()}>Autorizar compartir con mi profesional</button>
  </div>}
  <form onSubmit={e=>void join(e)}>
   <label htmlFor="athlete-pro-code">Código de vinculación</label>
   <div className="row">
    <input id="athlete-pro-code" type="text" autoComplete="off" inputMode="text" maxLength={16} placeholder="ABCD2345" value={code} onChange={e=>setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9\s-]/g,''))} aria-describedby="pro-code-help"/>
    <button className="primary" type="submit" disabled={busy||!allow||code.replace(/[\s-]/g,'').match(/^[A-Z0-9]{6,12}$/)===null}>{busy?'Vinculando…':'Unirme'}</button>
   </div>
   <p id="pro-code-help" className="muted small">Pedile a tu profesional su código de 8 caracteres. Nunca compartas contraseñas.</p>
  </form>
  {message&&<p className="ok" role="status">{message}</p>}
  {error&&<p className="warn" role="alert">{error}</p>}
  <h4>Mis profesionales vinculados</h4>
  {!links.data?<p className="muted">Consultando vinculaciones…</p>:links.data.length===0?<p className="muted">Todavía no estás vinculado a ningún profesional.</p>:links.data.map(link=><div key={link.id} className="row between"><span><strong>{link.proName}</strong> · {formatStatus(link.status)}</span>{link.status==='pending'&&<button disabled={busy||!allow} onClick={async()=>{setBusy(true);try{await api('POST','/api/links/'+link.id+'/accept');links.reload();}catch{setError('No se pudo aceptar la invitación.');}finally{setBusy(false);}}}>Aceptar</button>}</div>)}
 </section>;
}
