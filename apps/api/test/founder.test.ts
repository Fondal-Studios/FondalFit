import {describe,it,expect} from 'vitest';
import {openDb} from '../src/db';
import {bootstrapFounder} from '../src/founder';
describe('explicit founder affiliation',()=>{
 it('does not grant permissions if ID or email mismatches',async()=>{
  const db=await openDb(':memory:');
  try{
   await db.prepare("INSERT INTO users(id,email,name,role,lang,pass_hash,salt,created_at,trial_ends_at,pro_enabled,mode) VALUES(1,'owner@example.com','Mariano','athlete','es','x','x','2026-10-25','2026-12-25',0,NULL)").run();
   const opts={userId:1,email:'wrong@example.com',displayName:'Mariano Jiménez',phone:'5493875467519',city:'Cafayate',area:'Vertientes'};
   expect((await bootstrapFounder(db,opts)).matched).toBe(false);
   const before=await db.prepare('SELECT role FROM users WHERE id=1').get() as {role:string};
   expect(before.role).toBe('athlete');
  }finally{await db.close();}
 });
 it('grants four panels while medical verification remains pending; restart preserves selected panel',async()=>{
  const db=await openDb(':memory:');
  try{
   await db.prepare("INSERT INTO users(id,email,name,role,lang,pass_hash,salt,created_at,trial_ends_at,pro_enabled,mode) VALUES(1,'owner@example.com','Mariano','athlete','es','x','x','2026-10-25','2026-12-25',0,NULL)").run();
   const opts={userId:1,email:'owner@example.com',displayName:'Mariano Jiménez',phone:'5493875467519',city:'Cafayate',area:'Vertientes'};
   expect(await bootstrapFounder(db,opts)).toEqual({matched:true,profileCreated:true});
   const account=await db.prepare('SELECT role,pro_enabled,mode FROM users WHERE id=1').get() as {role:string;pro_enabled:number;mode:string};
   expect(account).toMatchObject({role:'admin',pro_enabled:1,mode:'admin'});
   const profile=await db.prepare("SELECT verified,phone,city,area FROM professional_profiles WHERE user_id=1 AND category='medical'").get() as {verified:number;phone:string;city:string;area:string};
   expect(profile).toMatchObject({verified:0,phone:opts.phone,city:'Cafayate',area:'Vertientes'});
   // Legacy contact correction must apply to the exact former number only.
   await db.prepare("UPDATE professional_profiles SET phone='5493875466419' WHERE user_id=1 AND category='medical'").run();
   await db.prepare("UPDATE users SET mode='athlete' WHERE id=1").run();
   expect(await bootstrapFounder(db,opts)).toEqual({matched:true,profileCreated:false});
   const updated=await db.prepare('SELECT mode FROM users WHERE id=1').get() as {mode:string};
   expect(updated.mode).toBe('athlete');
   const corrected=await db.prepare("SELECT phone FROM professional_profiles WHERE user_id=1 AND category='medical'").get() as {phone:string};
   expect(corrected.phone).toBe('5493875467519');
  }finally{await db.close();}
 });
});
