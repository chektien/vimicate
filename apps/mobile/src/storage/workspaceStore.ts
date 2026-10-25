import * as SQLite from 'expo-sqlite';
import { withPersistenceActivity } from '../../modules/vimicate-persistence-activity';
import type { WorkspaceMessage } from '../workspace/workspaceTypes';
import { parsedTranscriptCache, serializedTranscriptCache } from '../gateway/persistentTranscriptCache';
import { WorkspacePersistenceQueue } from './workspacePersistenceQueue';
import { normalizedCommandHistory } from '../keyboard/commandHistory';

const DATABASE_NAME = 'vimicate-rn-workspace.db';
const COMMAND_HISTORY_LIMIT = 100;
let databaseReady: Promise<SQLite.SQLiteDatabase> | null = null;
let commandHistoryWriteSequence = 0;
const persistence = new WorkspacePersistenceQueue(withPersistenceActivity, false);

function openWorkspaceDatabase() {
  if (databaseReady) return databaseReady;
  let opened: SQLite.SQLiteDatabase | null = null;
  const initialization = persistence.enqueue('database:init', async () => {
    const db = await SQLite.openDatabaseAsync(DATABASE_NAME);
    await db.execAsync(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS workspace_state (
        key TEXT PRIMARY KEY NOT NULL,
        value TEXT NOT NULL,
        updated_at_ms INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS drafts (
        session_key TEXT PRIMARY KEY NOT NULL,
        body TEXT NOT NULL,
        updated_at_ms INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS prompt_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_key TEXT NOT NULL,
        body TEXT NOT NULL,
        created_at_ms INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_prompt_history_session
        ON prompt_history(session_key, id DESC);
      CREATE TABLE IF NOT EXISTS command_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        body TEXT NOT NULL,
        created_at_ms INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS transcript_cache (
        session_key TEXT PRIMARY KEY NOT NULL,
        payload TEXT NOT NULL,
        updated_at_ms INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_transcript_cache_updated
        ON transcript_cache(updated_at_ms DESC);
      CREATE TABLE IF NOT EXISTS history_review_cache (
        session_key TEXT PRIMARY KEY NOT NULL,
        payload TEXT NOT NULL,
        updated_at_ms INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_history_review_cache_updated
        ON history_review_cache(updated_at_ms DESC);
    `);
    opened = db;
  });
  databaseReady = initialization.then(() => {
    if (!opened) throw new Error('workspace database initialized without a handle');
    return opened;
  }).catch((error: unknown) => {
    databaseReady = null;
    throw error;
  });
  return databaseReady;
}

function enqueueDatabaseWrite(key: string, task: (db: SQLite.SQLiteDatabase) => Promise<void>) {
  const ready = openWorkspaceDatabase();
  return persistence.enqueue(key, async () => task(await ready));
}

export function setWorkspacePersistenceActive(active: boolean) { persistence.setActive(active); }

export async function loadValue(key: string) {
  const db = await databaseAfterPendingWrites();
  return (await db.getFirstAsync<{ value: string }>('SELECT value FROM workspace_state WHERE key = ?', key))?.value ?? null;
}

export async function saveValue(key: string, value: string) {
  await enqueueDatabaseWrite(`state:${key}`, async (db) => {
    await db.runAsync('INSERT INTO workspace_state(key, value, updated_at_ms) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at_ms=excluded.updated_at_ms', key, value, Date.now());
  });
}

export async function loadDraft(sessionKey: string) {
  const db = await databaseAfterPendingWrites();
  return (await db.getFirstAsync<{ body: string }>('SELECT body FROM drafts WHERE session_key = ?', sessionKey))?.body ?? '';
}

export async function saveDraft(sessionKey: string, body: string) {
  await enqueueDatabaseWrite(`draft:${sessionKey}`, async (db) => {
    await db.runAsync('INSERT INTO drafts(session_key, body, updated_at_ms) VALUES (?, ?, ?) ON CONFLICT(session_key) DO UPDATE SET body=excluded.body, updated_at_ms=excluded.updated_at_ms', sessionKey, body, Date.now());
  });
}

export async function loadPromptHistory(sessionKey: string, limit = 100) {
  const db = await databaseAfterPendingWrites();
  const rows = await db.getAllAsync<{ body: string }>(
    `SELECT body FROM (
       SELECT id, body FROM prompt_history
       WHERE session_key = ?
       ORDER BY id DESC
       LIMIT ?
     ) ORDER BY id ASC`,
    sessionKey,
    limit,
  );
  return rows.map((row) => row.body);
}

export async function appendPromptHistory(sessionKey: string, body: string, limit = 100) {
  const text = body.trim();
  if (!sessionKey || !text) return;
  await enqueueDatabaseWrite(`prompt-history:${sessionKey}`, async (db) => {
    await db.runAsync(
      'INSERT INTO prompt_history(session_key, body, created_at_ms) VALUES (?, ?, ?)',
      sessionKey,
      text,
      Date.now(),
    );
    await db.runAsync(
      `DELETE FROM prompt_history
       WHERE session_key = ? AND id NOT IN (
         SELECT id FROM prompt_history WHERE session_key = ? ORDER BY id DESC LIMIT ?
       )`,
      sessionKey,
      sessionKey,
      limit,
    );
  });
}

export async function loadCommandHistory() {
  const db = await databaseAfterPendingWrites();
  const rows = await db.getAllAsync<{ body: unknown }>(
    `SELECT body FROM (
       SELECT id, body FROM command_history ORDER BY id DESC LIMIT ?
     ) ORDER BY id ASC`,
    COMMAND_HISTORY_LIMIT,
  );
  return normalizedCommandHistory(rows.map((row) => row.body));
}

export async function appendCommandHistory(body: string) {
  const command = normalizedCommandHistory([body])[0];
  if (!command) return;
  commandHistoryWriteSequence += 1;
  await enqueueDatabaseWrite(`command-history:${commandHistoryWriteSequence}`, async (db) => {
    const latest = await db.getFirstAsync<{ body: string }>('SELECT body FROM command_history ORDER BY id DESC LIMIT 1');
    if (latest?.body === command) return;
    await db.runAsync('INSERT INTO command_history(body, created_at_ms) VALUES (?, ?)', command, Date.now());
    await db.runAsync('DELETE FROM command_history WHERE id NOT IN (SELECT id FROM command_history ORDER BY id DESC LIMIT ?)', COMMAND_HISTORY_LIMIT);
  });
}

export async function loadTranscriptCache(sessionKey: string) {
  if (!sessionKey) return [];
  const db = await databaseAfterPendingWrites();
  const row = await db.getFirstAsync<{ payload: string }>('SELECT payload FROM transcript_cache WHERE session_key = ?', sessionKey);
  return parsedTranscriptCache(row?.payload ?? null);
}

export async function saveTranscriptCache(sessionKey: string, messages: WorkspaceMessage[], sessionLimit = 64) {
  if (!sessionKey) return;
  const payload = serializedTranscriptCache(messages);
  await enqueueDatabaseWrite(`transcript:${sessionKey}`, async (db) => {
    await db.runAsync('INSERT INTO transcript_cache(session_key, payload, updated_at_ms) VALUES (?, ?, ?) ON CONFLICT(session_key) DO UPDATE SET payload=excluded.payload, updated_at_ms=excluded.updated_at_ms', sessionKey, payload, Date.now());
    await db.runAsync('DELETE FROM transcript_cache WHERE session_key NOT IN (SELECT session_key FROM transcript_cache ORDER BY updated_at_ms DESC LIMIT ?)', sessionLimit);
  });
}

export async function loadHistoryReviewCache(sessionKey: string) {
  if (!sessionKey) return null;
  const db = await databaseAfterPendingWrites();
  return (await db.getFirstAsync<{ payload: string }>('SELECT payload FROM history_review_cache WHERE session_key = ?', sessionKey))?.payload ?? null;
}

export async function saveHistoryReviewCache(sessionKey: string, payload: string | null, sessionLimit = 64) {
  if (!sessionKey) return;
  await enqueueDatabaseWrite(`history-review:${sessionKey}`, async (db) => {
    if (!payload) {
      await db.runAsync('DELETE FROM history_review_cache WHERE session_key = ?', sessionKey);
      return;
    }
    await db.runAsync('INSERT INTO history_review_cache(session_key, payload, updated_at_ms) VALUES (?, ?, ?) ON CONFLICT(session_key) DO UPDATE SET payload=excluded.payload, updated_at_ms=excluded.updated_at_ms', sessionKey, payload, Date.now());
    await db.runAsync('DELETE FROM history_review_cache WHERE session_key NOT IN (SELECT session_key FROM history_review_cache ORDER BY updated_at_ms DESC LIMIT ?)', sessionLimit);
  });
}

async function databaseAfterPendingWrites() {
  const ready = openWorkspaceDatabase();
  await persistence.barrier();
  return ready;
}
