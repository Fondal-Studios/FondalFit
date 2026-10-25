import { Bar, Loading, useLoad, useT, type Me } from '../ctx';

export function Home({ me, go }: { me: Me; go: (tab: string) => void }) {
  const t = useT();
  const plan = useLoad<{ version?: number; plan: { days: { name: string; kind?: string; items: unknown[]; cardio?: { modality: string; type: string; durationMin: number } }[] } | null }>('/api/plan');
  const nut = useLoad<{ target: { kcal: number } | null; today: { kcal: number } }>('/api/nutrition');
  const prog = useLoad<{ total: number }>('/api/progress');
  const act = useLoad<{ activities: unknown[] }>('/api/activities');
  const gam = useLoad<{ level: number; xp: number; streakWeeks: number }>('/api/gamification');
  const daily = useLoad<{date:string;totalKcal:number;estimated:boolean;activities:{id:number;sport:string;started_at:string;duration_sec:number;distance_m:number;avg_pace_sec_km:number;estimated_kcal:number|null;elev_gain_m:number}[]}>('/api/activity/today?timezoneOffset='+new Date().getTimezoneOffset());
  const fmtPace=(sec:number)=>sec>0?`${Math.floor(sec/60)}:${String(Math.round(sec%60)).padStart(2,'0')}`:'—';

  if (!plan.data || !nut.data) return <Loading err={plan.err || nut.err} retry={() => { plan.reload(); nut.reload(); }} />;
  if (!plan.data.plan) return <><DailySummary activities={daily.data?.activities??[]} totalKcal={daily.data?.totalKcal??0} estimated={!!daily.data?.estimated} go={go}/><div className="card"><h2>{t('hi')}, {me.name}</h2><p>{t('noPlanYet')}</p><button className="primary" onClick={() => go('wizard')}>{t('createPlan')}</button></div></>;
  const days = plan.data.plan.days;
  const done = (prog.data?.total ?? 0) + (act.data?.activities.length ?? 0);
  const next = days[done % days.length]!;
  const tg = nut.data.target;
  return (
    <>
      <h2>{t('hi')}, {me.name}</h2>
      <DailySummary activities={daily.data?.activities??[]} totalKcal={daily.data?.totalKcal??0} estimated={!!daily.data?.estimated} go={go}/>
      <div className="card">
        <p className="muted">{t('nextSession')}</p>
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
  <div className="daily-suggestion"><h3>Sugerencias para hoy</h3><p>Después de correr podés hacer un bloque corto de dominadas y flexiones, ajustando el esfuerzo según tu recuperación. La constancia importa más que sumar sesiones de más.</p><div className="row"><button onClick={()=>go('train')}>Mi entrenamiento</button><button onClick={()=>go('food')}>Ver alimentación</button></div></div>
 </section>;
}
