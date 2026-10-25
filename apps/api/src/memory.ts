import { z } from 'zod';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { DB } from './db';
import type { RouteCtx } from './admin';

type Guard = (req: FastifyRequest, reply: FastifyReply) => Promise<unknown>;
export interface MemoryCtx extends RouteCtx { athleteOnly: Guard }

export const TONES = ['direct', 'motivating', 'technical', 'friendly'] as const;
export const TONE_PROMPT: Record<(typeof TONES)[number], string> = {
  direct: 'Tone: concise and direct. No filler, no pep talk.',
  motivating: 'Tone: warm and encouraging. Celebrate consistency and progress; keep advice realistic.',
  technical: 'Tone: precise and technical. Give the physiological reasoning and numbers when relevant.',
  friendly: 'Tone: friendly, relaxed and conversational.',
};
export const MEMORY_LIMIT = 40;
const KEY = /^[a-z][a-z0-9_]{1,29}$/;

export const loadMemory = async (db: DB, uid: number) =>
  (await db.prepare('SELECT key,value FROM coach_memory WHERE user_id=? ORDER BY updated_at DESC').all(uid) as { key: string; value: string }[]);

export async function saveMemory(db: DB, uid: number, key: string, value: string, now: string): Promise<boolean> {
  if (!KEY.test(key) || !value.trim() || value.length > 300) return false;
  const have = await db.prepare('SELECT key FROM coach_memory WHERE user_id=? AND key=?').get(uid, key);
  if (!have) {
    const n = (await db.prepare('SELECT CAST(COUNT(*) AS INTEGER) c FROM coach_memory WHERE user_id=?').get(uid) as { c: number }).c;
    if (n >= MEMORY_LIMIT) return false;
  }
  await db.prepare('INSERT INTO coach_memory(user_id,key,value,updated_at) VALUES(?,?,?,?) ON CONFLICT(user_id,key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at').run(uid, key, value.trim(), now);
  return true;
}

/** `[[memory: key=value]]` tags the model appends when it learns a stable preference or decision. Returns the cleaned text and the facts. */
export function extractMemoryTags(text: string): { text: string; facts: { key: string; value: string }[] } {
  const facts: { key: string; value: string }[] = [];
  const clean = text.replace(/\[\[memory:\s*([a-z][a-z0-9_]{1,29})\s*=\s*([^\]]{1,300})\]\]/gi, (_, k: string, v: string) => { facts.push({ key: k.toLowerCase(), value: v.trim() }); return ''; }).replace(/\n{3,}/g, '\n\n').trim();
  return { text: clean, facts };
}

export function registerMemory(c: MemoryCtx) {
  const { app, db, athleteOnly } = c;
  app.get('/api/coach/memory', { preHandler: athleteOnly }, async (req) => ({ memory: await loadMemory(db, req.user!.id), limit: MEMORY_LIMIT, tones: TONES }));
  app.put('/api/coach/memory', { preHandler: athleteOnly }, async (req, reply) => {
    const b = c.parse(z.object({ key: z.string().regex(KEY), value: z.string().trim().min(1).max(300) }), req.body, reply);
    if (!b) return;
    if (b.key === 'coach_tone' && !(TONES as readonly string[]).includes(b.value)) return reply.code(400).send({ error: 'invalid_tone' });
    const ok = await saveMemory(db, req.user!.id, b.key, b.value, c.now());
    return ok ? { ok: true } : reply.code(409).send({ error: 'memory_full' });
  });
  app.delete('/api/coach/memory/:key', { preHandler: athleteOnly }, async (req, reply) => {
    const r = await db.prepare('DELETE FROM coach_memory WHERE user_id=? AND key=?').run(req.user!.id, (req.params as { key: string }).key);
    return r.changes ? { ok: true } : reply.code(404).send({ error: 'not_found' });
  });
  app.delete('/api/coach/memory', { preHandler: athleteOnly }, async (req) => { await db.prepare('DELETE FROM coach_memory WHERE user_id=?').run(req.user!.id); await db.prepare('DELETE FROM coach_messages WHERE user_id=?').run(req.user!.id); return { ok: true }; });
  app.get('/api/coach/history', { preHandler: athleteOnly }, async (req) => ({
    messages: ((await db.prepare('SELECT role,content,created_at FROM coach_messages WHERE user_id=? ORDER BY id DESC LIMIT 40').all(req.user!.id)) as { role: string; content: string; created_at: string }[]).reverse(),
  }));
}
