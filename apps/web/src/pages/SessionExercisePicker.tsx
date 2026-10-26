import {useEffect,useState} from 'react';
import {api} from '../api';
import {useT} from '../ctx';

type Preview={version:number;toId:string;explanation:string};
type Alternative={id:string;muscle:string;equipment:string[];level:number;available:boolean;equipmentRegistered:boolean;risk:'green'|'yellow'|'red';restrictions:string[];reason:string|null};
type Alternatives={version:number;sourceId:string;goal:string;alternatives:Alternative[]};
type Props={dayIndex:number;itemIndex:number;exerciseId:string;onCancel:()=>void;onSaved:()=>void;onSessionChoice?:(id:string)=>void};
const messages:Record<string,string>={
 professional_plan_requires_approval:'Esta rutina fue indicada por tu profesional. Solicitale que autorice la modificación.',
 program_requires_professional_review:'Esta rutina tiene una progresión por semanas. Solicitá revisión antes de sustituir ejercicios.',
 professional_clearance_required:'Tenés antecedentes o alertas registradas; consultá con un profesional antes de modificar tu rutina.',
 equipment_unavailable:'El equipamiento de este ejercicio no figura entre tus opciones disponibles. Actualizá tu evaluación si contás con él.',
 exercise_conflicts_with_restriction:'El ejercicio puede afectar una zona que declaraste como restringida.',
 exercise_too_advanced:'La alternativa requiere más experiencia técnica que tu nivel registrado.',
 different_training_stimulus:'Esta alternativa cambia el patrón o el músculo principal de tu rutina.',
 plan_changed:'Tu plan cambió. Cerrá el selector y volvé a abrirlo.',
 exercise_not_found:'No encontramos el ejercicio en la rutina activa.',
 same_exercise:'Ya estás realizando ese ejercicio.',
};
export function SessionExercisePicker({dayIndex,itemIndex,exerciseId,onCancel,onSaved,onSessionChoice}:Props){
 const t=useT();
 const [version,setVersion]=useState<number|null>(null);
 const [choices,setChoices]=useState<Alternative[]>([]);
 const [loading,setLoading]=useState(true);
 const [search,setSearch]=useState('');
 const [selected,setSelected]=useState('');
 const [equipmentConfirmed,setEquipmentConfirmed]=useState(false);
 const [clinicianApproved,setClinicianApproved]=useState(false);
 const [preview,setPreview]=useState<Preview|null>(null);
 const [error,setError]=useState('');
 const [busy,setBusy]=useState(false);
 useEffect(()=>{let active=true;api<Alternatives>('GET',`/api/plan/exercise-swap/alternatives?dayIndex=${dayIndex}&itemIndex=${itemIndex}`).then(x=>{if(active){setVersion(x.version);setChoices(x.alternatives);}}).catch(()=>{if(active)setError('No se pudieron cargar las alternativas del catálogo.');}).finally(()=>{if(active)setLoading(false);});return()=>{active=false;};},[dayIndex,itemIndex,exerciseId]);
 const choose=async(id:string)=>{
  setSelected(id);setError('');setPreview(null);setBusy(true);
  try{
   const p=await api<Preview>('POST','/api/plan/exercise-swap/preview',{dayIndex,itemIndex,replacementId:id,equipmentConfirmed,clinicianApproved,...(version?{expectedVersion:version}:{})});
   setPreview(p);
  }catch(e){
   const code=(e as {body?:{error?:string}}).body?.error??'';
   setError(messages[code]??'No se pudo modificar el plan. Podés registrar el ejercicio elegido para esta sesión.');
  }finally{setBusy(false);}
 };
 const confirm=async()=>{
  if(!preview||busy)return;
  setBusy(true);setError('');
  try{
   await api('POST','/api/plan/exercise-swap/confirm',{dayIndex,itemIndex,replacementId:preview.toId,equipmentConfirmed,clinicianApproved,expectedVersion:preview.version});
   onSaved();
  }catch(e){
   const code=(e as {body?:{error?:string}}).body?.error??'';
   setError(messages[code]??'No se pudo guardar el cambio. Intentá de nuevo.');setPreview(null);
  }finally{setBusy(false);}
 };
 const recordChoice=async()=>{
  if(!selected||version===null||busy)return;
  setBusy(true);setError('');
  try{await api('POST','/api/plan/exercise-swap/session-choice',{dayIndex,itemIndex,replacementId:selected,expectedVersion:version,riskAcknowledged:true});onSessionChoice?.(selected);}
  catch{setError('No se pudo registrar el ejercicio de esta sesión.');}
  finally{setBusy(false);}
 };
 const visible=choices.filter(x=>t('ex_'+x.id).toLowerCase().includes(search.toLowerCase())||x.id.includes(search.toLowerCase())).slice(0,35);
 return <div className="exercise-swap-overlay" role="presentation" onClick={e=>{if(e.target===e.currentTarget)onCancel();}}>
  <section className="exercise-swap-dialog" role="dialog" aria-modal="true" aria-label="Alternativas de ejercicio">
   <div className="row between"><h2>Cambiar ejercicio</h2><button type="button" onClick={onCancel} aria-label="Cerrar alternativas">✕</button></div>
   <p className="muted">Actual: <strong>{t('ex_'+exerciseId)}</strong>. Las opciones siguientes provienen del catálogo completo, no de los ejercicios de tu jornada. Están ordenadas por compatibilidad con tu nivel y equipamiento.</p>
   {preview ? <div className="card exercise-swap-confirm" role="status">
     <h3>¿Confirmás el reemplazo?</h3>
     <p><strong>{t('ex_'+exerciseId)} → {t('ex_'+preview.toId)}</strong></p>
     <p>{preview.explanation}</p>
     <div className="exercise-swap-confirm-actions"><button type="button" className="primary" disabled={busy} onClick={()=>void confirm()}>{busy?'Guardando…':'Confirmar y guardar cambio'}</button><button type="button" disabled={busy} onClick={()=>{setPreview(null);setSelected('');}}>Elegir otro ejercicio</button></div>
   </div> : <>
     <label className="check"><input type="checkbox" checked={equipmentConfirmed} onChange={e=>setEquipmentConfirmed(e.target.checked)}/> Confirmo que tengo el equipamiento necesario para el ejercicio elegido.</label>
     <label className="check"><input type="checkbox" checked={clinicianApproved} onChange={e=>{setClinicianApproved(e.target.checked);setPreview(null);}}/> Un profesional tratante me autorizó específicamente este ejercicio pese a la restricción registrada.</label>
     <label>Buscar alternativa<input type="search" placeholder="Ej.: press inclinado, mancuernas…" value={search} onChange={e=>setSearch(e.target.value)}/></label>
     {loading&&<p role="status">Buscando ejercicios similares en el catálogo…</p>}
     {!loading&&visible.length===0&&<p className="muted">No hay alternativas compatibles fuera de tu jornada con ese patrón y grupo muscular.</p>}
     <div className="exercise-swap-options">
       {visible.map(x=><button type="button" key={x.id} disabled={busy||(!x.equipmentRegistered&&!equipmentConfirmed)||(x.risk==='red'&&!clinicianApproved)} className={'swap-risk-'+x.risk+(selected===x.id?' on':'')} onClick={()=>void choose(x.id)}>
         <strong>{x.risk==='green'?'🟢':x.risk==='yellow'?'🟡':'🔴'} {t('ex_'+x.id)}</strong><span className="muted small">{x.equipment.map(k=>t(k)).join(', ')} · {t('m_'+x.muscle)}{!x.equipmentRegistered?' · Requiere confirmar equipamiento':''}{x.restrictions.length?' · Restricción: '+x.restrictions.join(', '):''}{x.risk==='red'?' · Requiere autorización profesional':''}</span>
       </button>)}
     </div>
   </>}
   {busy&&<p role="status">{preview?'Guardando el cambio…':'Verificando compatibilidad…'}</p>}
   {error&&<p className="warn" role="alert">{error}</p>}
   {selected&&onSessionChoice&&<div className="card"><p><strong>Registrar lo que voy a hacer hoy</strong></p><p className="muted">Si el ejercicio entra en conflicto con una lesión registrada, Fondal Fit no lo recomienda. Podés documentar tu elección para esta sesión sin modificar tu plan ni afirmar que es seguro.</p><button type="button" disabled={busy} onClick={()=>void recordChoice()}>Registrar este ejercicio para la sesión</button></div>}
   <p className="muted small">No se modifica ningún ejercicio hasta que confirmes. Si el plan fue asignado por un profesional, el cambio requiere su revisión.</p>
  </section>
 </div>;
}
