import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { zstdDecompressSync } from 'node:zlib';
import { sqliteHistoryCheck as check } from './sqlite-history-runtime.mjs';

const MAX_BYTES = 32 * 1024 * 1024, MAX_RECORDS = 32_768;
const decoder = new TextDecoder('utf-8', { fatal: true });
function storageLayout(db) {
  const columns = new Set(db.prepare('PRAGMA table_info(transcript_events)').all().map(row => row.name));
  const compressed = columns.has('event_zstd'), length = columns.has('event_utf8_bytes');
  check(columns.has('event_json') && compressed === length, 'invalid transcript event storage');
  return compressed;
}
function eventStats(db, sessionId, compressed) {
  const row = db.prepare(compressed ? `SELECT COUNT(*) AS count, COALESCE(MAX(seq), 0) AS maxSeq,
    COALESCE(SUM(event_utf8_bytes), 0) AS bytes,
    COALESCE(SUM(CASE WHEN typeof(event_utf8_bytes) != 'integer' OR event_utf8_bytes < 1
      OR (event_json IS NULL) = (event_zstd IS NULL)
      OR (event_json IS NOT NULL AND OCTET_LENGTH(event_json) != event_utf8_bytes)
      THEN 1 ELSE 0 END), 0) AS invalid
    FROM transcript_events WHERE session_id = ?` : `SELECT COUNT(*) AS count, COALESCE(MAX(seq), 0) AS maxSeq,
    COALESCE(SUM(OCTET_LENGTH(event_json)), 0) AS bytes,
    COALESCE(SUM(event_json IS NULL), 0) AS invalid
    FROM transcript_events WHERE session_id = ?`).get(sessionId);
  check(row.invalid === 0 && Number.isSafeInteger(row.bytes), 'invalid transcript event storage');
  return row;
}
function decodeEvent(row, remaining) {
  check(Number.isSafeInteger(row.event_utf8_bytes) && row.event_utf8_bytes > 0
    && row.event_utf8_bytes <= remaining
    && (row.event_json === null) !== (row.event_zstd === null), 'invalid transcript event storage');
  let bytes;
  if (row.event_json !== null) {
    bytes = Buffer.from(row.event_json, 'utf8');
  } else {
    check(row.event_zstd instanceof Uint8Array, 'invalid transcript event storage');
    bytes = zstdDecompressSync(row.event_zstd, { maxOutputLength: remaining });
  }
  check(bytes.length === row.event_utf8_bytes, 'invalid transcript event storage');
  const json = decoder.decode(bytes);
  return { json, event: JSON.parse(json) };
}
function readEvents(db, sessionId, count, boundMessage, compressed) {
  check(count <= MAX_RECORDS, boundMessage);
  const rows = db.prepare(`SELECT seq, event_json, ${compressed ? 'event_zstd, event_utf8_bytes' :
    'NULL AS event_zstd, OCTET_LENGTH(event_json) AS event_utf8_bytes'}
    FROM transcript_events WHERE session_id = ? ORDER BY seq LIMIT 32769`).iterate(sessionId);
  const events = [];
  let bytes = 0;
  for (const row of rows) {
    check(events.length < MAX_RECORDS && row.event_utf8_bytes <= MAX_BYTES - bytes, boundMessage);
    const decoded = decodeEvent(row, MAX_BYTES - bytes);
    bytes += row.event_utf8_bytes;
    events.push({ seq: row.seq, ...decoded });
  }
  check(events.length === count, 'invalid transcript event storage');
  return events;
}

/** Exact-2026.8.1 integrity metadata, not a transcript projection. The public
 * raw-events/stats SDK joins a writable lifecycle, so evidence uses a fixed,
 * scoped read-only connection. It never creates, migrates or writes a DB. */
