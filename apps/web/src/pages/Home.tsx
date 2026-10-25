import {CustomBlocks} from './ActivityBlocks';
import { Bar, Loading, useLoad, useT, type Me } from '../ctx';

export function Home({ me, go }: { me: Me; go: (tab: string) => void }) {
  const t = useT();
  const plan = useLoad<{ version?: number; plan: { days: { name: string; kind?: string; items: unknown[]; cardio?: { modality: string; type: string; durationMin: number } }[] } | null }>('/api/plan');
  const nut = useLoad<{ target: { kcal: number } | null; today: { kcal: number } }>('/api/nutrition');
  const prog = useLoad<{ total: number }>('/api/progress');
  const act = useLoad<{ activities: unknown[] }>('/api/activities');
  const gam = useLoad<{ level: number; xp: number; streakWeeks: number }>('/api/gamification');
  const energy=useLoad<{date:string;basalSoFar:number;neatSoFar:number;exerciseKcal:number;burnedSoFar:number;eaten:number;dailyBmr:number;dailyNeatProxy:number;targetBudget:number|null;remaining:number|null;complete:boolean;note:string}>('/api/energy/today?timezoneOffset='+new Date().getTimezoneOffset());
  const daily = useLoad<{date:string;totalKcal:number;estimated:boolean;activities:{id:number;sport:string;started_at:string;duration_sec:number;distance_m:number;avg_pace_sec_km:number;estimated_kcal:number|null;elev_gain_m:number}[]}>('/api/activity/today?timezoneOffset='+new Date().getTimezoneOffset());
  const fmtPace=(sec:number)=>sec>0?`${Math.floor(sec/60)}:${String(Math.round(sec%60)).padStart(2,'0')}`:'—';

  if (!plan.data || !nut.data) return <Loading err={plan.err || nut.err} retry={() => { plan.reload(); nut.reload(); }} />;
  if (!plan.data.plan) return <><HomeEnergy data={energy.data} reload={energy.reload} go={go}/><DailySummary activities={daily.data?.activities??[]} totalKcal={daily.data?.totalKcal??0} estimated={!!daily.data?.estimated} go={go}/><div className="card"><h2>{t('hi')}, {me.name}</h2><p>{t('noPlanYet')}</p><button className="primary" onClick={() => go('wizard')}>{t('createPlan')}</button></div></>;
  const days = plan.data.plan.days;
  const done = (prog.data?.total ?? 0) + (act.data?.activities.length ?? 0);
  const next = days[done % days.length]!;
  const tg = nut.data.target;
  return (
    <>
      <h2>{t('hi')}, {me.name}</h2>
      <HomeEnergy data={energy.data} reload={energy.reload} go={go}/>
      <DailySummary activities={daily.data?.activities??[]} totalKcal={daily.data?.totalKcal??0} estimated={!!daily.data?.estimated} go={go}/>
      <CustomBlocks onSaved={()=>{daily.reload();energy.reload();}}/>
      <div className="card">
        <p className="muted">{(daily.data?.activities.length??0)>0?'Actividad registrada hoy · Próxima sugerencia opcional':t('nextSession')}</p>
        <h3>{next.name} · {next.kind === 'cardio' && next.cardio ? `${t(next.cardio.modality)} · ${t('ct_' + next.cardio.type)} · ${next.cardio.durationMin} ${t('minutes_short')}` : `${next.items.length} ${t('ex_count')}`}</h3>
        <button className="primary" onClick={() => go(next.kind === 'cardio' ? 'cardio' : 'train')}>{t('startNow')}</button>
      </div>
      {tg && <div className="card" onClick={() => go('food')} role="button" tabIndex={0}>
        <p>{t('eaten')}: <b>{nut.data.today.kcal}</b> / {tg.kcal} {t('kcalShort')}</p><Bar pct={(nut.data.today.kcal / tg.kcal) * 100} />
        <button className="link">{t('seeMenus')} →</button></div>}
      {gam.data && <p className="muted">{t('level')} {gam.data.level} · {gam.data.xp} XP · {t('streak')}: {gam.data.streakWeeks}</p>}
    </>
  );
}

