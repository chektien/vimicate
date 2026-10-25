import { narrationInsideHistoryWindow, sharedNarrationWindowCache } from './sharedNarrationWindow';
import { type WorkspaceMessage, type WorkspaceProject } from '../workspace/workspaceTypes';
import { authoritativeHistoryChronology } from '../workspace/historyMessageProjection';
import { coalesceTranscriptIdentities } from './transcriptIdentityWall';
import { gatewaySessionGeneration } from './registrySessionIdentity';

export const SHARED_NARRATION_CONTRACT = 'shared-narration-v1';
const PAGE_LIMIT = 128;
const MAX_RECORDS = 2_048;
const MAX_PAGES = 16;
const MAX_TEXT_BYTES = 64 * 1024;
const NATIVE_NARRATION_TIME_TOLERANCE_MS = 5_000;

export type SharedNarrationState = { sessionKey: string; sessionId: string };
export type SharedNarrationTransport = {
  sharedNarrationRequest: (params: Record<string, unknown>) => Promise<Record<string, unknown>>;
};

export function sharedNarrationStateForProject(
  project: WorkspaceProject | undefined,
  registry: Record<string, unknown> | null,
): SharedNarrationState | null {
  if (record(registry?.capabilities).sharedNarration !== SHARED_NARRATION_CONTRACT || !project) return null;
  const generation = gatewaySessionGeneration(project, registry);
  if (!generation) return null;
  return { sessionKey: project.sessionKey, sessionId: generation.sessionId };
}

export function sameSharedNarrationIdentity(left: SharedNarrationState | null, right: SharedNarrationState | null) {
  return left?.sessionKey === right?.sessionKey && left?.sessionId === right?.sessionId;
}

export async function loadSharedNarration(
  transport: SharedNarrationTransport,
  state: SharedNarrationState,
  signal?: AbortSignal,
): Promise<WorkspaceMessage[]> {
  // A host write invalidates a multi-page read. Start one fresh snapshot,
  // never append its rows to the abandoned one or retry arbitrary failures.
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await loadSnapshot(transport, state, signal);
    } catch (error) {
      if (signal?.aborted || attempt >= 1 || !(error instanceof Error)
        || !/^(?:vimicate narration page failed: )?vimicate shared narration: snapshot changed$/.test(error.message)) throw error;
    }
  }
}

async function loadSnapshot(
  transport: SharedNarrationTransport,
  state: SharedNarrationState,
  signal?: AbortSignal,
): Promise<WorkspaceMessage[]> {
  let cursor = 0;
  let snapshotToken = '';
  let totalRecords = -1;
  const messages: WorkspaceMessage[] = [];
  const seen = new Set<string>();

  for (let pageIndex = 0; pageIndex < MAX_PAGES; pageIndex += 1) {
    if (signal?.aborted) throw new Error('Shared narration hydration retired.');
    const payload = await transport.sharedNarrationRequest({
      contract: SHARED_NARRATION_CONTRACT,
      stableSessionKey: state.sessionKey,
      sessionId: state.sessionId,
      cursor,
      limit: PAGE_LIMIT,
      ...(snapshotToken ? { snapshotToken } : {}),
    });
    if (signal?.aborted) throw new Error('Shared narration hydration retired.');
    assertEnvelope(payload, state, cursor);
    const responseToken = text(payload.snapshotToken);
    if (!/^[A-Za-z0-9_-]{43}$/.test(responseToken) || (snapshotToken && responseToken !== snapshotToken)) {
      throw new Error('Shared narration snapshot changed during hydration.');
    }
    snapshotToken = responseToken;
    const responseTotal = integer(payload.totalRecords);
    if (responseTotal < 0 || responseTotal > MAX_RECORDS || (totalRecords >= 0 && responseTotal !== totalRecords)) {
      throw new Error('Shared narration changed its bounded record total.');
    }
    totalRecords = responseTotal;
    const records = Array.isArray(payload.records) ? payload.records : [];
    if (records.length > PAGE_LIMIT) throw new Error('Shared narration exceeded its page bound.');
    for (const raw of records) {
      const parsed = parseRecord(raw, state.sessionKey);
      const identity = `${parsed.runId}\u0000${parsed.itemId}`;
      if (seen.has(identity)) throw new Error('Shared narration repeated a record identity.');
      seen.add(identity);
      messages.push({ ...parsed.message, transcriptSessionId: state.sessionId, narrationItemId: parsed.itemId });
    }
    const expectedNext = cursor + records.length;
    if (payload.hasMore === true) {
      const nextCursor = integer(payload.nextCursor);
      if (nextCursor !== expectedNext || nextCursor <= cursor || nextCursor >= totalRecords) {
        throw new Error('Shared narration returned a non-monotonic cursor.');
      }
      cursor = nextCursor;
      continue;
    }
    if (payload.nextCursor != null || expectedNext !== totalRecords || messages.length !== totalRecords) {
      throw new Error('Shared narration ended with an incomplete snapshot.');
    }
    return messages;
  }
  throw new Error('Shared narration exceeded its page bound.');
}

