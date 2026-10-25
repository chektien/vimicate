import crypto from 'node:crypto';
import path from 'node:path';
import { archiveRecordsDigest } from './session-archive-verification.mjs';
import { loadSqliteHistoryRuntime, sqliteHistoryCheck as check, sqliteHistoryRevision } from './sqlite-history-runtime.mjs';
import { readSqliteArchiveEvidence, readSqliteNativeSegments } from './sqlite-history-evidence.mjs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const integer = (v, min, max) => Number.isSafeInteger(v) && v >= min && v <= max;
const MAX_BYTES = 32 * 1024 * 1024;
/** Read-only scope/evidence port; no session-store writes or JSONL fallback. */
export function createSqliteHistoryAuthority({ stateDir, env, native }) {
  check(typeof stateDir === 'string' && path.isAbsolute(stateDir), 'absolute state directory required');
  for (const name of ['current', 'owner', 'stats', 'revision', 'events']) check(typeof native?.[name] === 'function', `missing native ${name}`);
  function scope(key, sessionId) {
    check(typeof key === 'string' && key.length <= 1024 && !/[\r\n]/.test(key), 'invalid route scope');
    const match = /^agent:([A-Za-z0-9_-]+):.+$/.exec(key);
    check(match, 'invalid route scope');
    check(sessionId === undefined || (typeof sessionId === 'string' && UUID.test(sessionId)), 'invalid concrete scope');
    return { agentId: match[1], sessionKey: key, ...(sessionId ? { sessionId } : {}),
      env, storePath: path.join(stateDir, 'agents', match[1], 'sessions', 'sessions.json') };
  }
  function readCurrent(key) {
    const entry = native.current({ ...scope(key), readOnly: true });
    if (!entry) return null;
    check(typeof entry.sessionId === 'string' && UUID.test(entry.sessionId)
      && integer(entry.sessionStartedAt, 1, Number.MAX_SAFE_INTEGER)
      && (entry.lifecycleRevision === undefined || (typeof entry.lifecycleRevision === 'string'
        && entry.lifecycleRevision.length > 0 && entry.lifecycleRevision.length <= 256)), 'invalid current lifecycle metadata');
    check(native.owner(scope(key, entry.sessionId)) === key, 'current session belongs to another route');
    return { sessionId: entry.sessionId, sessionStartedAtMs: entry.sessionStartedAt,
      lifecycleRevision: entry.lifecycleRevision ?? null };
  }
  function evidence(key, sessionId) {
    const target = scope(key, sessionId);
    check(native.owner(target) === key, 'archive belongs to another route or is missing');
    const stats = native.stats(target);
    check(stats && integer(stats.eventCount, 1, 32_768) && integer(stats.maxSeq, 0, Number.MAX_SAFE_INTEGER)
      && integer(stats.sizeBytes, 1, MAX_BYTES), 'archive exceeds verification bounds or is missing');
    const watermark = native.revision(target);
    check(watermark?.generation !== null && watermark?.maxSeq === stats.maxSeq, 'archive watermark is unavailable');
    const revision = crypto.createHash('sha256').update(JSON.stringify([
      key, sessionId, stats.eventCount, stats.maxSeq, stats.sizeBytes, sqliteHistoryRevision(watermark),
    ])).digest('hex');
    return { target, stats, revision };
  }
  async function verifyArchive({ stableSessionKey, archive, signal }) {
    signal?.throwIfAborted();
    const before = evidence(stableSessionKey, archive.sessionId);
    check(before.stats.eventCount === archive.records && before.stats.sizeBytes === archive.importedBytes, 'imported record count or bytes differ');
    const rows = native.events(before.target);
    check(Array.isArray(rows) && rows.length === archive.records, 'imported records are incomplete');
    let prior = -1, bytes = 0;
    const records = rows.map(row => {
      check(integer(row.seq, prior + 1, before.stats.maxSeq) && row.event && typeof row.event === 'object', 'invalid imported event');
      prior = row.seq; bytes += Buffer.byteLength(JSON.stringify(row.event));
      check(bytes <= MAX_BYTES, 'imported event bytes exceed bound');
      return row.event;
    });
    check(records[0]?.type === 'session' && records[0]?.id === archive.sessionId
      && archiveRecordsDigest(records) === archive.importedDigest, 'imported content digest differs');
    signal?.throwIfAborted();
    check(evidence(stableSessionKey, archive.sessionId).revision === before.revision, 'archive changed during verification');
    return before.revision;
  }
  return { readCurrent, verifyArchive,
    readCurrentGenerations(agentIds) {
      check(Array.isArray(agentIds) && agentIds.length > 0 && agentIds.length <= 32
        && agentIds.every(id => typeof id === 'string' && /^[A-Za-z0-9_-]+$/.test(id)), 'invalid configured agents');
      check(typeof native.list === 'function', 'native current census unavailable');
      const rows = {};
      for (const agentId of new Set(agentIds)) {
        const entries = native.list({ agentId, env, readOnly: true,
          storePath: path.join(stateDir, 'agents', agentId, 'sessions', 'sessions.json') });
        check(Array.isArray(entries) && entries.length <= 4096, 'native current census exceeds bound');
        for (const { sessionKey, entry } of entries) {
          check(sessionKey.startsWith(`agent:${agentId}:`) && Object.keys(rows).length < 4096, 'invalid current census scope');
          // Legacy task rows may lack an epoch or use an arbitrary explicit ID.
          // They cannot authorize a UUID-scoped Vimicate family. Omit them,
          // never invent an identity/epoch or block unrelated current projects.
          if (!UUID.test(entry?.sessionId ?? '') || !integer(entry?.sessionStartedAt, 1, Number.MAX_SAFE_INTEGER)) continue;
          const current = readCurrent(sessionKey);
          if (current) rows[sessionKey] = current;
        }
      }
      return rows;
    },
    readNativeSegments: ({ stableSessionKey, sessionId, anchorSessionId }) => {
      const target = scope(stableSessionKey, sessionId);
      check(native.owner(target) === stableSessionKey, 'current session belongs to another route');
      check(typeof native.lineage === 'function', 'native continuity port is unavailable');
      return native.lineage(target, anchorSessionId);
    },
    readArchiveRevision: ({ stableSessionKey, sessionId }) => evidence(stableSessionKey, sessionId).revision };
}
export async function loadSqliteHistoryAuthority({ packageRoot, stateDir, env = process.env }) {
  const { store, readRevision } = await loadSqliteHistoryRuntime(packageRoot);
  return createSqliteHistoryAuthority({ stateDir, env, native: {
    current: store.getSessionEntry, list: store.listSessionEntries, owner: store.resolveTranscriptSessionKeyBySessionId,
    stats: target => readSqliteArchiveEvidence({ stateDir, ...target }).stats, revision: readRevision,
    // SDK loadTranscriptEventsSync joins a writable DB lifecycle. Integrity
    // verification instead uses one bounded, explicitly read-only query. Raw
    // records never become an RPC payload; UI projection stays upstream-owned.
    events: target => readSqliteArchiveEvidence({ stateDir, ...target }, true).records,
    lineage: (target, anchor) => readSqliteNativeSegments({ stateDir, ...target }, anchor),
  } });
}
