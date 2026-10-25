import {useEffect,useState} from 'react';
type View='front'|'side'|'back';
const labels:Record<View,string>={front:'Frente',side:'Perfil',back:'Espalda'};
export function BodyPhotoGuide(){
 const [images,setImages]=useState<Partial<Record<View,string>>>({});
 const [baseline,setBaseline]=useState<Partial<Record<View,string>>>({});
 const [status,setStatus]=useState('');
 const add=(view:View,file?:File)=>{
  if(!file)return;
  if(!file.type.startsWith('image/')||file.size>12_000_000){setStatus('Elegí una foto JPG, PNG o HEIC de hasta 12 MB.');return;}
  const url=URL.createObjectURL(file);
  setImages(v=>{if(v[view])URL.revokeObjectURL(v[view]!);return {...v,[view]:url};});
 };
 useEffect(()=>()=>{Object.values(images).forEach(x=>x&&URL.revokeObjectURL(x));},[]);
 const compare=()=>{setBaseline(images);setImages({});setStatus('Primera serie lista para comparar en esta sesión. No se subieron imágenes al servidor.');};
 const reset=()=>{Object.values(images).forEach(x=>x&&URL.revokeObjectURL(x));Object.values(baseline).forEach(x=>x&&URL.revokeObjectURL(x));setImages({});setBaseline({});setStatus('Fotos descartadas del visor.');};
 return <section className="card photo-guide">
   <h2>Seguimiento corporal con fotos</h2>
   <p className="muted">Beta privada: tomá fotos opcionales y estandarizadas para comparar cambios visibles. No calculamos porcentaje de grasa ni perímetros a partir de una foto sin un modelo validado.</p>
   <div className="photo-instructions"><strong>Para comparar de forma consistente</strong><p>Usá la misma iluminación, distancia, cámara, ropa y postura. Sin filtros ni poses forzadas. Tomá las fotos en un espacio privado. No hace falta mostrar la cara.</p></div>
   <div className="photo-views">{(['front','side','back'] as View[]).map(view=><div className="photo-view" key={view}><strong>{labels[view]}</strong>
     {baseline[view]&&<><small>Referencia</small><img src={baseline[view]} alt={'Foto anterior: '+labels[view]}/></>}
     {images[view]&&<><small>Actual</small><img src={images[view]} alt={'Foto actual: '+labels[view]}/></>}
     <label>Elegir foto de {labels[view].toLowerCase()}<input type="file" accept="image/*" capture="environment" onChange={e=>add(view,e.target.files?.[0])}/></label>
   </div>)}</div>
   <div className="row"><button disabled={!Object.keys(images).length} onClick={compare}>Usar como referencia</button><button onClick={reset}>Descartar fotos</button></div>
   {status&&<p role="status">{status}</p>}
   <p className="muted">Las imágenes se visualizan solo en este dispositivo y esta sesión: no se envían ni se guardan en tu cuenta. Para evolución longitudinal persistente se necesita almacenamiento cifrado, consentimiento específico y control de eliminación.</p>
 </section>;
}