/** Merge durable preambles by their live item identity, then order every
 * timestamped Gateway-history row and locally authored prompt in the one
 * canonical source coordinate. Local prompts remain optimistic while a run is
 * active, but their accepted-at timestamp is still authoritative relative to
 * the host-recorded narration timestamp. Excluding them here grouped every
 * steer ahead of a delayed preamble until chat.history caught up. */
export function mergeSharedNarration(messages: WorkspaceMessage[], narration: WorkspaceMessage[]) {
  narration = narrationInsideHistoryWindow(narration, messages);
  messages = sharedNarrationWindowCache(messages, messages);
  const known = new Map(narration.map(row => [row.id, row]));
  const nativeMatches = nativeNarrationMatches(messages, narration);
  const identified = messages.map(row => {
    const shared = known.get(row.id) ?? nativeMatches.get(row.id);
    if (!shared || shared.sessionKey !== row.sessionKey || !shared.transcriptSessionId || !shared.narrationItemId) return row;
    if (row.role !== 'narration' && row.role !== 'assistant') return row;
    return {
      ...row,
      role: 'narration' as const,
      transcriptSessionId: shared.transcriptSessionId,
      narrationItemId: shared.narrationItemId,
      ...(shared.runId ? { runId: shared.runId } : {}),
    };
  });
  return authoritativeHistoryChronology(
    coalesceTranscriptIdentities([...identified, ...narration]),
    (message) => message.source === 'history' || message.source === 'local' && message.role === 'user',
  );
}

/** OpenClaw 2 stores a flushed pre-tool text item as a native assistant event,
 * while the live and durable item streams identify that same publication as
 * narration. Correlate only an exact, timestamp-near, one-to-one pair. Equal
 * text in multiple turns remains deliberately ambiguous and is never merged. */
function nativeNarrationMatches(messages: WorkspaceMessage[], narration: WorkspaceMessage[]) {
  const candidates = new Map<string, WorkspaceMessage[]>();
  for (const shared of narration) {
    if (!shared.transcriptSessionId || !shared.narrationItemId) continue;
    const compatible = messages.filter((message) => nativeNarrationCandidate(message, shared));
    const exact = compatible.filter(message => message.id === shared.id
      || message.cliProvenance?.kind === 'claude-native' && message.cliProvenance.externalId === shared.id
      || message.narrationItemId === shared.narrationItemId);
    const runOwned = compatible.filter(message => message.runId && message.runId === shared.runId);
    const matches = exact.length ? exact : runOwned.length ? runOwned : compatible;
    if (matches.length === 1) candidates.set(shared.id, matches);
  }
  const sharedByNativeID = new Map<string, WorkspaceMessage[]>();
  for (const shared of narration) {
    const [native] = candidates.get(shared.id) ?? [];
    if (!native) continue;
    const existing = sharedByNativeID.get(native.id) ?? [];
    existing.push(shared);
    sharedByNativeID.set(native.id, existing);
  }
  return new Map([...sharedByNativeID].flatMap(([nativeID, shared]) => shared.length === 1 ? [[nativeID, shared[0]!] as const] : []));
}

