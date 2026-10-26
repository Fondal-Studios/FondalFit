import { fileURLToPath } from 'node:url';
import { buildApp } from './app';
import { anthropicCoach } from './coach';
import { openDb } from './db';
import {bootstrapFounder} from './founder';

const staticDir = process.env.STATIC_DIR ?? fileURLToPath(new URL('../../web/dist', import.meta.url));
// DATABASE_URL (postgres://…) in production; falls back to a local SQLite file for development.
const db = await openDb(process.env.DATABASE_URL ?? process.env.DB_PATH ?? 'fondal.db');
// Founder identity is confirmed independently against both account ID and login email.
if(process.env.FOUNDER_ACCOUNT_ID && process.env.FOUNDER_ACCOUNT_EMAIL){
  const result=await bootstrapFounder(db,{
    userId:Number(process.env.FOUNDER_ACCOUNT_ID),
    email:process.env.FOUNDER_ACCOUNT_EMAIL,
    displayName:process.env.FOUNDER_PUBLIC_NAME??'Mariano Jiménez',
    phone:process.env.FOUNDER_WHATSAPP??'5493875467519',
    city:process.env.FOUNDER_CITY??'Cafayate',
    area:process.env.FOUNDER_AREA??'Vertientes'
  });
  console.log('Founder account bootstrap:',result.matched?'matched':'not found');
}
// The AI coach is enabled only when ANTHROPIC_API_KEY is set; everything else works without it.
const coach = process.env.ANTHROPIC_API_KEY ? anthropicCoach(process.env.ANTHROPIC_API_KEY, process.env.COACH_MODEL ?? 'claude-sonnet-5-5') : undefined;
// ADMIN_EMAILS=you@example.com[,other@…]: accounts that can open the founder telemetry panel.
const adminEmails = (process.env.ADMIN_EMAILS ?? '').split(',');
const app = buildApp({ db, staticDir, coach, adminEmails });
const port = Number(process.env.PORT ?? 3001);
await app.listen({ port, host: '0.0.0.0' });
console.log(`Fondal Fit on :${port} (${db.dialect})`);
