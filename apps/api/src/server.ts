import { buildApp } from './app';
import { openDb } from './db';

const app = buildApp({ db: openDb(process.env.DB_PATH ?? 'fondal.db') });
const port = Number(process.env.PORT ?? 3001);
app.listen({ port, host: '0.0.0.0' }).then(() => console.log(`API on :${port}`));
