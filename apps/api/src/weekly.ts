/** Weekly decisions are based only on evidence that the athlete explicitly registered. */
export interface WeeklySignals {planned:number;completed:number;lastSessionDaysAgo:number|null;fatigue:number|null;pain:number|null;sleepHours:number|null;choice:'recovery'|'normal'|'strong'}
export function weeklyDecision(s:WeeklySignals){
 const adherence=s.planned>0?Math.min(1,s.completed/s.planned):null;
 const absent=s.lastSessionDaysAgo===null||s.lastSessionDaysAgo>10;
 const poorRecovery=(s.fatigue!==null&&s.fatigue>=8)||(s.pain!==null&&s.pain>=7)||(s.sleepHours!==null&&s.sleepHours<5);
 const returnToTraining=absent && s.completed===0;
 const mode=poorRecovery||returnToTraining?'recovery':s.choice;
 const factor=mode==='recovery'?0.7:mode==='strong'&&adherence!==null&&adherence>=0.75&&s.fatigue!==null&&s.fatigue<=5&&s.pain!==null&&s.pain<=3?1.05:1;
 const reason=poorRecovery?'recovery_warning':returnToTraining?'gradual_return':s.choice==='strong'&&factor===1?'strong_requires_data':'athlete_choice';
 return {mode,factor,reason,adherence,absenceStatus:absent?'unknown_or_unrecorded':'has_recent_record' as const};
}
