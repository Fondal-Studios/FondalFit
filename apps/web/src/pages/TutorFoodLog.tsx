import {useEffect,useRef,useState} from 'react';
import {api} from '../api';
import {foodById,macrosFor} from '@fondal/engine';

type Custom={name:string;kcalPer100:number;proteinPer100:number;carbsPer100:number;fatPer100:number};
type Item={raw:string;name:string;foodId:string|null;custom:Custom|null;grams:number;kcal:number;p:number;c:number;f:number;low:number;high:number;confidence:'high'|'medium'|'low';note:string};
type Interpretation={items:Item[];source:string;total:{kcal:number;p:number;c:number;f:number};low:number;high:number};
const mealTypes=['breakfast','lunch','snack','dinner'] as const;
const mealLabels={breakfast:'Desayuno',lunch:'Almuerzo',snack:'Merienda',dinner:'Cena'};
const guessMeal=():typeof mealTypes[number]=>{const h=new Date().getHours();return h<11?'breakfast':h<16?'lunch':h<20?'snack':'dinner';};
type Recognition={lang:string;interimResults:boolean;onresult:((event:any)=>void)|null;onend:(()=>void)|null;onerror:(()=>void)|null;start:()=>void;stop:()=>void};
const speechConstructor=()=>{const w=window as unknown as {SpeechRecognition?:new()=>Recognition;webkitSpeechRecognition?:new()=>Recognition};return w.SpeechRecognition??w.webkitSpeechRecognition;};