function withEvidenceDatabase({ stateDir, agentId, sessionKey, sessionId }, read) {
  check(typeof stateDir === 'string' && path.isAbsolute(stateDir) && typeof agentId === 'string' && /^[A-Za-z0-9_-]+$/.test(agentId)
    && typeof sessionKey === 'string' && sessionKey.length <= 1024 && sessionKey.length > agentId.length + 7
    && sessionKey.startsWith(`agent:${agentId}:`) && !/[\r\n]/.test(sessionKey)
    && typeof sessionId === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(sessionId), 'invalid evidence scope');
  const filename = path.join(stateDir, 'agents', agentId, 'agent', 'openclaw-agent.sqlite');
  const before = fs.lstatSync(filename);
  check(before.isFile() && !before.isSymbolicLink() && fs.realpathSync(filename) === filename, 'database path is not fixed');
  const db = new DatabaseSync(filename, { readOnly: true });
  try {
    db.exec('BEGIN');
    const result = read(db, storageLayout(db));
    db.exec('COMMIT');
    const after = fs.lstatSync(filename);
    check(after.dev === before.dev && after.ino === before.ino && !after.isSymbolicLink(), 'database replaced during verification');
    return result;
  } finally { db.close(); }
}
export function readSqliteArchiveEvidence(scope, includeRecords = false) {
  const { sessionKey, sessionId } = scope;
  return withEvidenceDatabase(scope, (db, compressed) => {
    // Matches native JSONL-accounting bytes: UTF-8 JSON plus inter-row newlines.
    const owned = db.prepare('SELECT 1 FROM session_windows WHERE session_key = ? AND session_id = ?').get(sessionKey, sessionId);
    const size = owned ? eventStats(db, sessionId, compressed) : { count: 0, maxSeq: 0, bytes: 0 };
    const stats = { eventCount: size.count, maxSeq: size.maxSeq,
      sizeBytes: size.bytes + Math.max(size.count - 1, 0) };
    const records = [];
    if (includeRecords) {
      check(stats.eventCount <= MAX_RECORDS && stats.sizeBytes <= MAX_BYTES, 'imported event bytes exceed bound');
      if (owned) for (const row of readEvents(db, sessionId, size.count, 'imported event bytes exceed bound', compressed))
        records.push({ seq: row.seq, event: row.event });
    }
    return { stats, records };
  });
}

/** Native previous_session_id is ancestry, not permission to concatenate.
 * Rewind/switch copies every non-header event at its original seq, then adds a
 * leaf control. Suppress that predecessor only after exact prefix proof. */
export function readSqliteNativeSegments(scope, anchorSessionId) {
  return withEvidenceDatabase(scope, (db, compressed) => {
    const window = db.prepare('SELECT session_key, previous_session_id FROM session_windows WHERE session_id = ?');
    const seen = new Set(), segments = [];
    let id = scope.sessionId;
    for (let depth = 0; depth < 128; depth++) {
      check(!seen.has(id), 'native ancestry cycle'); seen.add(id);
      const row = window.get(id);
      check(row?.session_key === scope.sessionKey, 'native ancestor belongs to another route or is missing');
      const size = eventStats(db, id, compressed);
      check(size.count <= MAX_RECORDS && size.bytes <= MAX_BYTES, 'native ancestry exceeds bounds');
      if (id === anchorSessionId) return segments.reverse();
      const previous = row.previous_session_id;
      if (!previous) {
        check(anchorSessionId === undefined, 'import anchor changed without native ancestry');
        return segments.reverse();
      }
      check(window.get(previous)?.session_key === scope.sessionKey, 'native ancestor belongs to another route or is missing');
      const priorSize = eventStats(db, previous, compressed);
      check(priorSize.count <= MAX_RECORDS && priorSize.bytes <= MAX_BYTES, 'native ancestry exceeds bounds');
      const current = readEvents(db, id, size.count, 'native ancestry exceeds bounds', compressed);
      const prior = readEvents(db, previous, priorSize.count, 'native ancestry exceeds bounds', compressed);
      const bySeq = new Map(current.map(event => [event.seq, event.json]));
      const ids = new Set(current.map(row => row.event?.id).filter(value => value != null));
      const body = prior.filter(row => row.event?.type !== 'session');
      check(body.every(row => typeof row.event?.type === 'string'), 'invalid transcript event storage');
      const isCopy = body.length > 0 && body.every(row => bySeq.get(row.seq) === row.json);
      check(isCopy || !body.some(row => row.event?.id != null && ids.has(row.event.id)), 'native ancestry has unproven partial overlap');
      if (!isCopy && body.length > 0) segments.push(previous);
      id = previous;
    }
    throw new Error('native ancestry exceeds window bound');
  });
}
