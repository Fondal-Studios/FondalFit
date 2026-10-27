/** One source for energy estimates. These numbers are not metabolic measurements. */
export type ActivityFactor=1.2|1.375|1.55|1.725;
export interface EnergyInputs {bmr:number;activity:ActivityFactor;intake:number;extraActiveKcal:number;complete:boolean}
export function computeEnergyDay(v:EnergyInputs){
 const maintenance=Math.round(v.bmr*v.activity);
 // Baseline already includes habitual exercise. Extra sessions must NOT automatically be added twice.
 const expenditure=maintenance;
 const balance=v.complete?Math.round(v.intake-expenditure):null;
 const ratio=balance===null?null:balance/Math.max(1,maintenance);
 const band=ratio===null?'unknown':ratio>0.05?'red':ratio>0?'orange':ratio>=-0.05?'yellow':ratio>=-0.15?'green':ratio>=-0.25?'blue':'violet';
 return {maintenance,expenditure,balance,band,exerciseReported:v.extraActiveKcal,model:'habitual_activity_included' as const};
}
export function weeklyBalance(days:{date:string;complete:boolean;balance:number|null}[]){
 const groups=new Map<string,{weekStart:string;days:number;balance:number}>();
 const seen=new Set<string>();
 for(const day of days){
  if(seen.has(day.date))continue;
  seen.add(day.date);
  if(!day.complete||day.balance===null)continue;
  const d=new Date(day.date+'T12:00:00Z');d.setUTCDate(d.getUTCDate()-((d.getUTCDay()+6)%7));
  const key=d.toISOString().slice(0,10),w=groups.get(key)??{weekStart:key,days:0,balance:0};
  w.days++;w.balance+=day.balance;groups.set(key,w);
 }
 return [...groups.values()].map(w=>({...w,complete:w.days===7,balance:w.days===7?w.balance:null}));
}
export function localDate(iso:string,offsetMinutes:number){return new Date(Date.parse(iso)-offsetMinutes*60000).toISOString().slice(0,10);}
