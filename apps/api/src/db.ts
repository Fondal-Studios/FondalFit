import { createRequire } from 'node:module';
import type { DatabaseSync } from 'node:sqlite';

// createRequire keeps bundlers (vitest) from stripping the `node:` prefix of this built-in.
const { DatabaseSync: Sqlite } = createRequire(import.meta.url)('node:sqlite') as typeof import('node:sqlite');

export type DB = DatabaseSync;

export function openDb(path = ':memory:'): DB {
  const db = new Sqlite(path);
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec(`
  CREATE TABLE IF NOT EXISTS users(
    id INTEGER PRIMARY KEY, email TEXT UNIQUE NOT NULL, name TEXT NOT NULL, role TEXT NOT NULL,
    lang TEXT NOT NULL DEFAULT 'es', pass_hash TEXT NOT NULL, salt TEXT NOT NULL, created_at TEXT NOT NULL,
    trial_ends_at TEXT NOT NULL, plan TEXT NOT NULL DEFAULT 'trial', canceled_at TEXT);
  CREATE TABLE IF NOT EXISTS tokens(token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires_at TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS consents(user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, scope TEXT NOT NULL, granted INTEGER NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY(user_id, scope));
  CREATE TABLE IF NOT EXISTS assessments(id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, data TEXT NOT NULL, created_at TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS plans(id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, version INTEGER NOT NULL, data TEXT NOT NULL, source TEXT NOT NULL, created_at TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS workouts(id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, day_index INTEGER NOT NULL, data TEXT NOT NULL, created_at TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS links(id INTEGER PRIMARY KEY, pro_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, athlete_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status TEXT NOT NULL, limits TEXT NOT NULL, created_at TEXT NOT NULL, UNIQUE(pro_id, athlete_id));
  CREATE TABLE IF NOT EXISTS approvals(id INTEGER PRIMARY KEY, link_id INTEGER NOT NULL REFERENCES links(id) ON DELETE CASCADE, athlete_id INTEGER NOT NULL, change TEXT NOT NULL, violations TEXT NOT NULL, proposed_plan TEXT NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS nutrition(id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, kind TEXT NOT NULL, data TEXT NOT NULL, created_at TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS recovery(id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, data TEXT NOT NULL, score INTEGER NOT NULL, alerts TEXT NOT NULL, created_at TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS runs(id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, km REAL NOT NULL, minutes REAL NOT NULL, rpe REAL NOT NULL, created_at TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS audit(id INTEGER PRIMARY KEY, actor_id INTEGER, subject_id INTEGER, action TEXT NOT NULL, created_at TEXT NOT NULL);
  `);
  return db;
}
