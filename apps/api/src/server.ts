import { fileURLToPath } from 'node:url';
import { buildApp } from './app';
import { anthropicCoach } from './coach';
import { openDb } from './db';

const staticDir = process.env.STATIC_DIR ?? fileURLToPath(new URL('../../web/dist', import.meta.url));
// DATABASE_URL (postgres://…) in production; falls back to a local SQLite file for development.
const db = await openDb(process.env.DATABASE_URL ?? process.env.DB_PATH ?? 'fondal.db');
// The AI coach is enabled only when ANTHROPIC_API_KEY is set; everything else works without it.
const coach = process.env.ANTHROPIC_API_KEY ? anthropicCoach(process.env.ANTHROPIC_API_KEY, process.env.COACH_MODEL ?? 'claude-sonnet-5-5') : undefined;
// ADMIN_EMAILS=you@example.com[,other@…]: accounts that can open the founder telemetry panel.
const adminEmails = (process.env.ADMIN_EMAILS ?? '').split(',');
const app = buildApp({ db, staticDir, coach, adminEmails });
const port = Number(process.env.PORT ?? 3001);
await app.listen({ port, host: '0.0.0.0' });
console.log(`Fondal Fit on :${port} (${db.dialect})`);
