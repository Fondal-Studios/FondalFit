import type {DB} from './db';

/** One-time, explicitly authorized founder affiliation.
 * Both the database user ID and the login email MUST match independently.
 * No default account or public request can trigger this operation.
 * Repeated starts never reset the user's chosen interface.
 */
export async function bootstrapFounder(db:DB, opts:{userId:number;email:string;displayName:string;phone:string;city:string;area:string}):Promise<{matched:boolean;profileCreated:boolean}>{
  if(!Number.isSafeInteger(opts.userId)||opts.userId<1||!/^\S+@\S+\.\S+$/.test(opts.email))return {matched:false,profileCreated:false};
  const found=await db.prepare('SELECT id,email,role,mode FROM users WHERE id=? AND LOWER(email)=LOWER(?)').get(opts.userId,opts.email) as {id:number;email:string;role:string;mode:string|null}|undefined;
  if(!found)return {matched:false,profileCreated:false};
  await db.prepare(`UPDATE users SET role='admin', pro_enabled=1,
     mode=CASE WHEN role='admin' THEN mode ELSE 'admin' END WHERE id=? AND LOWER(email)=LOWER(?)`).run(opts.userId,opts.email);
  const stamp=new Date().toISOString();
  // Professional title and license are not assumed verified.
  const saved=await db.prepare(`INSERT INTO professional_profiles(
    user_id,category,display_name,specialty,credentials,license,description,phone,city,area,modality,lat,lon,verified,published,created_at,updated_at
   ) VALUES(?,'medical',?,'Medicina del ejercicio y salud metabólica','Médico','',
       'Consulta individual para evaluar salud, actividad física, entrenamiento y objetivos.',
       ?,?,?,'both',NULL,NULL,0,1,?,?)
   ON CONFLICT(user_id,category) DO NOTHING`).run(opts.userId,opts.displayName,opts.phone,opts.city,opts.area,stamp,stamp);
  if(found.role!=='admin'||saved.changes){
    await db.prepare('INSERT INTO audit(actor_id,subject_id,action,created_at) VALUES(?,?,?,?)').run(opts.userId,opts.userId,'founder:bootstrap_verified_identity',stamp);
  }
  return {matched:true,profileCreated:!!saved.changes};
}
