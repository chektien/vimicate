import { parseArchivedSegment, type ArchiveIdentity, type ArchivedHistoryState, type ArchivedSegment } from './archivedHistory';
import type { HistoryCursor } from './historyPagination';
import { parsedTranscriptCache, serializedTranscriptCache } from './persistentTranscriptCache';
import type { GatewaySessionGeneration } from './registrySessionIdentity';
import type { SessionHistoryView } from './sessionHistoryView';
import type { WorkspaceMessage } from '../workspace/workspaceTypes';

const VERSION = 1;
const REVIEW_MESSAGE_LIMIT = 400;
const REVIEW_BYTE_LIMIT = 1_048_576;
const MAX_DETAIL_LENGTH = 2_000;

export type PersistedHistoryReview = {
  view: SessionHistoryView;
  messages: WorkspaceMessage[];
};

/**
 * A review descriptor is durable UI state, not canonical chat history. It is
 * generation-bound and bounded independently from the latest-tail cache so an
 * empty successor cannot make a previously loaded archive look blank after a
 * cold launch.
 */
export function serializedHistoryReview(view: SessionHistoryView, messages: WorkspaceMessage[]) {
  if (view.windowMode !== 'older' || !view.generation || !view.archive) return null;
  if (!messages.length && view.historyFailure !== 'older') return null;
  // A persisted older cursor points immediately before the oldest displayed
  // record. Keep that edge, not the newest tail, when this fallback is trimmed;
  // otherwise the next page skips the omitted interval after a cold restore.
  const boundedMessages = (JSON.parse(serializedTranscriptCache(messages.slice(0, REVIEW_MESSAGE_LIMIT).reverse(), {
    messageLimit: REVIEW_MESSAGE_LIMIT,
    byteLimit: REVIEW_BYTE_LIMIT,
  })) as unknown[]).reverse();
  return JSON.stringify({
    version: VERSION,
    generation: view.generation,
    archive: view.archive,
    cursor: view.cursor,
    historyFailure: view.historyFailure === 'older' ? 'older' : null,
    historyProblem: view.historyProblem.slice(0, MAX_DETAIL_LENGTH),
    messages: boundedMessages,
  });
}

export function parsedHistoryReview(payload: string | null): PersistedHistoryReview | null {
  if (!payload) return null;
  try {
    const value = record(JSON.parse(payload));
    if (value.version !== VERSION || !Array.isArray(value.messages)) return null;
    const generation = parsedGeneration(value.generation);
    const archive = parsedArchive(value.archive);
    const cursor = value.cursor == null ? null : parsedCursor(value.cursor);
    if (!generation || !archive || cursor === undefined) return null;
    if (archive.identity.currentSessionId !== generation.sessionId
      || archive.identity.currentSessionStartedAtMs !== generation.sessionStartedAtMs
      || (cursor && cursor.sessionKey !== archive.identity.sessionKey)) return null;
    const messages = parsedTranscriptCache(JSON.stringify(value.messages), REVIEW_MESSAGE_LIMIT)
      .filter((message) => message.sessionKey === archive.identity.sessionKey);
    const historyFailure = value.historyFailure === 'older' ? 'older' as const : null;
    if (!messages.length && historyFailure !== 'older') return null;
    return {
      view: {
        generation,
        archive,
        cursor,
        windowMode: 'older',
        // Durable rows are a safe fallback for an empty current generation,
        // not proof that the user is still deliberately reviewing them in
        // this process. A later nonempty current tail may therefore reveal.
        reviewEntryIntent: 'fallback',
        historyFailure,
        historyProblem: text(value.historyProblem).slice(0, MAX_DETAIL_LENGTH),
      },
      messages,
    };
  } catch {
    return null;
  }
}

function parsedGeneration(value: unknown): GatewaySessionGeneration | null {
  const row = record(value);
  const sessionId = text(row.sessionId).toLowerCase();
  const sessionStartedAtMs = positiveInteger(row.sessionStartedAtMs);
  return isUUID(sessionId) && sessionStartedAtMs
    ? { sessionId, sessionStartedAtMs, ...(row.historyModel === 'sqlite-display-v1' ? { historyModel: 'sqlite-display-v1' as const } : {}) }
    : null;
}

