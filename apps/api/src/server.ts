import { fileURLToPath } from 'node:url';
import { buildApp } from './app';
import { openDb } from './db';

const staticDir = process.env.STATIC_DIR ?? fileURLToPath(new URL('../../web/dist', import.meta.url));
const app = buildApp({ db: openDb(process.env.DB_PATH ?? 'fondal.db'), staticDir });
const port = Number(process.env.PORT ?? 3001);
app.listen({ port, host: '0.0.0.0' }).then(() => console.log(`Fondal Fit on :${port}`));
