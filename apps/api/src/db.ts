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
CREATE TABLE IF NOT EXISTS approvals(id @ID, link_id INTEGER NOT NULL REFERENCES links(id) ON DELETE CASCADE, athlete_id INTEGER NOT NULL, change TEXT NOT NULL, violations TEXT NOT NULL, proposed_plan TEXT NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS nutrition(id @ID, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, kind TEXT NOT NULL, data TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS recovery(id @ID, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, data TEXT NOT NULL, score INTEGER NOT NULL, alerts TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS runs(id @ID, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, km @REAL NOT NULL, minutes @REAL NOT NULL, rpe @REAL NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS profiles(user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, data TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS activities(id @ID, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, sport TEXT NOT NULL, started_at TEXT NOT NULL, duration_sec INTEGER NOT NULL, moving_sec INTEGER NOT NULL, distance_m INTEGER NOT NULL, avg_pace_sec_km INTEGER NOT NULL, elev_gain_m INTEGER NOT NULL, route TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_activities_user ON activities(user_id);
CREATE TABLE IF NOT EXISTS audit(id @ID, actor_id INTEGER, subject_id INTEGER, action TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS daily_active(user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, day TEXT NOT NULL, PRIMARY KEY(user_id, day));
CREATE TABLE IF NOT EXISTS pro_templates(id @ID, pro_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, name TEXT NOT NULL, data TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS measurements(id @ID, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, day TEXT NOT NULL, data TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS coach_memory(user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, key TEXT NOT NULL, value TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY(user_id, key));
CREATE TABLE IF NOT EXISTS coach_messages(id @ID, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, role TEXT NOT NULL, content TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS gyms(
 id @ID,owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 name TEXT NOT NULL,city TEXT NOT NULL,area TEXT NOT NULL,created_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_gyms_owner ON gyms(owner_id);
CREATE TABLE IF NOT EXISTS gym_members(
 gym_id INTEGER NOT NULL REFERENCES gyms(id) ON DELETE CASCADE,
 user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 member_type TEXT NOT NULL CHECK(member_type IN ('coach','athlete')),
 status TEXT NOT NULL CHECK(status IN ('pending','active','revoked')),
 assigned_coach_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
 joined_at TEXT NOT NULL,
 PRIMARY KEY(gym_id,user_id));
CREATE INDEX IF NOT EXISTS idx_gym_members_user ON gym_members(user_id,status);
CREATE TABLE IF NOT EXISTS gym_billing(
 gym_id INTEGER PRIMARY KEY REFERENCES gyms(id) ON DELETE CASCADE,
 plan TEXT NOT NULL DEFAULT 'beta_free',status TEXT NOT NULL DEFAULT 'beta',
 updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS professional_profiles(
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  category TEXT NOT NULL CHECK(category IN ('medical','fitness')),
  display_name TEXT NOT NULL, specialty TEXT NOT NULL, credentials TEXT NOT NULL,
  profession TEXT NOT NULL DEFAULT 'physician',
  license TEXT NOT NULL, description TEXT NOT NULL, phone TEXT NOT NULL,
  city TEXT NOT NULL, area TEXT NOT NULL, modality TEXT NOT NULL,
  lat @REAL, lon @REAL, verified INTEGER NOT NULL DEFAULT 0,
  published INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  PRIMARY KEY(user_id,category));
CREATE INDEX IF NOT EXISTS idx_professional_directory ON professional_profiles(category,verified,published,city);
CREATE TABLE IF NOT EXISTS ranking(user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, alias TEXT NOT NULL, zone TEXT NOT NULL, enabled INTEGER NOT NULL, updated_at TEXT NOT NULL);
CREATE UNIQUE INDEX IF NOT EXISTS idx_ranking_alias ON ranking(alias);
CREATE INDEX IF NOT EXISTS idx_workouts_user ON workouts(user_id);
CREATE INDEX IF NOT EXISTS idx_plans_user ON plans(user_id, version);
CREATE INDEX IF NOT EXISTS idx_tokens_user ON tokens(user_id);
`;
/** Idempotent additive migration: adds a column to a table created by an earlier app version. */
async function ensureColumn(db: DB, table: string, column: string, ddlType: string) {
  const exists = db.dialect === 'pg'
    ? await db.prepare('SELECT 1 AS x FROM information_schema.columns WHERE table_name=? AND column_name=? AND table_schema=current_schema()').get(table, column)
    : (await db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).some((c) => c.name === column);
  if (!exists) await db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${ddlType}`);
}
async function migrate(db: DB) {
  await ensureColumn(db, 'users', 'pro_enabled', 'INTEGER NOT NULL DEFAULT 0');
  await ensureColumn(db, 'users', 'mode', 'TEXT');
  await ensureColumn(db, 'users', 'last_seen_at', 'TEXT');
  await ensureColumn(db, 'users', 'pro_code', 'TEXT');
  await ensureColumn(db, 'professional_profiles', 'profession', "TEXT NOT NULL DEFAULT 'physician'");
}

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
  await migrate(db);
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
  await migrate(db);
  return db;
}

/** `postgres://…` → PostgreSQL; anything else is a SQLite file path (or ':memory:'). */
export const openDb = (target = ':memory:'): Promise<DB> => (/^postgres(ql)?:\/\//.test(target) ? openPg(target) : openSqlite(target));
