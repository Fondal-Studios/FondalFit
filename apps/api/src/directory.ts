import type {FastifyInstance,FastifyRequest,FastifyReply} from 'fastify';
import {z} from 'zod';
import type {DB} from './db';
type Guard=(req:FastifyRequest,reply:FastifyReply)=>Promise<unknown>;
type Context={app:FastifyInstance;db:DB;auth:Guard;adminOnly:Guard;audit:(actor:number|null,subject:number|null,action:string)=>Promise<unknown>;now:()=>string};
const categories=['medical','fitness'] as const;
const healthProfessions=['physician','kinesiologist','other_health'] as const;
const profileInput=z.object({
 category:z.enum(categories),profession:z.enum(['physician','kinesiologist','other_health','coach']).optional(),displayName:z.string().trim().min(3).max(90),
 specialty:z.string().trim().min(3).max(100),credentials:z.string().trim().max(180).default(''),
 license:z.string().trim().max(80).default(''),description:z.string().trim().max(700).default(''),
 phone:z.string().regex(/^\+?[0-9 ]{8,22}$/),city:z.string().trim().min(2).max(100),
 area:z.string().trim().max(100).default(''),modality:z.enum(['online','in_person','both']).default('both'),
 lat:z.number().min(-90).max(90).nullable().default(null),lon:z.number().min(-180).max(180).nullable().default(null),
 published:z.boolean().default(true)
});
type Profile= z.infer<typeof profileInput>;
const rowToPublic=(r:Record<string,unknown>)=>({id:Number(r.user_id),category:r.category,displayName:r.display_name,profession:r.profession??(r.category==='fitness'?'coach':'physician'),specialty:r.specialty,credentials:r.credentials,description:r.description,city:r.city,area:r.area,modality:r.modality,lat:r.lat,lon:r.lon,phone:r.phone,verified:!!r.verified});
const userId=(req:FastifyRequest)=>Number((req.user as {id:number}).id);
const distanceKm=(lat1:number,lon1:number,lat2:number,lon2:number)=>{
 const r=Math.PI/180,a=Math.sin((lat2-lat1)*r/2)**2+Math.cos(lat1*r)*Math.cos(lat2*r)*Math.sin((lon2-lon1)*r/2)**2;
 return 12742*Math.asin(Math.min(1,Math.sqrt(a)));
};
export function registerDirectory({app,db,auth,adminOnly,audit,now}:Context){
 app.get('/api/directory',{preHandler:auth},async(req,reply)=>{
  const q=z.object({category:z.enum(['medical','fitness','kinesiology','all']).default('all'),city:z.string().max(100).default(''),lat:z.coerce.number().min(-90).max(90).optional(),lon:z.coerce.number().min(-180).max(180).optional()}).safeParse(req.query);
  if(!q.success)return reply.code(400).send({error:'invalid_filters'});
  const rows=await db.prepare('SELECT * FROM professional_profiles WHERE verified=1 AND published=1 ORDER BY updated_at DESC').all() as Record<string,unknown>[];
  const items=rows.filter(p=>(q.data.category==='all'||(q.data.category==='kinesiology' ? p.category==='medical'&&p.profession==='kinesiologist' : p.category===q.data.category))&&(!q.data.city||String(p.city).toLowerCase().includes(q.data.city.toLowerCase())))
    .map(p=>({...rowToPublic(p),distanceKm:q.data.lat!==undefined&&q.data.lon!==undefined&&p.lat!==null&&p.lon!==null?Math.round(distanceKm(q.data.lat,q.data.lon,Number(p.lat),Number(p.lon))*10)/10:null}))
    .sort((a,b)=>(a.distanceKm??99999)-(b.distanceKm??99999));
  return {items:items.slice(0,100),note:'Solo profesionales verificados. La distancia se estima en línea recta cuando se comparte ubicación.'};
 });
 app.get('/api/profiles/me',{preHandler:auth},async(req)=>{
  const rows=await db.prepare('SELECT * FROM professional_profiles WHERE user_id=? ORDER BY category').all(userId(req)) as Record<string,unknown>[];
  return rows.map(r=>({...rowToPublic(r),license:r.license,published:!!r.published,verified:!!r.verified,updatedAt:r.updated_at}));
 });
 app.put('/api/profiles/me',{preHandler:auth},async(req,reply)=>{
  const b=profileInput.safeParse(req.body);
  if(!b.success)return reply.code(400).send({error:'invalid_profile',issues:b.error.issues});
  const uid=userId(req),p={...b.data,profession:b.data.profession??(b.data.category==='fitness'?'coach':'physician')};
  if(p.category==='fitness'&&p.profession!=='coach')return reply.code(400).send({error:'invalid_profession_for_category'});
  if(p.category==='medical'&&!healthProfessions.includes(p.profession as typeof healthProfessions[number]))return reply.code(400).send({error:'invalid_profession_for_category'});
  const previous=await db.prepare('SELECT verified FROM professional_profiles WHERE user_id=? AND category=?').get(uid,p.category) as {verified:number}|undefined;
  // Any change to professional identity, credentials or location requires renewed review.
  await db.prepare(`INSERT INTO professional_profiles(user_id,category,profession,display_name,specialty,credentials,license,description,phone,city,area,modality,lat,lon,verified,published,created_at,updated_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,0,?,?,?)
    ON CONFLICT(user_id,category) DO UPDATE SET profession=excluded.profession,display_name=excluded.display_name,specialty=excluded.specialty,credentials=excluded.credentials,license=excluded.license,description=excluded.description,phone=excluded.phone,city=excluded.city,area=excluded.area,modality=excluded.modality,lat=excluded.lat,lon=excluded.lon,verified=0,published=excluded.published,updated_at=excluded.updated_at`).run(uid,p.category,p.profession,p.displayName,p.specialty,p.credentials,p.license,p.description,p.phone,p.city,p.area,p.modality,p.lat,p.lon,p.published?1:0,now(),now());
  await audit(uid,uid,'professional:profile:'+p.category+(previous?.verified?':reverification':''));
  return {ok:true,verified:false,notice:'Perfil enviado a revisión. No se publicará hasta verificar las credenciales.'};
 });
 app.get('/api/admin/professionals',{preHandler:adminOnly},async()=>{
  const rows=await db.prepare('SELECT p.*,u.email FROM professional_profiles p JOIN users u ON u.id=p.user_id ORDER BY p.verified ASC,p.updated_at DESC').all() as (Record<string,unknown>)[];
  return rows.map(r=>({...rowToPublic(r),email:r.email,license:r.license,verified:!!r.verified,published:!!r.published}));
 });
 app.post('/api/admin/professionals/verify',{preHandler:adminOnly},async(req,reply)=>{
  const b=z.object({userId:z.number().int().positive(),category:z.enum(categories),verified:z.boolean()}).safeParse(req.body);
  if(!b.success)return reply.code(400).send({error:'invalid'});
  const res=await db.prepare('UPDATE professional_profiles SET verified=?,updated_at=? WHERE user_id=? AND category=?').run(b.data.verified?1:0,now(),b.data.userId,b.data.category);
  if(!res.changes)return reply.code(404).send({error:'profile_not_found'});
  await audit(userId(req),b.data.userId,'professional:verified:'+b.data.category+':'+b.data.verified);
  return {ok:true};
 });
 /** Explicit, audited founder setup: administrator must confirm the exact account ID and email. */
 app.post('/api/admin/accounts/grant-founder',{preHandler:adminOnly},async(req,reply)=>{
  const b=z.object({userId:z.number().int().positive(),expectedEmail:z.string().email()}).safeParse(req.body);
  if(!b.success)return reply.code(400).send({error:'invalid'});
  const target=await db.prepare('SELECT id,email,name FROM users WHERE id=?').get(b.data.userId) as {id:number;email:string;name:string}|undefined;
  if(!target||target.email.toLowerCase()!==b.data.expectedEmail.toLowerCase()||target.name.toLowerCase()!=='nanogm')return reply.code(409).send({error:'account_identity_mismatch'});
  await db.prepare("UPDATE users SET role='admin',pro_enabled=1,mode='admin' WHERE id=?").run(target.id);
  const t=now();
  await db.prepare(`INSERT INTO professional_profiles(user_id,category,display_name,specialty,credentials,license,description,phone,city,area,modality,lat,lon,verified,published,created_at,updated_at)
   VALUES(?,'medical','Mariano Jiménez','Medicina del ejercicio y salud metabólica','Médico','Pendiente de informar matrícula','Consulta individual de objetivos, actividad física y salud metabólica','5493875466419','Cafayate','Vertientes','both',NULL,NULL,0,1,?,?)
   ON CONFLICT(user_id,category) DO NOTHING`).run(target.id,t,t);
  await audit(userId(req),target.id,'founder:granted:admin+fitness+medical_pending');
  return {ok:true,accountId:target.id,medicalProfileVerified:false,notice:'Permisos de fundador habilitados. La matrícula médica debe verificarse antes de publicar el perfil.'};
 });
 app.get('/api/admin/accounts/lookup',{preHandler:adminOnly},async(req,reply)=>{
  const q=z.object({name:z.string().trim().min(2).max(100)}).safeParse(req.query);
  if(!q.success)return reply.code(400).send({error:'invalid'});
  const users=await db.prepare('SELECT id,name,email,role,mode,pro_enabled FROM users WHERE LOWER(name)=LOWER(?)').all(q.data.name) as Record<string,unknown>[];
  return {users};
 });
}
