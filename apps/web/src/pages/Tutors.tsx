import {useEffect,useState} from 'react';
import {api} from '../api';
import {Page} from '../nav';
import {TutorFoodLog} from './TutorFoodLog';
import {TutorExerciseSwap} from './TutorExerciseSwap';

type Tutor={id:string;name:string;role:string;style:string;priceXp:number;sprite:string;owned:boolean};
type Catalog={tutors:Tutor[];selectedId:string;xp:number;xpEarned:number;aiConfigured:boolean};
const sprite=(name:string)=>'https://raw.githubusercontent.com/Fondal-Studios/La-Horda/main/assets/sprites/champions/'+encodeURIComponent(name)+'/atlas.png';

export function TutorLounge(){
 const [catalog,setCatalog]=useState<Catalog|null>(null);
 const [loading,setLoading]=useState(true);
 const [error,setError]=useState('');
 const [busy,setBusy]=useState(false);
 const [question,setQuestion]=useState('');
 const [chat,setChat]=useState<{role:'user'|'assistant';text:string}[]>([]);
 const refresh=()=>api<Catalog>('GET','/api/tutors').then(setCatalog).catch(()=>setError('No pudimos cargar tus tutores.')).finally(()=>setLoading(false));
 useEffect(()=>{refresh();},[]);
 const choose=async(id:string)=>{
  setError('');try{await api('POST','/api/tutors/select',{id});setChat([]);refresh();}catch{setError('No se pudo elegir el tutor.');}
 };
 const unlock=async(id:string)=>{
  setError('');setBusy(true);try{await api('POST','/api/tutors/unlock',{id});refresh();}catch{setError('No hay experiencia suficiente o no se pudo desbloquear.');}finally{setBusy(false);}
 };
 const ask=async(message:string)=>{
  if(!message.trim()||busy)return;
  setError('');setBusy(true);setQuestion('');setChat(v=>[...v,{role:'user',text:message}]);
  try{const r=await api<{reply:string}>('POST','/api/tutors/ask',{message});setChat(v=>[...v,{role:'assistant',text:r.reply}]);}
  catch{setError(catalog?.aiConfigured?'El tutor no pudo responder ahora. Revisá tus consentimientos e intentá nuevamente.':'La IA todavía no está conectada. Tu tutor ya está elegido.');}
  finally{setBusy(false);}
 };
 const selected=catalog?.tutors.find(t=>t.id===catalog.selectedId);
 return <Page title="Mis tutores de Fondal Fit" sub="Personajes inspirados en La Horda · consejos educativos sobre actividad, alimentos y recuperación">
  <section className="card">
   <h3>Elegí tu compañero</h3>
   <p className="muted">Tu primer tutor es gratis. Podés cambiar entre los que tenés desbloqueados. Ganás experiencia completando días con actividad registrada; no se premia comer menos ni entrenar de más.</p>
   {loading&&<p role="status">Cargando tutores…</p>}
   {catalog&&<p><strong>{catalog.xp} XP disponibles</strong> · {catalog.xpEarned} XP obtenidos</p>}
   <div className="tutor-roster">
    {catalog?.tutors.map(t=><article key={t.id} className="card" style={{textAlign:'center',border:t.id===catalog.selectedId?'2px solid currentColor':undefined}}>
      <div className="tutor-card-sprite" aria-hidden="true" style={{backgroundImage:'url('+sprite(t.sprite)+')'}}/>
      <h3>{t.name}</h3><p className="muted small">{t.role}</p>
      {t.owned?<button disabled={busy||t.id===catalog.selectedId} onClick={()=>void choose(t.id)}>{t.id===catalog.selectedId?'Elegido':'Elegir tutor'}</button>:<button disabled={busy||catalog.xp<t.priceXp} onClick={()=>void unlock(t.id)}>Desbloquear · {t.priceXp} XP</button>}
    </article>)}
   </div>
  </section>
  <TutorFoodLog tutorName={selected?.name??'tu tutor'}/>
  <TutorExerciseSwap/>
  <section className="card">
   <h3>Charlá con {selected?.name??'tu tutor'}</h3>
   <p className="muted">Podés consultar sobre ideas de comidas, información de calorías, entrenamiento, descanso y constancia. Ninguna sugerencia es una dieta prescrita ni modifica tu programa por sí sola.</p>
   <div className="chips">{['¿Qué opciones de comida puedo explorar para mi objetivo?','¿Cómo alternar fuerza y descanso?','¿Qué significa un día normocalórico?'].map(q=><button key={q} className="chip" disabled={busy||!catalog?.aiConfigured} onClick={()=>void ask(q)}>{q}</button>)}</div>
   <div className="chat" aria-live="polite">{chat.map((m,i)=><p key={i} className={m.role}>{m.text}</p>)}{busy&&<p className="muted">Preparando una sugerencia…</p>}</div>
   <form className="row" onSubmit={e=>{e.preventDefault();void ask(question);}}><input aria-label="Preguntale a tu tutor" maxLength={1200} value={question} onChange={e=>setQuestion(e.target.value)} placeholder="Preguntale a tu tutor…"/><button className="primary" disabled={!catalog?.aiConfigured||busy||!question.trim()}>Enviar</button></form>
   {!catalog?.aiConfigured&&<p className="muted">Las preguntas se habilitarán cuando esté configurada la conexión segura con Anthropic.</p>}
   {error&&<p role="alert" className="warn">{error}</p>}
   <p className="muted small">Si registraste una enfermedad o tomás medicación, consultá con tu médico o nutricionista responsable antes de seguir sugerencias personalizadas. Los tutores no diagnostican ni prescriben.</p>
  </section>
 </Page>;
}
