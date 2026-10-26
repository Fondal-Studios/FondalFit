import {z} from 'zod';
import type {FastifyInstance,FastifyRequest,FastifyReply} from 'fastify';
import type {DB} from './db';

type Guard=(req:FastifyRequest,reply:FastifyReply)=>Promise<unknown>;
type Context={app:FastifyInstance;db:DB;auth:Guard;proOnly:Guard;athleteOnly:Guard;hasConsent:(uid:number,scope:string)=>Promise<boolean>;audit:(actor:number|null,subject:number|null,action:string)=>Promise<unknown>;now:()=>string};
type User={id:number;role:string;pro_enabled:number};
const uid=(req:FastifyRequest)=>(req.user as User).id;
const intParam=(p:unknown)=>z.coerce.number().int().positive().safeParse((p as {id?:string;memberId?:string})?.id).data;
export function registerGym({app,db,auth,proOnly,athleteOnly,hasConsent,audit,now}:Context){
 const owner=async(gymId:number,id:number)=>db.prepare('SELECT id FROM gyms WHERE id=? AND owner_id=?').get(gymId,id);
 const staff=async(gymId:number,id:number)=>{
  if(await owner(gymId,id))return true;
  return !!await db.prepare("SELECT 1 AS ok FROM gym_members WHERE gym_id=? AND user_id=? AND member_type='coach' AND status='active'").get(gymId,id);
 };
 const getGym=async(id:number)=>db.prepare('SELECT id,owner_id,name,city,area FROM gyms WHERE id=?').get(id) as {id:number;owner_id:number;name:string;city:string;area:string}|undefined;

 app.get('/api/gyms/plans',{preHandler:auth},async()=>({
  current:'beta_free',checkoutEnabled:false,monthlyPrices:{individual:12,gym:49},
  currency:'USD',illustrative:true,
  note:'Tarifas propuestas para validación comercial; no hay cargos ni suscripciones cobradas mediante este módulo.'
 }));

 app.post('/api/gyms',{preHandler:proOnly},async(req,reply)=>{
  const result=z.object({name:z.string().trim().min(3).max(90),city:z.string().trim().min(2).max(90),area:z.string().trim().max(90).default('')}).safeParse(req.body);
  if(!result.success)return reply.code(400).send({error:'invalid_gym'});
  const id=uid(req),count=await db.prepare('SELECT CAST(COUNT(*) AS INTEGER) AS count FROM gyms WHERE owner_id=?').get(id) as {count:number};
  if(count.count>=5)return reply.code(409).send({error:'gym_limit_beta'});
  const g=await db.prepare('INSERT INTO gyms(owner_id,name,city,area,created_at) VALUES(?,?,?,?,?) RETURNING id').get(id,result.data.name,result.data.city,result.data.area,now()) as {id:number};
  await db.prepare("INSERT INTO gym_billing(gym_id,plan,status,updated_at) VALUES(?,'beta_free','beta',?)").run(g.id,now());
  await audit(id,g.id,'gym:create');
  return {id:g.id,name:result.data.name,plan:'beta_free'};
 });

 app.get('/api/gyms',{preHandler:auth},async(req)=>{
  const id=uid(req);
  const owned=await db.prepare('SELECT id,name,city,area,owner_id FROM gyms WHERE owner_id=? ORDER BY id DESC').all(id);
  const connected=await db.prepare("SELECT g.id,g.name,g.city,g.area,g.owner_id,m.member_type,m.status FROM gyms g JOIN gym_members m ON g.id=m.gym_id WHERE m.user_id=? AND m.status='active' ORDER BY g.id DESC").all(id);
  return {owned,connected};
 });

 app.get('/api/gyms/invitations',{preHandler:auth},async(req)=>{
  const invitations=await db.prepare("SELECT g.id,g.name,g.city,m.member_type,m.status FROM gym_members m JOIN gyms g ON g.id=m.gym_id WHERE m.user_id=? AND m.status='pending' ORDER BY m.joined_at DESC").all(uid(req));
  return {invitations};
 });

 app.post('/api/gyms/:id/invitations/accept',{preHandler:auth},async(req,reply)=>{
  const gymId=intParam(req.params);if(!gymId)return reply.code(400).send({error:'invalid_id'});
  const id=uid(req),m=await db.prepare("SELECT member_type FROM gym_members WHERE gym_id=? AND user_id=? AND status='pending'").get(gymId,id) as {member_type:'coach'|'athlete'}|undefined;
  if(!m)return reply.code(404).send({error:'invitation_not_found'});
  if(m.member_type==='athlete'&&!await hasConsent(id,'share_with_pro'))return reply.code(403).send({error:'consent_required',scope:'share_with_pro'});
  if(m.member_type==='coach'){
   const user=req.user as User;
   if(!user.pro_enabled&&user.role!=='pro'&&user.role!=='admin')return reply.code(409).send({error:'enable_professional_mode_first'});
  }
  await db.prepare("UPDATE gym_members SET status='active',joined_at=? WHERE gym_id=? AND user_id=? AND status='pending'").run(now(),gymId,id);
  await audit(id,gymId,'gym:invitation:accept');
  return {ok:true};
 });

 app.get('/api/gyms/:id',{preHandler:proOnly},async(req,reply)=>{
  const gymId=intParam(req.params);if(!gymId)return reply.code(400).send({error:'invalid_id'});
  if(!await staff(gymId,uid(req)))return reply.code(404).send({error:'gym_not_found'});
  const gym=await getGym(gymId);if(!gym)return reply.code(404).send({error:'gym_not_found'});
  const rows=await db.prepare("SELECT m.user_id AS id,u.name,u.email,m.member_type,m.status,m.assigned_coach_id FROM gym_members m JOIN users u ON u.id=m.user_id WHERE m.gym_id=? ORDER BY m.member_type,m.status,u.name").all(gymId) as {id:number;name:string;email:string;member_type:'coach'|'athlete';status:string;assigned_coach_id:number|null}[];
  const allowed=await Promise.all(rows.map(async m=>m.member_type==='coach'||m.status!=='active'||await hasConsent(m.id,'share_with_pro')));
  const visible=rows.filter((m,i)=>allowed[i]&&(gym.owner_id===uid(req)||m.member_type==='coach'||m.assigned_coach_id===uid(req)));
  const athleteIds=visible.filter(m=>m.member_type==='athlete'&&m.status==='active').map(m=>m.id);
  const since=new Date(Date.now()-30*86400000).toISOString();
  const activity=await Promise.all(athleteIds.map(async athleteId=>{
   const workout=await db.prepare('SELECT CAST(COUNT(*) AS INTEGER) AS c,MAX(created_at) AS last FROM workouts WHERE user_id=? AND created_at>=?').get(athleteId,since) as {c:number;last:string|null};
   const cardio=await db.prepare('SELECT CAST(COUNT(*) AS INTEGER) AS c,MAX(started_at) AS last FROM activities WHERE user_id=? AND started_at>=?').get(athleteId,since) as {c:number;last:string|null};
   return {id:athleteId,sessions30:Number(workout.c)+Number(cardio.c),lastActivity:[workout.last,cardio.last].filter(Boolean).sort().reverse()[0]??null};
  }));
  const billing=await db.prepare('SELECT plan,status FROM gym_billing WHERE gym_id=?').get(gymId) as {plan:string;status:string}|undefined;
  return {gym,members:visible,activity,plan:billing??{plan:'beta_free',status:'beta'},checkoutEnabled:false};
 });

 app.post('/api/gyms/:id/invite',{preHandler:proOnly},async(req,reply)=>{
  const gymId=intParam(req.params);if(!gymId)return reply.code(400).send({error:'invalid_id'});
  if(!await staff(gymId,uid(req)))return reply.code(404).send({error:'gym_not_found'});
  const b=z.object({email:z.string().email(),memberType:z.enum(['coach','athlete'])}).safeParse(req.body);
  if(!b.success)return reply.code(400).send({error:'invalid_invitation'});
  if(b.data.memberType==='coach'&&!await owner(gymId,uid(req)))return reply.code(403).send({error:'owner_only'});
  const current=await db.prepare('SELECT CAST(COUNT(*) AS INTEGER) AS c FROM gym_members WHERE gym_id=? AND status<>?').get(gymId,'revoked') as {c:number};
  if(current.c>=100)return reply.code(409).send({error:'gym_members_beta_limit'});
  const found=await db.prepare('SELECT id FROM users WHERE LOWER(email)=LOWER(?) AND id<>?').get(b.data.email,uid(req)) as {id:number}|undefined;
  if(found&&!(await owner(gymId,found.id))){
   await db.prepare("INSERT INTO gym_members(gym_id,user_id,member_type,status,assigned_coach_id,joined_at) VALUES(?, ?, ?, 'pending',NULL,?) ON CONFLICT(gym_id,user_id) DO UPDATE SET status='pending',member_type=excluded.member_type,assigned_coach_id=NULL,joined_at=excluded.joined_at").run(gymId,found.id,b.data.memberType,now());
   await audit(uid(req),found.id,'gym:invite:'+b.data.memberType);
  }
  // Avoid exposing whether an email account exists.
  return {ok:true,message:'Si la cuenta existe, encontrará una invitación en la aplicación.'};
 });

 app.put('/api/gyms/:id/members/:memberId/assign',{preHandler:proOnly},async(req,reply)=>{
  const params=req.params as {id:string;memberId:string},gymId=Number(params.id),athleteId=Number(params.memberId);
  if(!Number.isSafeInteger(gymId)||!Number.isSafeInteger(athleteId)||gymId<=0||athleteId<=0)return reply.code(400).send({error:'invalid_id'});
  if(!await owner(gymId,uid(req)))return reply.code(403).send({error:'owner_only'});
  const b=z.object({coachId:z.number().int().positive().nullable()}).safeParse(req.body);
  if(!b.success)return reply.code(400).send({error:'invalid_assignment'});
  const athlete=await db.prepare("SELECT 1 AS ok FROM gym_members WHERE gym_id=? AND user_id=? AND member_type='athlete' AND status='active'").get(gymId,athleteId);
  if(!athlete||!await hasConsent(athleteId,'share_with_pro'))return reply.code(404).send({error:'member_not_available'});
  if(b.data.coachId!==null&&b.data.coachId!==uid(req)){
   const coach=await db.prepare("SELECT 1 AS ok FROM gym_members WHERE gym_id=? AND user_id=? AND member_type='coach' AND status='active'").get(gymId,b.data.coachId);
   if(!coach)return reply.code(404).send({error:'coach_not_in_gym'});
  }
  const res=await db.prepare('UPDATE gym_members SET assigned_coach_id=? WHERE gym_id=? AND user_id=?').run(b.data.coachId,gymId,athleteId);
  if(!res.changes)return reply.code(404).send({error:'member_not_found'});
  await audit(uid(req),athleteId,'gym:assigned');
  return {ok:true,note:'La asignación administrativa no da acceso clínico ni reemplaza el consentimiento de vinculación del deportista.'};
 });

 app.post('/api/gyms/:id/members/:memberId/remove',{preHandler:proOnly},async(req,reply)=>{
  const params=req.params as {id:string;memberId:string},gymId=Number(params.id),memberId=Number(params.memberId);
  if(!Number.isSafeInteger(gymId)||!Number.isSafeInteger(memberId)||gymId<=0||memberId<=0)return reply.code(400).send({error:'invalid_id'});
  if(!await owner(gymId,uid(req)))return reply.code(403).send({error:'owner_only'});
  const res=await db.prepare("UPDATE gym_members SET status='revoked',assigned_coach_id=NULL WHERE gym_id=? AND user_id=?").run(gymId,memberId);
  if(!res.changes)return reply.code(404).send({error:'member_not_found'});
  await audit(uid(req),memberId,'gym:member:removed');
  return {ok:true};
 });
}