function nativeNarrationCandidate(message: WorkspaceMessage, shared: WorkspaceMessage) {
  if (message.role !== 'assistant' || message.source !== 'history'
    || message.sessionKey !== shared.sessionKey
    || message.transcriptSessionId !== shared.transcriptSessionId
    || message.runId && shared.runId && message.runId !== shared.runId
    || message.narrationItemId && message.narrationItemId !== shared.narrationItemId
    || message.text !== shared.text) return false;
  const nativeTime = timestampMilliseconds(message.timestamp);
  const sharedTime = timestampMilliseconds(shared.timestamp);
  return nativeTime !== null && sharedTime !== null
    && Math.abs(nativeTime - sharedTime) <= NATIVE_NARRATION_TIME_TOLERANCE_MS;
}

function timestampMilliseconds(value: string | undefined) {
  if (!value) return null;
  const numeric = Number(value);
  if (Number.isFinite(numeric)) return Math.abs(numeric) < 100_000_000_000 ? numeric * 1_000 : numeric;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

function assertEnvelope(payload: Record<string, unknown>, state: SharedNarrationState, cursor: number) {
  if (payload.contract !== SHARED_NARRATION_CONTRACT
    || text(payload.stableSessionKey) !== state.sessionKey
    || text(payload.sessionId).toLowerCase() !== state.sessionId
    || integer(payload.cursor) !== cursor) {
    throw new Error('Shared narration returned an invalid authority envelope.');
  }
}

function parseRecord(value: unknown, sessionKey: string) {
  const raw = record(value);
  const runId = opaqueID(raw.runId, 'runId');
  const itemId = opaqueID(raw.itemId, 'itemId');
  const progressText = boundedText(raw.text);
  const firstSequence = positiveInteger(raw.firstSequence, 'firstSequence');
  const lastSequence = positiveInteger(raw.lastSequence, 'lastSequence');
  const firstTimestampMs = timestamp(raw.firstTimestampMs, 'firstTimestampMs');
  const lastTimestampMs = timestamp(raw.lastTimestampMs, 'lastTimestampMs');
  positiveInteger(raw.revision, 'revision');
  if (lastSequence < firstSequence || lastTimestampMs < firstTimestampMs) throw new Error('Shared narration record order regressed.');
  return {
    runId,
    itemId,
    message: {
      id: `live-item-${runId}-${itemId}`,
      role: 'narration' as const,
      text: progressText,
      timestamp: String(firstTimestampMs),
      runId,
      sessionKey,
      source: 'history' as const,
    },
  };
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function text(value: unknown) { return typeof value === 'string' ? value.trim() : ''; }
function integer(value: unknown) { return typeof value === 'number' && Number.isSafeInteger(value) ? value : -1; }
function positiveInteger(value: unknown, label: string) {
  const parsed = integer(value);
  if (parsed < 1) throw new Error(`Shared narration ${label} is invalid.`);
  return parsed;
}
function timestamp(value: unknown, label: string) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > Number.MAX_SAFE_INTEGER) throw new Error(`Shared narration ${label} is invalid.`);
  return value;
}
function opaqueID(value: unknown, label: string) {
  const parsed = text(value);
  if (!/^[\x21-\x7e]{1,256}$/.test(parsed)) throw new Error(`Shared narration ${label} is invalid.`);
  return parsed;
}
function boundedText(value: unknown) {
  const parsed = text(value);
  if (!parsed || utf8ByteLength(parsed) > MAX_TEXT_BYTES) throw new Error('Shared narration text is invalid.');
  return parsed;
}
function utf8ByteLength(value: string) {
  let bytes = 0;
  for (const symbol of value) {
    const point = symbol.codePointAt(0) ?? 0;
    bytes += point <= 0x7f ? 1 : point <= 0x7ff ? 2 : point <= 0xffff ? 3 : 4;
  }
  return bytes;
}
