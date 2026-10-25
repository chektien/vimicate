import path from 'node:path';
import { loadSqliteHistoryRuntime, sqliteHistoryRevision } from './sqlite-history-runtime.mjs';
import { readSqliteArchiveEvidence } from './sqlite-history-evidence.mjs';
export { SQLITE_HISTORY_RUNTIME } from './sqlite-history-runtime.mjs';

// Public chat.history requires a known message anchor when sessionId is set;
// it cannot serve arbitrary archived offset pages. This narrow adapter uses
// the exact upstream canonical reader, cap and display composer, never raw
// event JSON as UI output. Re-audit these private dependencies on every upgrade.
const MAX_BYTES = 512 * 1024;
const MAX_TOTAL = 32_768;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function requireValue(condition, message) {
  if (!condition) throw new Error(`vimicate sqlite history: ${message}`);
}
function integer(value, min, max) { return Number.isSafeInteger(value) && value >= min && value <= max; }
function assertActive(signal, disposed) {
  requireValue(!disposed, 'reader is disposed');
  signal?.throwIfAborted();
}
function statsIdentity(stats) {
  requireValue(stats && integer(stats.eventCount, 0, Number.MAX_SAFE_INTEGER)
    && integer(stats.maxSeq, 0, Number.MAX_SAFE_INTEGER) && integer(stats.sizeBytes, 0, Number.MAX_SAFE_INTEGER), 'invalid transcript stats');
  return `${stats.eventCount}:${stats.maxSeq}:${stats.sizeBytes}`;
}

/** The caller must additionally authorize the requested audited family member. */
export function createSqliteHistoryReader({ stateDir, native, env }) {
  requireValue(typeof stateDir === 'string' && path.isAbsolute(stateDir), 'absolute state directory required');
  requireValue(typeof native?.preparePage === 'function' || typeof native?.nextOffset === 'function', 'missing native pagination');
  for (const method of ['resolveOwner', 'readStats', 'readRevision', 'readPage', 'enrich', 'replaceOversized', 'capBytes', 'replayOldest', 'compose']) {
    requireValue(typeof native?.[method] === 'function', `missing native ${method}`);
  }
  let disposed = false;
  let pending = 0;
  return {
    dispose() { disposed = true; },
    async readPage(request) {
      const { agentId, stableSessionKey, sessionId, offset, limit, signal } = request;
      assertActive(signal, disposed);
      requireValue(typeof agentId === 'string' && /^[A-Za-z0-9_-]+$/.test(agentId), 'invalid agent scope');
      requireValue(typeof stableSessionKey === 'string' && stableSessionKey.length <= 1024
        && stableSessionKey.startsWith(`agent:${agentId}:`) && !/[\r\n]/.test(stableSessionKey), 'invalid route scope');
      requireValue(typeof sessionId === 'string' && UUID.test(sessionId), 'invalid concrete session');
      requireValue(integer(offset, 0, MAX_TOTAL) && integer(limit, 1, 128), 'invalid page bounds');
      requireValue(pending < 2, 'reader is busy');
      pending += 1;
      try {
        const storePath = path.join(stateDir, 'agents', agentId, 'sessions', 'sessions.json');
        const scope = { agentId, sessionKey: stableSessionKey, sessionId: sessionId.toLowerCase(), storePath, env };
        requireValue(native.resolveOwner(scope) === stableSessionKey, 'concrete session does not belong to route');
        const before = statsIdentity(native.readStats(scope));
        const revision = sqliteHistoryRevision(native.readRevision(scope));
        const raw = await native.readPage({
          entry: undefined, provider: '', sessionId: scope.sessionId, storePath,
          sessionAgentId: agentId, canonicalKey: stableSessionKey, ignoreCliSessionImports: true,
          max: limit, maxHistoryBytes: MAX_BYTES, effectiveMaxChars: 12_000, offset,
        });
        assertActive(signal, disposed);
        const pagination = raw?.pagination;
        requireValue(Array.isArray(raw?.messages) && pagination?.offset === offset
          && integer(pagination.totalMessages, offset, MAX_TOTAL)
          && integer(pagination.rawPageMessages, 0, MAX_TOTAL), 'native reader returned invalid pagination');
        // 10.5 no longer exports the private offset helper. Its canonical
        // response owner also groups replies before budget/cursor composition.
        const prepared = native.preparePage?.(raw, { maxHistoryBytes: MAX_BYTES });
        let next, messages;
        if (prepared) {
          requireValue(typeof prepared.hasMore === 'boolean' && prepared.totalMessages === pagination.totalMessages
            && (prepared.hasMore ? prepared.nextOffset !== undefined : prepared.nextOffset === undefined),
          'native response owner returned invalid pagination');
          next = prepared.nextOffset ?? pagination.totalMessages;
          messages = prepared.messages;
        } else {
          const normalized = native.enrich(raw.messages, undefined);
          const replaced = native.replaceOversized({ messages: normalized, maxSingleMessageBytes: 128 * 1024 });
          const bounded = native.capBytes(replaced.messages, MAX_BYTES).items;
          // Cursor calculation precedes display placement, which can move
          // late activity ahead of an earlier answer. Side sequences retain
          // the actual physical ordering after native reply projection.
          next = native.nextOffset({ messages: bounded, totalMessages: pagination.totalMessages,
            offset, rawPageMessages: pagination.rawPageMessages, projected: normalized,
            messageSequences: pagination.messageSequences,
            replayOldestRecord: native.replayOldest({ projected: normalized, bounded }) });
          messages = native.compose(bounded);
        }
        requireValue(integer(next, offset, pagination.totalMessages), 'native reader returned invalid cursor');
        const hasMore = pagination.exhausted !== true && next < pagination.totalMessages;
        requireValue(!hasMore || next > offset, 'native cursor made no progress');
        requireValue(Array.isArray(messages) && messages.length <= 512
          && Buffer.byteLength(JSON.stringify(messages)) <= MAX_BYTES, 'native projection exceeded page bound');
        requireValue(native.resolveOwner(scope) === stableSessionKey
          && statsIdentity(native.readStats(scope)) === before
          && sqliteHistoryRevision(native.readRevision(scope)) === revision, 'transcript changed during projection');
        assertActive(signal, disposed);
        return { sessionKey: stableSessionKey, sessionId: scope.sessionId, offset,
          totalMessages: pagination.totalMessages, hasMore, ...(hasMore ? { nextOffset: next } : {}), messages };
      } finally { pending -= 1; }
    },
  };
}

/** Verify before importing any private module; never patch the installed bundle. */
export async function loadSqliteHistoryReader({ packageRoot, stateDir, env = process.env }) {
  const { chat, readers, display, store, readRevision, preparePage } = await loadSqliteHistoryRuntime(packageRoot);
  return createSqliteHistoryReader({ stateDir, env, native: {
    resolveOwner: store.resolveTranscriptSessionKeyBySessionId,
    readStats: scope => readSqliteArchiveEvidence({ stateDir, ...scope }).stats,
    readRevision,
    readPage: chat.i, enrich: chat.r, replaceOversized: chat.c, capBytes: readers._,
    preparePage, nextOffset: chat.a, replayOldest: chat.o, compose: display.t,
  } });
}
