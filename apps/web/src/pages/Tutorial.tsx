import {useEffect,useMemo,useState} from 'react';
import {useApp} from '../ctx';
import {useNav} from '../nav';
type Mode='athlete'|'pro'|'medical'|'admin';
type Step={title:string;body:string;tab?:string;action?:string};
const flows:Record<Mode,Step[]>={
 athlete:[
  {title:'Bienvenido a Fondal Fit',body:'Acá podés organizar tus entrenamientos, caminatas, corridas y alimentación. No necesitás saber de computadoras: vamos a recorrerlo juntos.',tab:'home'},
  {title:'Tu inicio',body:'En Inicio vas a encontrar tu actividad del día, calorías estimadas, lo que ya registraste y sugerencias para continuar.',tab:'home'},
  {title:'Tu evaluación inicial',body:'Respondé las preguntas sobre tu estado físico, antecedentes y objetivos. Podés repetir la evaluación desde tu cuenta. Si tenés una condición médica, consultá con tu profesional.',action:'wizard'},
  {title:'Entrenamiento de fuerza',body:'En Entrenar elegís ejercicios y anotás series, repeticiones y peso. La aplicación conserva tus registros para comparar tu progreso.',tab:'train'},
  {title:'Caminatas y running',body:'En Cardio registrás distancia, tiempo y ritmo. El GPS del navegador puede interrumpirse al bloquear el teléfono; verificá el recorrido antes de guardarlo.',tab:'cardio'},
  {title:'Alimentación',body:'En Alimentación anotás qué comiste. Las calorías son aproximadas y dependen de las porciones. Tu objetivo diario se calcula a partir de la evaluación.',tab:'food'},
  {title:'Más herramientas',body:'En Más encontrás progresos, desafíos, tutor virtual, gimnasios y profesionales. Para compartir datos con un entrenador, primero tenés que autorizarlo.',tab:'more'},
  {title:'¡Ya podés empezar!',body:'Si te olvidás de algo, entrá en Más y elegí Ver tutorial. Podés volver a verlo todas las veces que quieras.',tab:'home'}
 ],
 pro:[
  {title:'Bienvenido al modo entrenador',body:'Podés trabajar con tus alumnos, preparar rutinas y revisar la actividad que ellos decidan compartir.',tab:'students'},
  {title:'Tus alumnos',body:'En Alumnos encontrás los vínculos y el seguimiento de cada persona. El alumno debe aceptar la vinculación y los permisos.',tab:'students'},
  {title:'Diseñar rutinas',body:'En Estudio creás y editás planificaciones. Podés ajustar ejercicios, series, cargas y objetivos de entrenamiento.',tab:'studio'},
  {title:'Administrar gimnasios',body:'En Gimnasios podés crear una sede, invitar profesores y alumnos, y asignar un entrenador responsable.',tab:'gyms'},
  {title:'Aprobar cambios',body:'En Aprobaciones revisás los cambios de planificación que requieran tu intervención.',tab:'approvals'},
  {title:'Tus otras herramientas',body:'Desde Más accedés al directorio, tu perfil y el resto de herramientas. Podés repetir esta guía cuando quieras.',tab:'more'}
 ],
 medical:[
  {title:'Bienvenido al panel de salud',body:'Este espacio permite gestionar tu presentación profesional y ofrecer un medio de contacto. No reemplaza una historia clínica.',tab:'medical_panel'},
  {title:'Perfil profesional',body:'Completá profesión, formación, matrícula, experiencia, modalidad y ubicación aproximada. La publicación requiere verificación.',tab:'medical_panel'},
  {title:'Directorio y consultas',body:'Los usuarios pueden encontrarte en el mapa y contactarte por WhatsApp. Sus laboratorios y datos clínicos no se comparten automáticamente.',tab:'directory'},
  {title:'Privacidad y permisos',body:'Solicitá consentimiento antes de acceder a información de salud. Los estudios y recomendaciones clínicas requieren evaluación profesional.',tab:'settings'}
 ],
 admin:[
  {title:'Bienvenido a Administración',body:'Acá se gestionan los indicadores y funciones administrativas de Fondal Fit.',tab:'admin'},
  {title:'Gestión de perfiles',body:'Revisá la formación y matrícula antes de verificar a un médico, kinesiólogo o entrenador. Pagar nunca debe equivaler a estar verificado.',tab:'admin_panel'},
  {title:'Directorio',body:'Comprobá los perfiles publicados y sus ubicaciones aproximadas. Los usuarios deben poder elegir a quién contactar.',tab:'directory'},
  {title:'Tus otras interfaces',body:'Desde la cuenta podés cambiar entre tus vistas habilitadas sin crear cuentas nuevas ni perder registros.',tab:'settings'}
 ]
};
const storageKey=(id:number,mode:Mode)=>'fondal_tutorial_v1_'+id+'_'+mode;
export function Tutorial({onClose,initial=false}:{onClose:()=>void;initial?:boolean}){
 const {me}=useApp(),nav=useNav(),mode=me.mode as Mode;
 const steps=useMemo(()=>flows[mode]??flows.athlete,[mode]);
 const [index,setIndex]=useState(0);
 const step=steps[index]!;
 const finish=()=>{try{localStorage.setItem(storageKey(me.id,mode),'complete');}catch{/* storage unavailable */}onClose();};
 const visit=()=>{finish();if(step.action)nav.push(step.action);else if(step.tab)nav.go(step.tab);};
 useEffect(()=>{const onKey=(e:KeyboardEvent)=>{if(e.key==='Escape'&&!initial)onClose();};window.addEventListener('keydown',onKey);return()=>window.removeEventListener('keydown',onKey);},[initial,onClose]);
 return <div className="tutorial-backdrop" role="presentation"><section className="tutorial-dialog" role="dialog" aria-modal="true" aria-labelledby="tutorial-heading" aria-describedby="tutorial-body">
  <div className="tutorial-head"><span>GUÍA FONDAL FIT · {mode==='athlete'?'DEPORTISTA':mode==='pro'?'ENTRENADOR':mode==='medical'?'SALUD':'ADMINISTRACIÓN'}</span><button type="button" onClick={finish} aria-label="Cerrar tutorial">✕</button></div>
  <div className="tutorial-progress" role="progressbar" aria-valuemin={1} aria-valuemax={steps.length} aria-valuenow={index+1} aria-label="Progreso del tutorial"><span style={{width:((index+1)/steps.length*100)+'%'}}/></div>
  <p className="muted">Paso {index+1} de {steps.length}</p>
  <h2 id="tutorial-heading">{step.title}</h2><p id="tutorial-body">{step.body}</p>
  <div className="tutorial-actions">
   <button type="button" onClick={finish}>{initial?'Saltear por ahora':'Cerrar'}</button>
   {index>0&&<button type="button" onClick={()=>setIndex(i=>i-1)}>← Atrás</button>}
   <button className="primary" type="button" onClick={()=>index===steps.length-1?finish():setIndex(i=>i+1)}>{index===steps.length-1?'Terminar':'Siguiente →'}</button>
  </div>
  {(step.tab||step.action)&&<button className="tutorial-visit" type="button" onClick={visit}>Ir a esta sección y cerrar la guía</button>}
 </section></div>;
}
export function useTutorialStatus(id:number,mode:Mode){
 const [open,setOpen]=useState(()=>{try{return localStorage.getItem(storageKey(id,mode))!=='complete';}catch{return false;}});
 return {open,show:()=>setOpen(true),hide:()=>setOpen(false)};
}