function parsedArchive(value: unknown): ArchivedHistoryState | null {
  const row = record(value);
  const identity = record(row.identity);
  const sessionKey = text(identity.sessionKey);
  const currentSessionId = text(identity.currentSessionId).toLowerCase();
  const currentSessionStartedAtMs = positiveInteger(identity.currentSessionStartedAtMs);
  if (!sessionKey || !isUUID(currentSessionId) || !currentSessionStartedAtMs || typeof row.exhausted !== 'boolean') return null;
  if (identity.contract !== undefined && identity.contract !== 'sqlite-family-v1') return null;
  const contract = identity.contract;
  const segments = row.segments == null ? undefined : parsedSegments(row.segments, contract);
  if (row.segments != null && !segments) return null;
  let nextArchivedIndex: number | undefined;
  if (row.nextArchivedIndex != null) {
    const parsed = integer(row.nextArchivedIndex);
    if (parsed === null) return null;
    nextArchivedIndex = parsed;
  }
  if (nextArchivedIndex !== undefined && (nextArchivedIndex < -1 || !segments || nextArchivedIndex >= segments.length)) return null;
  const pageCursor = row.pageCursor == null ? undefined : parsedPageCursor(row.pageCursor, segments?.length ?? 0);
  if (row.pageCursor != null && !pageCursor) return null;
  return {
    identity: { sessionKey, currentSessionId, currentSessionStartedAtMs, ...(contract ? { contract } : {}) },
    ...(typeof row.workspacePath === 'string' ? { workspacePath: row.workspacePath } : {}),
    ...(typeof row.familyToken === 'string' ? { familyToken: row.familyToken } : {}),
    ...(segments ? { segments } : {}),
    ...(nextArchivedIndex !== undefined ? { nextArchivedIndex } : {}),
    ...(pageCursor ? { pageCursor } : {}),
    exhausted: row.exhausted,
    ...(typeof row.blocked === 'string' ? { blocked: row.blocked.slice(0, MAX_DETAIL_LENGTH) } : {}),
  };
}

function parsedSegments(value: unknown, contract?: ArchiveIdentity['contract']): ArchivedSegment[] | null {
  if (!Array.isArray(value) || value.length > 1_024) return null;
  const segments: ArchivedSegment[] = [];
  for (let expectedOrder = 0; expectedOrder < value.length; expectedOrder += 1) {
    try { segments.push(parseArchivedSegment(value[expectedOrder], expectedOrder, contract)); }
    catch { return null; }
  }
  return segments;
}

function parsedPageCursor(value: unknown, segmentCount: number) {
  const row = record(value);
  const segmentIndex = integer(row.segmentIndex);
  const nextOffset = positiveInteger(row.nextOffset);
  const totalRawRecords = positiveInteger(row.totalRawRecords);
  if (segmentIndex === null || segmentIndex < 0 || segmentIndex >= segmentCount || !nextOffset || !totalRawRecords || nextOffset >= totalRawRecords) return null;
  return { segmentIndex, nextOffset, totalRawRecords };
}

function parsedCursor(value: unknown): HistoryCursor | undefined {
  const row = record(value);
  const sessionKey = text(row.sessionKey);
  const nextOffset = row.nextOffset === null ? null : nonnegativeInteger(row.nextOffset);
  const totalMessages = nonnegativeInteger(row.totalMessages);
  if (!sessionKey || nextOffset === undefined || totalMessages === undefined || typeof row.hasMore !== 'boolean') return undefined;
  if (row.hasMore && nextOffset === null) return undefined;
  return { sessionKey, nextOffset, hasMore: row.hasMore, totalMessages };
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function text(value: unknown) { return typeof value === 'string' ? value.trim() : ''; }
function integer(value: unknown) { return typeof value === 'number' && Number.isSafeInteger(value) ? value : null; }
function nonnegativeInteger(value: unknown) { const parsed = integer(value); return parsed !== null && parsed >= 0 ? parsed : undefined; }
function positiveInteger(value: unknown) { const parsed = integer(value); return parsed !== null && parsed > 0 ? parsed : 0; }
function isUUID(value: string) { return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value); }
