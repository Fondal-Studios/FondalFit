import { fileURLToPath } from 'node:url';
import { buildApp } from './app';
import { openDb } from './db';

const staticDir = process.env.STATIC_DIR ?? fileURLToPath(new URL('../../web/dist', import.meta.url));
// DATABASE_URL (postgres://…) in production; falls back to a local SQLite file for development.
const db = await openDb(process.env.DATABASE_URL ?? process.env.DB_PATH ?? 'fondal.db');
const app = buildApp({ db, staticDir });
const port = Number(process.env.PORT ?? 3001);
await app.listen({ port, host: '0.0.0.0' });
console.log(`Fondal Fit on :${port} (${db.dialect})`);
