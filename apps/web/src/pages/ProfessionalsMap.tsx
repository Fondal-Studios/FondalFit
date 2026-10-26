import {useEffect,useMemo,useRef,useState} from 'react';
export type MappableProfessional={id:number;category:string;displayName:string;specialty:string;lat:number|null;lon:number|null;city:string;area:string;verified:boolean};
const clamp=(n:number,min:number,max:number)=>Math.min(max,Math.max(min,n));
const radians=(degrees:number)=>degrees*Math.PI/180;
const project=(lat:number,lon:number,z:number)=>{
 const n=256*2**z,phi=radians(clamp(lat,-85,85));
 return {x:(lon+180)/360*n,y:(1-Math.log(Math.tan(phi)+1/Math.cos(phi))/Math.PI)/2*n};
};
export function ProfessionalsMap({items,selected,onSelect}:{items:MappableProfessional[];selected:string|null;onSelect:(key:string)=>void}){
 const container=useRef<HTMLDivElement>(null);
 const [width,setWidth]=useState(320),[adjust,setAdjust]=useState(0);
 useEffect(()=>{const element=container.current;if(!element)return;const update=()=>setWidth(element.clientWidth||320);update();
  if(!('ResizeObserver' in window))return;const observer=new ResizeObserver(update);observer.observe(element);return()=>observer.disconnect();
 },[]);
 const mapped=useMemo(()=>items.filter(p=>p.lat!==null&&p.lon!==null&&Number.isFinite(p.lat)&&Number.isFinite(p.lon)),[items]);
 const base=useMemo(()=>{
  if(!mapped.length)return {lat:-26.074,lon:-65.977,zoom:12};
  const lats=mapped.map(p=>p.lat!),lons=mapped.map(p=>p.lon!);
  const minLat=Math.min(...lats),maxLat=Math.max(...lats),minLon=Math.min(...lons),maxLon=Math.max(...lons);
  const lat=(minLat+maxLat)/2,lon=(minLon+maxLon)/2;
  let zoom=15;for(;zoom>4;zoom--){const a=project(minLat,minLon,zoom),b=project(maxLat,maxLon,zoom);
   if(Math.abs(b.x-a.x)<Math.max(width-90,180)&&Math.abs(a.y-b.y)<250)break;
  }
  return {lat,lon,zoom};
 },[mapped,width]);
 const zoom=clamp(base.zoom+adjust,3,18),cx=project(base.lat,base.lon,zoom),height=330;
 const tiles:{x:number;y:number;left:number;top:number}[]=[];
 const n=2**zoom,x0=Math.floor(cx.x/256),y0=Math.floor(cx.y/256);
 for(let dx=-2;dx<=2;dx++)for(let dy=-2;dy<=2;dy++){
  const x=x0+dx,y=y0+dy;if(y>=0&&y<n)tiles.push({x:(x+n)%n,y,left:(x0+dx)*256-cx.x+width/2,top:y*256-cx.y+height/2});
 }
 return <section className="professional-map-container"><div className="row between"><h3>Buscar en el mapa</h3><div className="row"><button type="button" aria-label="Alejar mapa" onClick={()=>setAdjust(v=>clamp(v-1,-8,3))}>−</button><button type="button" aria-label="Acercar mapa" onClick={()=>setAdjust(v=>clamp(v+1,-8,3))}>+</button></div></div>
  <div className="professional-map" ref={container} style={{height}} aria-label="Mapa de profesionales verificados">
   {tiles.map(t=><img key={zoom+'-'+t.x+'-'+t.y} alt="" loading="lazy" draggable={false} src={`https://tile.openstreetmap.org/${zoom}/${t.x}/${t.y}.png`} style={{left:t.left,top:t.top}}/>)}
   {mapped.map(p=>{const xy=project(p.lat!,p.lon!,zoom),left=xy.x-cx.x+width/2,top=xy.y-cx.y+height/2,key=p.id+'-'+p.category;
    if(left<0||left>width||top<0||top>height)return null;
    return <button key={key} type="button" style={{left,top}} className={'professional-pin '+(selected===key?'selected':'')} title={p.displayName+' · '+p.specialty} aria-label={'Ver '+p.displayName} onClick={()=>onSelect(key)}>{p.category==='medical'?'✚':'●'}</button>;
   })}
  </div>
  <div className="professional-map-credit">© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap contributors</a>. Ubicaciones aproximadas declaradas por cada profesional.</div>
  {!mapped.length&&<p className="muted">Todavía no hay profesionales verificados que hayan publicado su ubicación en el mapa. Podés buscar por ciudad y ver los perfiles disponibles.</p>}
  {mapped.length>0&&<p className="muted">{mapped.length} profesionales con ubicación aproximada. Tocá un marcador para destacar su ficha.</p>}
 </section>;
}
