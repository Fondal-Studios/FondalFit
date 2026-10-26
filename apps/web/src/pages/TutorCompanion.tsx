import {useEffect,useState} from 'react';
import {api} from '../api';
type Tutor={id:string;name:string;sprite:string;owned:boolean};
type TutorInfo={tutors:Tutor[];selectedId:string;aiConfigured:boolean};
const hints:Record<string,string[]>={
 home:['¡Buen día! Un registro aproximado de comidas puede ayudarte a observar hábitos sin obsesionarte con números.','Tu progreso no depende de un solo día. Priorizá la constancia y escuchá las señales de tu cuerpo.'],
 train:['Antes de entrenar, entrá en calor gradualmente y adaptá la carga a cómo te sentís.','Si estás muy fatigado o dolorido, consultá tu plan y considerá recuperar antes de subir la carga.'],
 cardio:['Elegí una intensidad que puedas sostener de acuerdo con tu nivel y las indicaciones de tu plan.','Tomá agua de acuerdo con tu sed, el clima y la duración de la actividad.'],
 food:['Podés dictarme tu comida y estimar sus nutrientes antes de guardarla.','Los números son aproximados: las preparaciones y porciones cambian las calorías.'],
 more:['Podés revisar tus registros y objetivos cuando quieras.'],default:['¿Tenés dudas sobre entrenamiento, alimentación o descanso? Puedo ayudarte con información general.']
};
export function TutorCompanion({tab,onOpen}:{tab:string;onOpen:()=>void}){
 const [info,setInfo]=useState<TutorInfo|null>(null);
 const [expanded,setExpanded]=useState(false);
 const [question,setQuestion]=useState('');
 const [reply,setReply]=useState('');
 const [sending,setSending]=useState(false);
 const [error,setError]=useState('');
 useEffect(()=>{let live=true;api<TutorInfo>('GET','/api/tutors').then(r=>{if(live)setInfo(r)}).catch(()=>{});return()=>{live=false}},[tab]);
 const tutor=info?.tutors.find(t=>t.id===info.selectedId);
 const name=tutor?.name??'Tu tutor';
 const tip=(hints[tab]??hints.default)[new Date().getDate()%((hints[tab]??hints.default).length)]!;
 const ask=async()=>{
  if(!question.trim()||sending)return;
  setSending(true);setError('');setReply('');
  try{const r=await api<{reply:string}>('POST','/api/tutors/ask',{message:question});setReply(r.reply);setQuestion('');}
  catch{setError(info?.aiConfigured?'No pude responder ahora. Podés probar desde Mis tutores.':'La IA conversacional todavía no está disponible. Mientras tanto, podés utilizar las sugerencias generales de la aplicación.');}
  finally{setSending(false);}
 };
 return <aside className={'tutor-companion '+(tab==='home'?'tutor-companion-home':'')} aria-label="Tu tutor siempre disponible">
  <div className="tutor-companion-head">
   <div className="tutor-mini-sprite" aria-hidden="true" style={{backgroundImage:'url(https://raw.githubusercontent.com/Fondal-Studios/La-Horda/main/assets/sprites/champions/'+(tutor?.sprite==='mago'?'mago':'tanque')+'/atlas.png)'}}/>
   <div className="tutor-companion-copy"><strong>{name} te acompaña</strong><p>{tip}</p></div>
  </div>
  <div className="tutor-companion-actions">
   <button type="button" className="primary" onClick={()=>setExpanded(x=>!x)} aria-expanded={expanded}>{expanded?'Cerrar consulta':'Preguntarle a mi tutor'}</button>
   <button type="button" onClick={onOpen}>Ver tutores y tienda</button>
  </div>
  {expanded&&<div className="tutor-companion-chat"><form onSubmit={e=>{e.preventDefault();void ask()}}><label htmlFor="tutor-quick-question">¿Qué querés consultar?</label><div className="row"><input id="tutor-quick-question" maxLength={1200} value={question} onChange={e=>setQuestion(e.target.value)} placeholder="Comidas, ejercicio, descanso…"/><button type="submit" disabled={sending||!question.trim()||!info?.aiConfigured}>Enviar</button></div></form>{reply&&<p role="status">{reply}</p>}{error&&<p className="warn" role="alert">{error}</p>}{!info?.aiConfigured&&<p className="muted small">Las respuestas de IA se habilitarán cuando Anthropic esté configurado. Las sugerencias generales siguen disponibles.</p>}<p className="muted small">Sugerencias educativas, no prescripciones médicas o nutricionales.</p></div>}
 </aside>;
}
