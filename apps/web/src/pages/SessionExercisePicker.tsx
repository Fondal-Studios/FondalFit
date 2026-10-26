import {useEffect,useState} from 'react';
import {CATALOG,byId} from '@fondal/engine';
import {api} from '../api';
import {useT} from '../ctx';

type Preview={version:number;toId:string;explanation:string};
type Props={dayIndex:number;itemIndex:number;exerciseId:string;onCancel:()=>void;onSaved:()=>void};
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
export function SessionExercisePicker({dayIndex,itemIndex,exerciseId,onCancel,onSaved}:Props){
 const t=useT(),source=byId(exerciseId);
 const [version,setVersion]=useState<number|null>(null);
 const [choices,setChoices]=useState(CATALOG.filter(x=>x.id!==exerciseId&&x.pattern===source?.pattern&&x.muscle===source?.muscle&&!!x.timed===!!source?.timed));
 const [search,setSearch]=useState('');
 const [selected,setSelected]=useState('');
 const [preview,setPreview]=useState<Preview|null>(null);
 const [error,setError]=useState('');
 const [busy,setBusy]=useState(false);
 useEffect(()=>{api<{version:number}>('GET','/api/plan').then(x=>setVersion(x.version)).catch(()=>setError('No se pudo consultar la versión activa de tu rutina.'));},[]);
 const choose=async(id:string)=>{
  setSelected(id);setError('');setPreview(null);setBusy(true);
  try{
   const p=await api<Preview>('POST','/api/plan/exercise-swap/preview',{dayIndex,itemIndex,replacementId:id,...(version?{expectedVersion:version}:{})});
   setPreview(p);
  }catch(e){
   const code=(e as {body?:{error?:string}}).body?.error??'';
   setError(messages[code]??'No se pudo evaluar este ejercicio. Intentá con otra alternativa.');
  }finally{setBusy(false);}
 };
 const confirm=async()=>{
  if(!preview||busy)return;
  setBusy(true);setError('');
  try{
   await api('POST','/api/plan/exercise-swap/confirm',{dayIndex,itemIndex,replacementId:preview.toId,expectedVersion:preview.version});
   onSaved();
  }catch(e){
   const code=(e as {body?:{error?:string}}).body?.error??'';
   setError(messages[code]??'No se pudo guardar el cambio. Intentá de nuevo.');setPreview(null);
  }finally{setBusy(false);}
 };
 const visible=choices.filter(x=>t('ex_'+x.id).toLowerCase().includes(search.toLowerCase())||x.id.includes(search.toLowerCase())).slice(0,35);
 return <div className="exercise-swap-overlay" role="presentation" onClick={e=>{if(e.target===e.currentTarget)onCancel();}}>
  <section className="exercise-swap-dialog" role="dialog" aria-modal="true" aria-label="Alternativas de ejercicio">
   <div className="row between"><h2>Cambiar ejercicio</h2><button type="button" onClick={onCancel} aria-label="Cerrar alternativas">✕</button></div>
   <p className="muted">Actual: <strong>{t('ex_'+exerciseId)}</strong>. Estas opciones trabajan el mismo grupo muscular y patrón de movimiento. Elegí una para verificar compatibilidad con tu plan.</p>
   <label>Buscar alternativa<input autoFocus type="search" placeholder="Ej.: press inclinado, mancuernas…" value={search} onChange={e=>setSearch(e.target.value)}/></label>
   {visible.length===0&&<p className="muted">No encontramos alternativas de ese patrón. Probá otra búsqueda.</p>}
   <div className="exercise-swap-options">
    {visible.map(x=><button type="button" key={x.id} disabled={busy} className={selected===x.id?'on':''} onClick={()=>void choose(x.id)}>
      <strong>{t('ex_'+x.id)}</strong><span className="muted small">{x.equipment.map(k=>t(k)).join(', ')} · {t('m_'+x.muscle)}</span>
    </button>)}
   </div>
   {busy&&<p role="status">Verificando compatibilidad…</p>}
   {error&&<p className="warn" role="alert">{error}</p>}
   {preview&&<div className="card"><strong>Alternativa compatible con tu objetivo</strong><p>{preview.explanation}</p>
     <div className="row"><button type="button" className="primary" disabled={busy} onClick={()=>void confirm()}>Confirmar y guardar en mi rutina</button><button type="button" onClick={()=>setPreview(null)}>Elegir otra</button></div>
   </div>}
   <p className="muted small">No se modifica ningún ejercicio hasta que confirmes. Si el plan fue asignado por un profesional, el cambio requiere su revisión.</p>
  </section>
 </div>;
}
