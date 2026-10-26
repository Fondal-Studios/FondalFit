import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { adaptedReturn, adviseDay, materialize, weekStartUtc, resumeShift, routineById, routineWeekDays, type Experience, type Plan, CATALOG } from '@fondal/engine';
import type { RouteCtx } from './admin';

type Guard = (req: FastifyRequest, reply: FastifyReply) => Promise<unknown>;
export interface PlanCtx extends RouteCtx {
  athleteOnly: Guard;
  needHealth: (req: FastifyRequest, reply: FastifyReply) => Promise<boolean>;
  latestPlan: (uid: number) => Promise<{ version: number; data: string; source: string; created_at: string } | undefined>;
  savePlan: (uid: number, plan: Plan, source: string) => Promise<number>;
}

export function registerPlans(c: PlanCtx) {
  const { app, db, athleteOnly } = c;

  const experienceOf = async (uid: number): Promise<Experience> => {
    const r = await db.prepare('SELECT data FROM assessments WHERE user_id=? ORDER BY id DESC LIMIT 1').get(uid) as { data: string } | undefined;
    return (r ? (JSON.parse(r.data) as { experience?: Experience }).experience : undefined) ?? 'intermediate';
  };
  /** Days since the last logged workout or GPS activity (null if nothing logged yet). */
  const lastActivityGap = async (uid: number, since: string) => {
    const w = await db.prepare('SELECT MAX(created_at) AS t FROM workouts WHERE user_id=?').get(uid) as { t: string | null };
    const a = await db.prepare('SELECT MAX(created_at) AS t FROM activities WHERE user_id=?').get(uid) as { t: string | null };
    const last = [w.t, a.t, since].filter(Boolean).sort().pop()!;
    return { last, gapDays: Math.floor((Date.now() - Date.parse(last)) / 864e5) };
  };

  app.get('/api/plan', { preHandler: athleteOnly }, async (req) => {
    const uid = req.user!.id, p = await c.latestPlan(uid);
    if (!p) return { plan: null };
    const stored = JSON.parse(p.data) as Plan;
    const exp = await experienceOf(uid);
    const m = materialize(stored, new Date(), exp);
    const proId = p.source.startsWith('pro:') ? Number(p.source.slice(4)) : 0;
    const pro = proId ? await db.prepare('SELECT name FROM users WHERE id=?').get(proId) as { name: string } | undefined : undefined;
    const rec = await db.prepare('SELECT score,alerts,created_at FROM recovery WHERE user_id=? ORDER BY id DESC LIMIT 1').get(uid) as { score: number; alerts: string; created_at: string } | undefined;
    const fresh = rec && Date.now() - Date.parse(rec.created_at) < 36 * 3600e3;
    const { gapDays } = await lastActivityGap(uid, p.created_at);
    // which sessions of the displayed week are done: strength by day index, cardio by number of GPS activities this week
    const wk = weekStartUtc(new Date()).toISOString();
    const doneStrength = new Set((await db.prepare('SELECT DISTINCT day_index FROM workouts WHERE user_id=? AND created_at>=? AND day_index<99').all(uid, wk) as { day_index: number }[]).map((r) => r.day_index));
    const cardioDone = (await db.prepare('SELECT CAST(COUNT(*) AS INTEGER) c FROM activities WHERE user_id=? AND started_at>=?').get(uid, wk) as { c: number }).c;
    let seenCardio = 0;
    const doneDays = m.days.flatMap((d, i) => (d.kind === 'cardio' ? (seenCardio++ < cardioDone ? [i] : []) : doneStrength.has(i) ? [i] : []));
    const nextIndex = m.days.findIndex((_, i) => !doneDays.includes(i));
    const routineId = stored.program?.routineId ?? (p.source.startsWith('routine:') ? p.source.slice(8) : null);
    return {
      version: p.version, source: p.source, proName: pro?.name ?? null, routineId,
      plan: { ...stored, days: m.days },
      current: { label: m.label, weekIndex: m.weekIndex, weekCount: m.weekCount, ramp: m.ramp },
      advice: fresh ? adviseDay(rec.score, JSON.parse(rec.alerts)) : null,
      away: { gapDays, options: gapDays >= 10 ? adaptedReturn(gapDays) : null },
      week: { doneDays, nextIndex: nextIndex >= 0 ? nextIndex : null },
    };
  });

  /** Two-stage exercise swap: never allow the language model to write the plan directly. */
  const swapSchema=z.object({dayIndex:z.number().int().min(0).max(6),itemIndex:z.number().int().min(0).max(30),replacementId:z.string().max(60),expectedVersion:z.number().int().positive().optional()});
  const evaluateSwap=async(uid:number,b:z.infer<typeof swapSchema>)=>{
    const latest=await c.latestPlan(uid);
    if(!latest)return {error:'no_plan'} as const;
    if(b.expectedVersion!==undefined&&b.expectedVersion!==latest.version)return {error:'plan_changed'} as const;
    if(latest.source.startsWith('pro:'))return {error:'professional_plan_requires_approval'} as const;
    const plan=JSON.parse(latest.data) as Plan;
    if(plan.program?.weeks?.length)return {error:'program_requires_professional_review'} as const;
    const current=plan.days[b.dayIndex]?.items[b.itemIndex];
    if(!current)return {error:'exercise_not_found'} as const;
    const from=CATALOG.find(x=>x.id===current.exerciseId),to=CATALOG.find(x=>x.id===b.replacementId);
    if(!from||!to)return {error:'unknown_exercise'} as const;
    const assessment=await db.prepare('SELECT data FROM assessments WHERE user_id=? ORDER BY id DESC LIMIT 1').get(uid) as {data:string}|undefined;
    if(!assessment)return {error:'no_assessment'} as const;
    const a=JSON.parse(assessment.data) as {experience?:string;equipment?:string[];restrictions?:string[];redFlags?:Record<string,boolean>};
    const condition=await db.prepare("SELECT data FROM nutrition WHERE user_id=? AND kind='medical_context' ORDER BY id DESC LIMIT 1").get(uid) as {data:string}|undefined;
    let hasCondition=false;try{hasCondition=condition?JSON.parse(condition.data).hasCondition===true:false;}catch{}
    if(hasCondition||Object.values(a.redFlags??{}).some(Boolean))return {error:'professional_clearance_required'} as const;
    const available=new Set([...(a.equipment??[]),'none']);
    if(!to.equipment.some(x=>available.has(x)))return {error:'equipment_unavailable'} as const;
    if(to.stresses.some(x=>(a.restrictions??[]).includes(x)))return {error:'exercise_conflicts_with_restriction'} as const;
    const maxLevel=a.experience==='advanced'?3:a.experience==='intermediate'?2:1;
    if(to.level>maxLevel)return {error:'exercise_too_advanced'} as const;
    if(from.id===to.id)return {error:'same_exercise'} as const;
    if(from.pattern!==to.pattern||from.muscle!==to.muscle||from.timed!==to.timed)return {error:'different_training_stimulus'} as const;
    const proposed=structuredClone(plan);
    const item=proposed.days[b.dayIndex]!.items[b.itemIndex]!;
    item.exerciseId=to.id;item.load=0;
    const explanation='Ambos ejercicios trabajan principalmente '+to.muscle+' y comparten el patrón '+to.pattern+'. La sustitución es compatible con el objetivo '+plan.goal+'. Se conserva la cantidad de series y repeticiones, y se reinicia la carga para evitar trasladar automáticamente un peso inseguro. Revisá la técnica antes de comenzar.';
    return {plan:proposed,version:latest.version,fromId:from.id,toId:to.id,explanation} as const;
  };
  app.post('/api/plan/exercise-swap/preview',{preHandler:athleteOnly},async(req,reply)=>{
    if(!await c.needHealth(req,reply))return;
    const b=c.parse(swapSchema,req.body,reply);if(!b)return;
    const result=await evaluateSwap(req.user!.id,b);
    if('error'in result)return reply.code(409).send(result);
    return {allowed:true,version:result.version,fromId:result.fromId,toId:result.toId,explanation:result.explanation,requiresConfirmation:true};
  });
  app.post('/api/plan/exercise-swap/confirm',{preHandler:athleteOnly,config:{rateLimit:{max:10,timeWindow:'1 minute'}}},async(req,reply)=>{
    if(!await c.needHealth(req,reply))return;
    const b=c.parse(swapSchema.extend({expectedVersion:z.number().int().positive()}),req.body,reply);if(!b)return;
    const result=await evaluateSwap(req.user!.id,b);
    if('error'in result)return reply.code(409).send(result);
    const version=await c.savePlan(req.user!.id,result.plan,'athlete:confirmed_swap');
    await c.audit(req.user!.id,req.user!.id,'plan:exercise_swap:'+result.fromId+':'+result.toId);
    return {ok:true,version,explanation:result.explanation};
  });
  app.get('/api/plan/exercise-swap/options',{preHandler:athleteOnly},async(req)=>{
    const latest=await c.latestPlan(req.user!.id);
    if(!latest)return {days:[],catalog:[]};
    const plan=JSON.parse(latest.data) as Plan;
    return {version:latest.version,goal:plan.goal,days:plan.days.map((d,i)=>({index:i,name:d.name,items:d.items.map((p,j)=>({index:j,exerciseId:p.exerciseId}))})),catalog:CATALOG.map(x=>({id:x.id,pattern:x.pattern,muscle:x.muscle}))};
  });

  /** Adopt a library routine as the current plan: a new plan version, history kept. */
  app.post('/api/plan/adopt', { preHandler: athleteOnly }, async (req, reply) => {
    if (!await c.needHealth(req, reply)) return;
    const b = c.parse(z.object({ routineId: z.string().max(60) }), req.body, reply);
    if (!b) return;
    const r = routineById(b.routineId);
    if (!r) return reply.code(404).send({ error: 'unknown_routine' });
    const startedAt = c.now();
    const days = routineWeekDays(r, 0);
    const plan: Plan = { engineVersion: 'routine', goal: r.goal, days, weeksSinceDeload: 0 };
    if (r.weeks > 1) plan.program = { routineId: r.id, startedAt, weeks: r.program.map((_, i) => routineWeekDays(r, i)) };
    else if (days.some((d) => d.kind === 'strength')) plan.meso = { startedAt };
    const version = await c.savePlan(req.user!.id, plan, `routine:${r.id}`);
    await c.audit(req.user!.id, null, `plan:adopt:${r.id}`);
    return { ok: true, planVersion: version };
  });

  /** After time away: resume where you left off, ramp back gently, or restart the block. */
  app.post('/api/plan/return', { preHandler: athleteOnly }, async (req, reply) => {
    const b = c.parse(z.object({ mode: z.enum(['resume', 'adapted', 'restart']) }), req.body, reply);
    if (!b) return;
    const uid = req.user!.id, p = await c.latestPlan(uid);
    if (!p) return reply.code(409).send({ error: 'no_plan' });
    const plan = JSON.parse(p.data) as Plan;
    const { gapDays } = await lastActivityGap(uid, p.created_at);
    const nowIso = c.now();
    if (b.mode === 'restart') {
      if (plan.meso) plan.meso.startedAt = nowIso;
      if (plan.program) plan.program.startedAt = nowIso;
      delete plan.ramp;
    } else {
      if (plan.meso) plan.meso.startedAt = resumeShift(plan.meso.startedAt, gapDays);
      if (plan.program) plan.program.startedAt = resumeShift(plan.program.startedAt, gapDays);
      const ramp = b.mode === 'adapted' ? adaptedReturn(gapDays) : null;
      if (ramp) plan.ramp = { ...ramp, startedAt: nowIso }; else delete plan.ramp;
    }
    const version = await c.savePlan(uid, plan, `return:${b.mode}`);
    await c.audit(uid, null, `plan:return:${b.mode}`);
    return { ok: true, planVersion: version, gapDays };
  });
}
