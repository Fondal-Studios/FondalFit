import { createRequire } from 'node:module';
import type { DatabaseSync } from 'node:sqlite';
import pg from 'pg';

/**
 * Minimal async DB layer with two drivers sharing one portable SQL dialect (`?` placeholders):
 * PostgreSQL when given a postgres:// URL (production), SQLite otherwise (local dev and fast tests).
 */
export interface Stmt {
  get(...p: unknown[]): Promise<unknown>;
  all(...p: unknown[]): Promise<unknown[]>;
  run(...p: unknown[]): Promise<{ changes: number }>;
}
export interface DB {
  dialect: 'pg' | 'sqlite';
  prepare(sql: string): Stmt;
  exec(sql: string): Promise<void>;
  close(): Promise<void>;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users(
  id @ID, email TEXT UNIQUE NOT NULL, name TEXT NOT NULL, role TEXT NOT NULL,
  lang TEXT NOT NULL DEFAULT 'es', pass_hash TEXT NOT NULL, salt TEXT NOT NULL, created_at TEXT NOT NULL,
  trial_ends_at TEXT NOT NULL, plan TEXT NOT NULL DEFAULT 'trial', canceled_at TEXT);
CREATE TABLE IF NOT EXISTS tokens(token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS consents(user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, scope TEXT NOT NULL, granted INTEGER NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY(user_id, scope));
CREATE TABLE IF NOT EXISTS assessments(id @ID, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, data TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS plans(id @ID, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, version INTEGER NOT NULL, data TEXT NOT NULL, source TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS workouts(id @ID, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, day_index INTEGER NOT NULL, data TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS links(id @ID, pro_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, athlete_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL, limits TEXT NOT NULL, created_at TEXT NOT NULL, UNIQUE(pro_id, athlete_id));
CREATE TABLE IF NOT EXISTS pro_codes(code TEXT PRIMARY KEY, pro_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS pro_templates(id @ID, pro_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, name TEXT NOT NULL, data TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_pro_templates_pro ON pro_templates(pro_id);
CREATE TABLE IF NOT EXISTS approvals(id @ID, link_id INTEGER NOT NULL REFERENCES links(id) ON DELETE CASCADE, athlete_id INTEGER NOT NULL, change TEXT NOT NULL, violations TEXT NOT NULL, proposed_plan TEXT NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS nutrition(id @ID, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, kind TEXT NOT NULL, data TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS recovery(id @ID, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, data TEXT NOT NULL, score INTEGER NOT NULL, alerts TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS runs(id @ID, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, km @REAL NOT NULL, minutes @REAL NOT NULL, rpe @REAL NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS audit(id @ID, actor_id INTEGER, subject_id INTEGER, action TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_workouts_user ON workouts(user_id);
CREATE INDEX IF NOT EXISTS idx_plans_user ON plans(user_id, version);
CREATE INDEX IF NOT EXISTS idx_tokens_user ON tokens(user_id);
`;
const ddl = (d: DB['dialect']) =>
  SCHEMA.replaceAll('@ID', d === 'pg' ? 'SERIAL PRIMARY KEY' : 'INTEGER PRIMARY KEY').replaceAll('@REAL', d === 'pg' ? 'DOUBLE PRECISION' : 'REAL')
    .split(';').map((s) => s.trim()).filter(Boolean);

async function openSqlite(path: string): Promise<DB> {
  // createRequire keeps bundlers (vitest) from stripping the `node:` prefix of this built-in.
  const { DatabaseSync: Sqlite } = createRequire(import.meta.url)('node:sqlite') as typeof import('node:sqlite');
  const raw: DatabaseSync = new Sqlite(path);
  raw.exec('PRAGMA foreign_keys = ON;');
  const db: DB = {
    dialect: 'sqlite',
    prepare: (sql) => ({
      get: async (...p) => raw.prepare(sql).get(...(p as never[])),
      all: async (...p) => raw.prepare(sql).all(...(p as never[])),
      run: async (...p) => ({ changes: Number(raw.prepare(sql).run(...(p as never[])).changes) }),
    }),
    exec: async (sql) => { raw.exec(sql); },
    close: async () => { raw.close(); },
  };
  for (const s of ddl('sqlite')) raw.exec(s);
  return db;
}

async function openPg(url: string): Promise<DB> {
  const pool = new pg.Pool({ connectionString: url, max: 10 });
  pool.on('error', (e) => console.error('pg pool error', e.message));
  const toPg = (sql: string) => { let i = 0; return sql.replace(/\?/g, () => `$${++i}`); };
  const db: DB = {
    dialect: 'pg',
    prepare: (sql) => ({
      get: async (...p) => (await pool.query(toPg(sql), p)).rows[0],
      all: async (...p) => (await pool.query(toPg(sql), p)).rows,
      run: async (...p) => ({ changes: (await pool.query(toPg(sql), p)).rowCount ?? 0 }),
    }),
    exec: async (sql) => { await pool.query(sql); },
    close: async () => { await pool.end(); },
  };
  for (const s of ddl('pg')) await pool.query(s);
  return db;
}

/** `postgres://…` → PostgreSQL; anything else is a SQLite file path (or ':memory:'). */
export const openDb = (target = ':memory:'): Promise<DB> => (/^postgres(ql)?:\/\//.test(target) ? openPg(target) : openSqlite(target));
