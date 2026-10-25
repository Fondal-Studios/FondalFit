import type {GeoPoint} from '@fondal/engine';
import {haversine} from '@fondal/engine';
const RAD=Math.PI/180;
const project=(p:GeoPoint,z:number)=>{const n=256*2**z,lat=Math.max(-85,Math.min(85,p.lat))*RAD;return {x:(p.lon+180)/360*n,y:(1-Math.log(Math.tan(lat)+1/Math.cos(lat))/Math.PI)/2*n};};
export function TrackMap({points}:{points:GeoPoint[]}){
 if(!points.length)return <p className="muted">El mapa aparecerá cuando el GPS obtenga la primera ubicación.</p>;
 const minLat=Math.min(...points.map(p=>p.lat)),maxLat=Math.max(...points.map(p=>p.lat)),minLon=Math.min(...points.map(p=>p.lon)),maxLon=Math.max(...points.map(p=>p.lon));
 const middle={lat:(minLat+maxLat)/2,lon:(minLon+maxLon)/2,t:0};
 const spread=Math.max(maxLat-minLat,(maxLon-minLon)*Math.cos(middle.lat*RAD));
 const z=Math.max(8,Math.min(17,Math.floor(Math.log2(0.006/Math.max(spread,0.00001))+13)));
 const center=project(middle,z);const w=350,h=230,n=2**z;
 const cx=Math.floor(center.x/256),cy=Math.floor(center.y/256);
 const tileNodes=[] as {x:number;y:number;left:number;top:number}[];
 for(let dx=-2;dx<=2;dx++)for(let dy=-2;dy<=2;dy++){const x=cx+dx,y=cy+dy;if(y>=0&&y<n)tileNodes.push({x:(x+n)%n,y,left:x*256-center.x+w/2,top:y*256-center.y+h/2});}
 const xy=(p:GeoPoint)=>{const projected=project(p,z);return {x:projected.x-center.x+w/2,y:projected.y-center.y+h/2};};
 const segments:{a:GeoPoint;b:GeoPoint;gap:boolean}[]=[];
 for(let i=1;i<points.length;i++){const a=points[i-1]!,b=points[i]!;segments.push({a,b,gap:b.t-a.t>30000});}
 const end=xy(points[points.length-1]!);
 return <div className="track-map" role="img" aria-label="Mapa OpenStreetMap del recorrido con líneas verdes medidas y naranjas sin señal">
   <div className="track-map-view">
     {tileNodes.map(tile=><img key={tile.x+'-'+tile.y} alt="" draggable={false} loading="lazy" src={`https://tile.openstreetmap.org/${z}/${tile.x}/${tile.y}.png`} style={{position:'absolute',left:tile.left,top:tile.top,width:256,height:256,maxWidth:'none'}}/>)}
     <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" aria-hidden="true" style={{position:'absolute',inset:0,width:'100%',height:'100%'}}>
       {segments.map((part,i)=>{const a=xy(part.a),b=xy(part.b);return <line key={i} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={part.gap?'#ed982a':'#4ade80'} strokeWidth="4" strokeDasharray={part.gap?'7 6':undefined} strokeLinecap="round"/>;})}
       <circle cx={end.x} cy={end.y} r="6" stroke="#fff" strokeWidth="2" fill="#3274d9"/>
     </svg>
   </div><small>© <a target="_blank" rel="noopener noreferrer" href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a> · Naranja = tramo no medido · Línea recta mínima, no ruta real</small>
 </div>;
}
export function plausibleGap(previous:GeoPoint,next:GeoPoint,sport:'run'|'walk'|'bike'){
 const seconds=(next.t-previous.t)/1000,meters=haversine(previous,next);
 return {seconds,meters,allowed:seconds>=30&&seconds<=21600&&meters>=15&&meters/seconds<=({run:6,walk:3,bike:22}[sport])};
}