function DailySummary({activities,totalKcal,estimated,go}:{activities:{id:number;sport:string;started_at:string;duration_sec:number;distance_m:number;avg_pace_sec_km:number;estimated_kcal:number|null;elev_gain_m:number}[];totalKcal:number;estimated:boolean;go:(tab:string)=>void}){
 const date=new Date().toLocaleDateString('es-AR',{weekday:'long',day:'numeric',month:'long'});
 const fmtPace=(sec:number)=>sec>0?`${Math.floor(sec/60)}:${String(Math.round(sec%60)).padStart(2,'0')}`:'—';
 return <section className="card daily-home"><div className="row between"><div><p className="muted">TU ACTIVIDAD DIARIA</p><h2 style={{textTransform:'capitalize'}}>{date}</h2></div><button onClick={()=>go('cardio')}>Ver cardio →</button></div>
  {activities.length?<><p className="daily-kcal">≈{totalKcal} kcal <small>{estimated?'estimadas en actividades registradas':'sin estimación de peso'}</small></p>
   {activities.map(a=><div className="daily-activity" key={a.id}><strong>{a.sport==='run'?'Corrida':a.sport==='bike'?'Bicicleta':'Caminata'}</strong><p>{(a.distance_m/1000).toFixed(2)} km · {Math.floor(a.duration_sec/60)} min · ritmo {fmtPace(a.avg_pace_sec_km)} min/km</p><p>Desnivel +{a.elev_gain_m} m · {a.estimated_kcal===null?'Calorías sin estimar':`≈${a.estimated_kcal} kcal`}</p></div>)}
  </>:<><p className="muted">Todavía no registraste actividades hoy.</p><button className="primary" onClick={()=>go('cardio')}>Registrar una caminata o corrida</button></>}
  <div className="daily-suggestion"><h3>{activities.length?'Ya hiciste actividad hoy':'Sugerencias para hoy'}</h3><p>{activities.length?'Tu corrida ya quedó contabilizada. Si estás recuperado podés completar una sesión corta de fuerza o calistenia; también podés descansar.':'Podés iniciar una caminata, correr o hacer fuerza. Elegí según tu objetivo y recuperación.'}</p><div className="row"><button onClick={()=>go('train')}>Mi entrenamiento</button><button onClick={()=>go('food')}>Ver alimentación</button></div></div>
 </section>;
}

function HomeEnergy({data,reload,go}:{data:{basalSoFar:number;neatSoFar:number;exerciseKcal:number;burnedSoFar:number;eaten:number;dailyBmr:number;dailyNeatProxy:number;targetBudget:number|null;remaining:number|null;complete:boolean;note:string}|null;reload:()=>void;go:(tab:string)=>void}){
 if(!data)return <section className="card"><h2>Balance calórico de hoy</h2><p className="muted">Cargando tu energía diaria…</p></section>;
 const fmt=(v:number)=>Math.round(v).toLocaleString('es-AR');
 return <section className="card home-energy">
   <div className="row between"><div><p className="muted">ENERGÍA DE HOY</p><h2>Tu balance calórico</h2></div><button onClick={reload} aria-label="Actualizar balance calórico">Actualizar ↻</button></div>
   <div className="energy-hero"><div><small>Gasto estimado hasta ahora</small><strong>{fmt(data.burnedSoFar)} <small>kcal</small></strong></div><div><small>Disponible para comer hoy*</small><strong>{data.remaining===null?'—':fmt(data.remaining)} <small>kcal</small></strong></div></div>
   <div className="energy-breakdown"><div><span>Metabolismo basal acumulado</span><strong>{fmt(data.basalSoFar)} kcal</strong></div><div><span>NEAT y actividad cotidiana estimados</span><strong>{fmt(data.neatSoFar)} kcal</strong></div><div><span>Entrenamientos registrados</span><strong>{fmt(data.exerciseKcal)} kcal</strong></div><div><span>Comidas registradas</span><strong>−{fmt(data.eaten)} kcal</strong></div></div>
   <p className="muted">BMR diario: ≈{fmt(data.dailyBmr)} kcal. Actividad cotidiana diaria estimada: ≈{fmt(data.dailyNeatProxy)} kcal. Estos dos valores se acumulan durante el día; el entrenamiento se suma cuando lo registrás.</p>
   {data.targetBudget!==null?<p className="home-energy-goal">Presupuesto diario orientativo según objetivo y actividad registrada: <strong>{fmt(data.targetBudget)} kcal</strong>.</p>:<p className="warn">Completá tu evaluación física para calcular tu presupuesto energético.</p>}
   <div className="row"><button className="primary" onClick={()=>go('food')}>Agregar comida</button><button onClick={()=>go('cardio')}>Registrar actividad</button></div>
   <details><summary>¿Qué significan BMR, NEAT y el saldo?</summary><p>BMR es el gasto basal en reposo. NEAT es el movimiento cotidiano fuera del deporte; aquí usamos una aproximación por factor de actividad, no una medición directa. *El saldo para comer proyecta el día completo y no equivale a calorías que ya hayas gastado. Puede variar y no se debe interpretar como una autorización automática para restringir la comida.</p><p className="muted">{data.note}</p></details>
 </section>;
}
