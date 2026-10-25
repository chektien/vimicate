import * as SQLite from 'expo-sqlite';
import { contentHash } from './contentHash';

const DATABASE_NAME = 'vimicate-rn-phase1-lab.db';
export type StorageStats = { rows: number; bytes: number; pageCount: number; pageSize: number; integrity: string };
export type StoredMessage = { source_id: string; ordinal: number; role: string; body: string };
let database: Promise<SQLite.SQLiteDatabase> | null = null;

export async function openLabDatabase() {
  database ??= SQLite.openDatabaseAsync(DATABASE_NAME);
  const db = await database;
  await db.execAsync(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY NOT NULL, applied_at_ms INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS transcript_messages (
      source_id TEXT PRIMARY KEY NOT NULL,
      ordinal INTEGER NOT NULL UNIQUE,
      role TEXT NOT NULL,
      body TEXT NOT NULL,
      content_hash TEXT NOT NULL,
      updated_at_ms INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_transcript_ordinal ON transcript_messages(ordinal);
    INSERT OR IGNORE INTO schema_migrations(version, applied_at_ms) VALUES (1, unixepoch('subsec') * 1000);
  `);
  return db;
}
export async function seedCorpus(targetRows = 6500, onProgress?: (rows: number) => void) {
  const db = await openLabDatabase(); const payload = '0123456789abcdef'.repeat(510);
  const started = performance.now();
  for (let start = 0; start < targetRows; start += 250) {
    const end = Math.min(targetRows, start + 250);
    await db.withExclusiveTransactionAsync(async (tx) => {
      const statement = await tx.prepareAsync(`INSERT INTO transcript_messages(source_id, ordinal, role, body, content_hash, updated_at_ms)
        VALUES ($id, $ordinal, $role, $body, $hash, $updated)
        ON CONFLICT(source_id) DO UPDATE SET ordinal=excluded.ordinal, role=excluded.role, body=excluded.body, content_hash=excluded.content_hash, updated_at_ms=excluded.updated_at_ms
        WHERE transcript_messages.content_hash != excluded.content_hash`);
      try {
        for (let ordinal = start; ordinal < end; ordinal += 1) {
          const body = `${String(ordinal).padStart(6, '0')}|${payload}`;
          await statement.executeAsync({ $id: `fixture-${ordinal}`, $ordinal: ordinal, $role: ordinal % 7 === 0 ? 'tool' : ordinal % 2 ? 'assistant' : 'user', $body: body, $hash: contentHash(body), $updated: Date.now() });
        }
      } finally { await statement.finalizeAsync(); }
    });
    onProgress?.(end); await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
  return Math.round(performance.now() - started);
}
export async function queryWindow(center: number, limit = 80) {
  const db = await openLabDatabase(); const half = Math.floor(limit / 2);
  return db.getAllAsync<StoredMessage>('SELECT source_id, ordinal, role, body FROM transcript_messages WHERE ordinal >= ? ORDER BY ordinal LIMIT ?', Math.max(0, center - half), limit);
}
export async function verifyNoOpUpsert() {
  const db = await openLabDatabase(); const row = await db.getFirstAsync<{ source_id: string; ordinal: number; role: string; body: string; content_hash: string }>('SELECT source_id, ordinal, role, body, content_hash FROM transcript_messages ORDER BY ordinal LIMIT 1');
  if (!row) return -1;
  const result = await db.runAsync(`INSERT INTO transcript_messages(source_id, ordinal, role, body, content_hash, updated_at_ms) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(source_id) DO UPDATE SET body=excluded.body, content_hash=excluded.content_hash, updated_at_ms=excluded.updated_at_ms WHERE transcript_messages.content_hash != excluded.content_hash`, row.source_id, row.ordinal, row.role, row.body, row.content_hash, Date.now());
  return result.changes;
}
export async function storageStats(): Promise<StorageStats> {
  const db = await openLabDatabase();
  const rows = (await db.getFirstAsync<{ value: number }>('SELECT COUNT(*) AS value FROM transcript_messages'))?.value ?? 0;
  const pageCount = (await db.getFirstAsync<{ page_count: number }>('PRAGMA page_count'))?.page_count ?? 0;
  const pageSize = (await db.getFirstAsync<{ page_size: number }>('PRAGMA page_size'))?.page_size ?? 0;
  const integrity = (await db.getFirstAsync<{ integrity_check: string }>('PRAGMA integrity_check'))?.integrity_check ?? 'unknown';
  return { rows, pageCount, pageSize, bytes: pageCount * pageSize, integrity };
}
export async function clearLabCorpus() { const db = await openLabDatabase(); await db.runAsync('DELETE FROM transcript_messages'); await db.execAsync('PRAGMA wal_checkpoint(TRUNCATE); VACUUM;'); }