export function TutorFoodLog({tutorName}:{tutorName:string}){
 const [description,setDescription]=useState('');
 const [items,setItems]=useState<Item[]|null>(null);
 const [mealType,setMealType]=useState<typeof mealTypes[number]>(guessMeal);
 const [loading,setLoading]=useState(false);
 const [saving,setSaving]=useState(false);
 const [listening,setListening]=useState(false);
 const [error,setError]=useState('');
 const [success,setSuccess]=useState('');
 const recognizer=useRef<Recognition|null>(null);
 useEffect(()=>()=>{try{recognizer.current?.stop();}catch{}},[]);
 const analyze=async()=>{
  if(!description.trim()||loading)return;
  setLoading(true);setError('');setSuccess('');setItems(null);
  try{
   const result=await api<Interpretation>('POST','/api/nutrition/interpret',{text:description.trim()});
   setItems(result.items.filter(i=>i.grams>0&&(i.foodId||i.custom)));
   if(!result.items.some(i=>i.grams>0&&(i.foodId||i.custom)))setError('No pude identificar alimentos con suficiente información. Probá con nombres y cantidades aproximadas.');
  }catch{setError('No se pudo interpretar la comida. Revisá tu conexión e intentá nuevamente.');}
  finally{setLoading(false);}
 };
 const editGrams=(index:number,grams:number)=>{
  setItems(list=>list?.map((item,i)=>{
   if(i!==index)return item;
   const g=Math.max(1,Math.min(2000,Math.round(grams)));
   const food=item.foodId?foodById(item.foodId):undefined;
   const ratio=g/(item.grams||1);
   const m=food?macrosFor(food,g):item.custom?{
    kcal:Math.round(item.custom.kcalPer100*g/100),
    p:Math.round(item.custom.proteinPer100*g/10)/10,
    c:Math.round(item.custom.carbsPer100*g/10)/10,
    f:Math.round(item.custom.fatPer100*g/10)/10
   }:{kcal:Math.round(item.kcal*ratio),p:item.p*ratio,c:item.c*ratio,f:item.f*ratio};
   return {...item,grams:g,kcal:m.kcal,p:m.p,c:m.c,f:m.f,low:Math.round(item.low*ratio),high:Math.round(item.high*ratio)};
  })??null);
 };
 const listen=()=>{
  if(listening){recognizer.current?.stop();return;}
  const Speech=speechConstructor();
  if(!Speech){setError('El dictado no está disponible en este navegador. Podés escribir o usar el micrófono del teclado.');return;}
  try{
   const r=new Speech();r.lang='es-AR';r.interimResults=false;
   r.onresult=e=>{const phrase=String(e.results?.[0]?.[0]?.transcript??'').trim();if(phrase)setDescription(x=>(x.trim()?x.trim()+'; ':'')+phrase);};
   r.onend=()=>setListening(false);
   r.onerror=()=>{setListening(false);setError('No se pudo usar el micrófono. Revisá los permisos.');};
   recognizer.current=r;setError('');setListening(true);r.start();
  }catch{setListening(false);setError('No se pudo iniciar el dictado.');}
 };
 const total=(items??[]).reduce((sum,item)=>({kcal:sum.kcal+item.kcal,p:sum.p+item.p,c:sum.c+item.c,f:sum.f+item.f,low:sum.low+item.low,high:sum.high+item.high}),{kcal:0,p:0,c:0,f:0,low:0,high:0});
 const save=async()=>{
  if(!items?.length||saving)return;
  setSaving(true);setError('');
  try{
   await api('POST','/api/nutrition/log',{
    mealType,meal:description.trim().slice(0,120),
    items:items.filter(i=>i.foodId).map(i=>({foodId:i.foodId,grams:i.grams})),
    custom:items.filter(i=>i.custom&&!i.foodId).map(i=>({...i.custom!,grams:i.grams})),
    timezoneOffset:new Date().getTimezoneOffset()
   });
   setSuccess('Comida registrada en tu contador y calendario. '+total.kcal+' kcal aproximadas.');
   setItems(null);setDescription('');
  }catch{setError('No se pudo guardar la comida. No se agregó nada al registro.');}
  finally{setSaving(false);}
 };
 return <section className="card" aria-label="Registrar comida con el tutor">
  <h3>Contale a {tutorName} qué comiste</h3>
  <p className="muted">Escribí o dictá lo que comiste. El tutor lo buscará en la base de alimentos, calculará una estimación y te dejará revisarla antes de agregarla.</p>
  <label htmlFor="tutor-food-description">¿Qué comiste?</label>
  <textarea id="tutor-food-description" rows={3} maxLength={600} value={description} onChange={e=>{setDescription(e.target.value);setItems(null);setSuccess('');}} placeholder="Ej.: comí dos huevos, dos tostadas y café con leche"/>
  <div className="row">
   <button type="button" onClick={listen} aria-pressed={listening}>{listening?'Detener dictado':'Dictar comida'}</button>
   <button type="button" className="primary" disabled={!description.trim()||loading||saving} onClick={()=>void analyze()}>{loading?'Analizando…':'Calcular calorías'}</button>
  </div>
  {items!==null&&items.length>0&&<div aria-label="Vista previa del plato">
   <h4>Revisá el plato antes de guardar</h4>
   {items.map((i,index)=><div key={index} className="card">
    <strong>{i.name}</strong> {i.custom&&<span className="muted small">(estimación externa al catálogo)</span>}
    <div className="row"><label>Gramos aproximados <input type="number" min={1} max={2000} step={1} value={i.grams} onChange={e=>editGrams(index,Number(e.target.value)||1)}/></label><span>{i.kcal} kcal · P {i.p.toFixed(1)} g</span><button type="button" onClick={()=>setItems(xs=>xs?.filter((_,j)=>j!==index)??null)}>Quitar</button></div>
    {i.confidence==='low'&&<p className="muted small">Cantidad estimada con baja confianza: revisala.</p>}
   </div>)}
   <p><strong>Total aproximado: {total.kcal} kcal</strong> · Proteínas {total.p.toFixed(1)} g · Carbohidratos {total.c.toFixed(1)} g · Grasas {total.f.toFixed(1)} g</p>
   <p className="muted small">Intervalo orientativo según el reconocimiento inicial: {total.low}–{total.high} kcal. Los valores no representan una medición exacta.</p>
   <label>Momento de la comida <select value={mealType} onChange={e=>setMealType(e.target.value as typeof mealType)}>{mealTypes.map(m=><option key={m} value={m}>{mealLabels[m]}</option>)}</select></label>
   <button type="button" className="primary" disabled={saving} onClick={()=>void save()}>{saving?'Guardando…':'Confirmar y registrar comida'}</button>
  </div>}
  {error&&<p className="warn" role="alert">{error}</p>}
  {success&&<p className="ok" role="status">{success}</p>}
  <p className="muted small">No es una prescripción nutricional. No se registra nada automáticamente: vos confirmás los alimentos y las cantidades.</p>
 </section>;
}
