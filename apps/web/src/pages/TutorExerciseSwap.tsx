import {useEffect,useState} from 'react';
import {api} from '../api';

type PlanOptions={version:number;goal:string;days:{index:number;name:string;items:{index:number;exerciseId:string}[]}[];catalog:{id:string;pattern:string;muscle:string}[]};
type SwapPreview={allowed:boolean;version:number;fromId:string;toId:string;explanation:string;requiresConfirmation:boolean};
const friendly=(id:string)=>id.replace(/_/g,' ');
const alias=(value:string)=>{const v=value.toLowerCase().trim().normalize('NFD').replace(/[\u0300-\u036f]/g,'');if(/^(pull.?ups?|dominadas?|barra fija)$/.test(v))return 'pull_up';if(/^(chin.?ups?|dominadas supinas)$/.test(v))return 'chin_up';if(/^(jalon|jalones|polea alta)$/.test(v))return 'lat_pulldown';return v.replace(/\s+/g,'_');};
export function TutorExerciseSwap(){
 const [data,setData]=useState<PlanOptions|null>(null);
 const [day,setDay]=useState(0),[item,setItem]=useState(0),[desired,setDesired]=useState('');
 const [preview,setPreview]=useState<SwapPreview|null>(null);
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[success,setSuccess]=useState('');
 const reload=()=>api<PlanOptions>('GET','/api/plan/exercise-swap/options').then(setData).catch(()=>setError('No se pudo cargar tu rutina.'));
 useEffect(()=>{reload();},[]);
 const source=data?.days[day]?.items[item];
 const from=data?.catalog.find(x=>x.id===source?.exerciseId);
 const suggested=data?.catalog.filter(x=>x.id!==from?.id&&x.pattern===from?.pattern&&x.muscle===from?.muscle)??[];
 const proposed=alias(desired);
 const found=data?.catalog.find(x=>x.id===proposed)||data?.catalog.find(x=>friendly(x.id).includes(desired.toLowerCase().trim())&&desired.trim().length>2);
 const propose=async()=>{
  if(!data||!found||!source)return;
  setBusy(true);setError('');setSuccess('');setPreview(null);
  try{const result=await api<SwapPreview>('POST','/api/plan/exercise-swap/preview',{dayIndex:day,itemIndex:item,replacementId:found.id,expectedVersion:data.version});setPreview(result);}
  catch(e){
   const message=(e as {body?:{error?:string}}).body?.error;
   setError(({
     equipment_unavailable:'No tenés el equipamiento registrado para ese ejercicio.',
     exercise_conflicts_with_restriction:'Ese ejercicio puede entrar en conflicto con una restricción registrada.',
     exercise_too_advanced:'Ese ejercicio necesita más experiencia o técnica.',
     different_training_stimulus:'Ese cambio no trabaja el mismo patrón y músculo principal. No lo aplicaremos automáticamente; consultalo con tu profesional.',
     professional_clearance_required:'Por los antecedentes declarados, necesitás revisión profesional antes de modificar la rutina.',
     professional_plan_requires_approval:'Tu plan fue indicado por un profesional. Solicitale su autorización para modificarlo.',
     program_requires_professional_review:'Este programa tiene progresión semanal; el cambio necesita revisión profesional.',
     plan_changed:'Tu rutina cambió. Actualizá los datos antes de seguir.'
   } as Record<string,string>)[message??'']??'No se pudo validar el cambio. Probá con otro ejercicio.');}
  finally{setBusy(false);}
 };
 const confirm=async()=>{
  if(!preview||!data)return;setBusy(true);setError('');
  try{await api('POST','/api/plan/exercise-swap/confirm',{dayIndex:day,itemIndex:item,replacementId:preview.toId,expectedVersion:preview.version});setSuccess('Cambio confirmado y guardado como nueva versión de tu rutina.');setPreview(null);setDesired('');reload();}
  catch{setError('No se pudo aplicar. Si la rutina cambió, volvé a revisar la propuesta.');setPreview(null);reload();}
  finally{setBusy(false);}
 };
 return <section className="card" aria-label="Cambiar ejercicio con tutor">
  <h3>Proponer un cambio de rutina</h3>
  <p className="muted">¿Preferís hacer dominadas en lugar de otro ejercicio? Elegí cuál y escribí el reemplazo. Tu tutor valida el estímulo, equipamiento, experiencia y restricciones antes de pedirte confirmación.</p>
  {data&&data.days.length>0?<>
   <label>Jornada<select value={day} onChange={e=>{setDay(Number(e.target.value));setItem(0);setPreview(null);}}>{data.days.map(d=><option key={d.index} value={d.index}>{d.name}</option>)}</select></label>
   <label>Ejercicio a sustituir<select value={item} onChange={e=>{setItem(Number(e.target.value));setPreview(null);}}>{(data.days[day]?.items??[]).map(x=><option key={x.index} value={x.index}>{friendly(x.exerciseId)}</option>)}</select></label>
   <label>Quiero hacer…<input value={desired} onChange={e=>{setDesired(e.target.value);setPreview(null);}} placeholder="Ej.: dominadas / pull-ups" list="tutor-exercise-options"/></label>
   <datalist id="tutor-exercise-options">{suggested.map(x=><option key={x.id} value={friendly(x.id)}/>)}</datalist>
   <p className="muted small">{found?'Identificado: '+friendly(found.id):'Escribí el nombre del ejercicio o elegí uno de los sugeridos.'}</p>
   <button type="button" disabled={busy||!found||!source} onClick={()=>void propose()}>{busy?'Evaluando…':'Consultar si es compatible'}</button>
   {preview&&<div className="card"><p>{preview.explanation}</p><p><strong>{friendly(preview.fromId)} → {friendly(preview.toId)}</strong></p><button className="primary" type="button" disabled={busy} onClick={()=>void confirm()}>Confirmar cambio de rutina</button><button type="button" onClick={()=>setPreview(null)}>Cancelar</button></div>}
  </>:<p className="muted">Primero creá tu rutina para poder proponer cambios.</p>}
  {error&&<p role="alert" className="warn">{error}</p>}{success&&<p role="status" className="ok">{success}</p>}
  <p className="muted small">La IA no cambia la rutina sin tu confirmación. Los planes profesionales y las situaciones de riesgo requieren revisión humana.</p>
 </section>;
}
