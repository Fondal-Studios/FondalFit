import type { CSSProperties } from 'react';
export type GPSPoint={lat:number;lon:number;at:number};
export function distanceMeters(a:GPSPoint,b:GPSPoint):number{
 const toRad=Math.PI/180,lat=(b.lat-a.lat)*toRad,lon=(b.lon-a.lon)*toRad;
 const h=Math.sin(lat/2)**2+Math.cos(a.lat*toRad)*Math.cos(b.lat*toRad)*Math.sin(lon/2)**2;
 return 12742000*Math.asin(Math.min(1,Math.sqrt(h)));
}
/** An unknown gap is at least this straight-line distance. It is not the actual traveled route. */
export function missingGPSGap(a:GPSPoint,b:GPSPoint){
 const seconds=(b.at-a.at)/1000;
 const meters=distanceMeters(a,b);
 return {seconds,meters,plausible:seconds>=30&&seconds<=21600&&meters/seconds<=6&&meters<=30000};
}
function mercator(point:GPSPoint,z:number){
 const scale=256*2**z,lat=Math.max(-85,Math.min(85,point.lat)),rad=lat*Math.PI/180;
 return{x:(point.lon+180)/360*scale,y:(1-Math.log(Math.tan(rad)+1/Math.cos(rad))/Math.PI)/2*scale};
}
export function RunningMap({points,gap}:{points:GPSPoint[];gap?:{from:GPSPoint;to:GPSPoint}|null}){
 const all=[...points,...(gap?[gap.from,gap.to]:[])];
 if(!all.length)return <div className="card"><p className="muted">El mapa aparecerá al adquirir señal GPS.</p></div>;
 const mid={lat:(Math.min(...all.map(p=>p.lat))+Math.max(...all.map(p=>p.lat)))/2,lon:(Math.min(...all.map(p=>p.lon))+Math.max(...all.map(p=>p.lon)))/2,at:0};
 const extent=Math.max(...all.map(p=>Math.max(Math.abs(p.lat-mid.lat),Math.abs((p.lon-mid.lon)*Math.cos(mid.lat*Math.PI/180)))));
 const zoom=Math.max(7,Math.min(16,Math.floor(Math.log2(0.011/Math.max(extent,0.0001))+12)));
 const center=mercator(mid,zoom),width=360,height=240;
 const centerTileX=Math.floor(center.x/256),centerTileY=Math.floor(center.y/256);
 const tiles=[] as {x:number;y:number;left:number;top:number}[];
 for(let dx=-2;dx<=2;dx++)for(let dy=-2;dy<=2;dy++){
  const x=centerTileX+dx,y=centerTileY+dy,n=2**zoom;
  if(y>=0&&y<n)tiles.push({x:(x%n+n)%n,y,left:x*256-center.x+width/2,top:y*256-center.y+height/2});
 }
 const xy=(p:GPSPoint)=>{const v=mercator(p,zoom);return [v.x-center.x+width/2,v.y-center.y+height/2] as const;};
 const segments=points.reduce<GPSPoint[][]>((arr,p)=>{const last=arr[arr.length-1];if(!last||!last.length||p.at-last[last.length-1]!.at>30000)arr.push([p]);else last.push(p);return arr;},[]);
 const uncertainPairs=points.slice(1).flatMap((p,i)=>p.at-points[i]!.at>30000?[{from:points[i]!,to:p}]:[]);
 const missing=gap?{a:xy(gap.from),b:xy(gap.to)}:null;
 return <div className="running-map" role="img" aria-label="Mapa cartográfico del trayecto aproximado"><div className="running-map-tiles">
  {tiles.map(t=><img key={t.x+'-'+t.y} src={`https://tile.openstreetmap.org/${zoom}/${t.x}/${t.y}.png`} alt="" loading="lazy" draggable={false} style={{left:t.left+'px',top:t.top+'px'} as CSSProperties}/>)}
  <svg viewBox={`0 0 ${width} ${height}`} aria-hidden="true" preserveAspectRatio="none">
    {segments.filter(segment=>segment.length>1).map((segment,i)=><polyline key={i} points={segment.map(p=>xy(p).join(',')).join(' ')} fill="none" stroke="#2d9547" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round"/>)}
    {uncertainPairs.map((pair,i)=><line key={'gap-'+i} x1={xy(pair.from)[0]} y1={xy(pair.from)[1]} x2={xy(pair.to)[0]} y2={xy(pair.to)[1]} stroke="#b9762a" strokeWidth="3" strokeDasharray="7 5"/>)}
    {missing&&<line x1={missing.a[0]} y1={missing.a[1]} x2={missing.b[0]} y2={missing.b[1]} stroke="#b9762a" strokeWidth="3" strokeDasharray="7 5"/>}
    {points.length>0&&<circle cx={xy(points[points.length-1]!)[0]} cy={xy(points[points.length-1]!)[1]} r="6" fill="#1750b7" stroke="white" strokeWidth="2"/>}
  </svg>
 </div><small>© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap contributors</a> · Línea naranja: tramo desconocido, no camino medido</small></div>;
}
