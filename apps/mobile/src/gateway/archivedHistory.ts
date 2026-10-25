import { type WorkspaceMessage, type WorkspaceProject } from '../workspace/workspaceTypes';
import { messagesFromPayload } from '../workspace/historyMessageProjection';
import { gatewaySessionGeneration } from './registrySessionIdentity';

const CONTRACT = 'archived-family-v1';
const PROOF = 'audited-baseline+contiguous-ledger-v1';
const SQLITE_CONTRACT = 'sqlite-family-v1';
const SQLITE_PROOF = 'verified-import+sqlite-ownership-v1';
const MAX_PROJECTED_PAGE_ROWS = 512;

export type ArchiveIdentity = { sessionKey: string; currentSessionId: string; currentSessionStartedAtMs: number; contract?: 'sqlite-family-v1' };
export type ArchivedSegment = { sessionId: string; order: number; state: 'archived' | 'current'; startedAtMs?: number; endedAtMs?: number; endReason?: string; sourceRevision: string };
export type ArchivedPageCursor = { segmentIndex: number; nextOffset: number; totalRawRecords: number };
export type ArchivedHistoryState = { identity: ArchiveIdentity; workspacePath?: string; familyToken?: string; segments?: ArchivedSegment[]; nextArchivedIndex?: number; pageCursor?: ArchivedPageCursor | undefined; exhausted: boolean; blocked?: string };
export type ArchivedHistoryTransport = { archivedHistoryRequest: (params: Record<string, unknown>) => Promise<Record<string, unknown>>; decorateMessages?: (messages: WorkspaceMessage[], sessionKey: string) => WorkspaceMessage[] };

const ARCHIVED_FAMILY_AUTHORITY_FAILURES = [
  'current session generation changed',
  'family token is stale',
  'stable session family is not audited in the ledger',
] as const;

/**
 * These host errors are not retryable page failures. They prove that the
 * archive identity captured before `/new` (or before a registry repair) is no
 * longer authoritative. The reader must keep its mounted review stable while
 * the client rebinds to canonical latest history; persisting them as an
 * ordinary older-history failure strands every subsequent live row in the
 * hidden tail.
 */
export function archivedFamilyAuthorityInvalidated(error: unknown) {
  const message = error instanceof Error ? error.message : typeof error === 'string' ? error : '';
  const normalized = message.toLocaleLowerCase();
  return normalized.includes('archived-family:')
    && ARCHIVED_FAMILY_AUTHORITY_FAILURES.some((reason) => normalized.includes(reason));
}

export function archivedStateForProject(project: WorkspaceProject | undefined, registry: Record<string, unknown> | null): ArchivedHistoryState | null {
  const capabilities = record(registry?.capabilities);
  const sqlite = capabilities.archivedSessionFamily === SQLITE_CONTRACT && capabilities.sessionHistory === 'sqlite-display-v1';
  if ((!sqlite && capabilities.archivedSessionFamily !== CONTRACT) || !project) return null;
  const generation = gatewaySessionGeneration(project, registry);
  const currentSessionId = generation?.sessionId ?? '';
  const currentSessionStartedAtMs = generation?.sessionStartedAtMs ?? 0;
  if (!currentSessionId || !isUUID(currentSessionId) || !currentSessionStartedAtMs) return null;
  return { identity: { sessionKey: project.sessionKey, currentSessionId: currentSessionId.toLowerCase(), currentSessionStartedAtMs, ...(sqlite ? { contract: SQLITE_CONTRACT } : {}) }, ...(project.path ? { workspacePath: project.path } : {}), exhausted: false };
}

export function sameArchiveIdentity(left: ArchivedHistoryState | null, right: ArchivedHistoryState | null) {
  return left?.identity.sessionKey === right?.identity.sessionKey
    && left?.identity.currentSessionId === right?.identity.currentSessionId
    && left?.identity.currentSessionStartedAtMs === right?.identity.currentSessionStartedAtMs
    && left?.identity.contract === right?.identity.contract;
}

export type ArchiveIdentityTransition = 'same' | 'available' | 'removed' | 'generation';

export function archiveIdentityTransition(left: ArchivedHistoryState | null, right: ArchivedHistoryState | null): ArchiveIdentityTransition {
  if (sameArchiveIdentity(left, right)) return 'same';
  if (!left && right) return 'available';
  if (left && !right) return 'removed';
  return 'generation';
}

export async function loadNextArchivedSegment(transport: ArchivedHistoryTransport, initial: ArchivedHistoryState, pageLimit = 128) {
  let state = initial;
  if (!state.segments || !state.familyToken || state.nextArchivedIndex === undefined) state = { ...(await census(transport, state.identity)), ...(state.workspacePath ? { workspacePath: state.workspacePath } : {}) };
  // A page may contain canonical metadata that intentionally projects to no
  // transcript row. Advance through such pages, but return after the first
  // visible batch so one top-load never composes a whole long generation.
  for (let attempt = 0; attempt < 256; attempt += 1) {
    const index = state.nextArchivedIndex ?? -1;
    if (index < 0 || !state.segments?.[index] || !state.familyToken) return { state: { ...state, pageCursor: undefined, exhausted: true }, messages: [] as WorkspaceMessage[], hasMore: false };
    const segment = state.segments[index];
    if (segment.state !== 'archived') throw new Error('Archived history selected a non-archived segment.');
    const offset = state.pageCursor?.segmentIndex === index ? state.pageCursor.nextOffset : 0;
    const expectedTotal = state.pageCursor?.segmentIndex === index ? state.pageCursor.totalRawRecords : -1;
    const payload = await transport.archivedHistoryRequest({ contract: state.identity.contract ?? CONTRACT, mode: 'page', stableSessionKey: state.identity.sessionKey, expectedCurrentSessionId: state.identity.currentSessionId, expectedCurrentSessionStartedAtMs: state.identity.currentSessionStartedAtMs, familyToken: state.familyToken, sessionId: segment.sessionId, segmentOrder: segment.order, sourceRevision: segment.sourceRevision, offset, limit: pageLimit });
    assertEnvelope(payload, state.identity);
    if (text(payload.familyToken) !== state.familyToken || integer(payload.offset) !== offset || parseArchivedSegment(payload.segment, segment.order, state.identity.contract).sourceRevision !== segment.sourceRevision || text(payload.sessionId).toLowerCase() !== segment.sessionId) throw new Error('Archived history page changed segment identity.');
    const responseTotal = integer(payload.totalMessages);
    if (responseTotal < 0 || responseTotal > 32_768 || (expectedTotal >= 0 && responseTotal !== expectedTotal)) throw new Error('Archived history page changed its raw-record total.');
    // The cursor is in the host's raw canonical-reader coordinate, while the
    // returned messages are a display projection. One raw record may expand,
    // collapse, or project to no visible row, so projected row count must not
    // be used to derive or validate cursor advancement.
    const projectedRecords = Array.isArray(payload.messages) ? payload.messages : [];
    if (projectedRecords.length > MAX_PROJECTED_PAGE_ROWS) throw new Error('Archived history exceeded its projected page bound.');
    const parsed = messagesFromPayload({ ...payload, sessionKey: state.identity.sessionKey }, state.workspacePath ?? '').map((message) => ({ ...message, id: `archive:${segment.sessionId}:${message.id}` }));
    const messages = transport.decorateMessages?.(parsed, state.identity.sessionKey) ?? parsed;
    if (payload.hasMore === true) {
      const nextOffset = integer(payload.nextOffset);
      if (nextOffset <= offset || nextOffset >= responseTotal) throw new Error('Archived history returned a non-monotonic raw page cursor.');
      state = { ...state, pageCursor: { segmentIndex: index, nextOffset, totalRawRecords: responseTotal }, exhausted: false };
      if (messages.length) return { state, messages, hasMore: true };
      continue;
    }
    if (payload.nextOffset != null || offset > responseTotal) throw new Error('Archived history ended with an invalid raw page cursor.');
    const nextArchivedIndex = index - 1;
    state = { ...state, nextArchivedIndex, pageCursor: undefined, exhausted: nextArchivedIndex < 0 };
    if (messages.length || state.exhausted) return { state, messages, hasMore: !state.exhausted };
  }
  throw new Error('Archived history exceeded its raw page bound without a visible row.');
}

async function census(transport: ArchivedHistoryTransport, identity: ArchiveIdentity): Promise<ArchivedHistoryState> {
  let cursor = 0; let familyToken = ''; let totalSegments = -1; const segments: ArchivedSegment[] = [];
  for (let page = 0; page < 64; page += 1) {
    const payload = await transport.archivedHistoryRequest({ contract: identity.contract ?? CONTRACT, mode: 'segments', stableSessionKey: identity.sessionKey, expectedCurrentSessionId: identity.currentSessionId, expectedCurrentSessionStartedAtMs: identity.currentSessionStartedAtMs, cursor, limit: 128, ...(familyToken ? { familyToken } : {}) });
    assertEnvelope(payload, identity);
    const token = text(payload.familyToken); if (!token || (familyToken && token !== familyToken)) throw new Error('Archived history family changed during census.');
    familyToken = token;
    const responseCursor = integer(payload.cursor); const responseTotal = integer(payload.totalSegments); const rows = Array.isArray(payload.segments) ? payload.segments : [];
    if (responseCursor !== cursor || responseTotal < 1 || responseTotal > 1024 || (totalSegments >= 0 && responseTotal !== totalSegments) || rows.length > 128) throw new Error('Archived history returned invalid census bounds.');
    totalSegments = responseTotal;
    rows.forEach((row, offset) => segments.push(parseArchivedSegment(row, cursor + offset, identity.contract)));
    if (payload.hasMore !== true) {
      if (payload.nextCursor != null || segments.length !== totalSegments) throw new Error('Archived history census ended incompletely.');
      const current = segments.at(-1);
      if (!current || current.state !== 'current' || current.sessionId !== identity.currentSessionId || (!identity.contract && current.startedAtMs !== identity.currentSessionStartedAtMs) || segments.slice(0, -1).some((segment) => segment.state !== 'archived') || new Set(segments.map(segment => segment.sessionId)).size !== segments.length) throw new Error('Archived history returned an invalid session lifecycle.');
      return { identity, familyToken, segments, nextArchivedIndex: segments.length - 2, exhausted: segments.length < 2 };
    }
    const next = integer(payload.nextCursor);
    if (next !== cursor + rows.length || next <= cursor || next >= totalSegments) throw new Error('Archived history repeated or skipped its census cursor.');
    cursor = next;
  }
  throw new Error('Archived history exceeded its census page bound.');
}

function assertEnvelope(payload: Record<string, unknown>, identity: ArchiveIdentity) {
  if (payload.contract !== (identity.contract ?? CONTRACT) || payload.proof !== (identity.contract ? SQLITE_PROOF : PROOF) || text(payload.stableSessionKey) !== identity.sessionKey || text(payload.currentSessionId).toLowerCase() !== identity.currentSessionId || integer(payload.currentSessionStartedAtMs) !== identity.currentSessionStartedAtMs) throw new Error('Archived history returned an invalid authority envelope.');
}
export function parseArchivedSegment(value: unknown, expectedOrder: number, contract?: ArchiveIdentity['contract']): ArchivedSegment {
  const row = record(value); const sessionId = text(row.sessionId).toLowerCase(); const order = integer(row.order); const state = text(row.state); const startedAtMs = integer(row.startedAtMs); const sourceRevision = text(row.sourceRevision);
  if (!isUUID(sessionId) || order !== expectedOrder || (state !== 'archived' && state !== 'current') || !sourceRevision) throw new Error('Archived history returned an invalid segment.');
  if (contract === SQLITE_CONTRACT) {
    if (row.startedAtMs != null || row.endedAtMs != null || row.endReason != null) throw new Error('SQLite history unexpectedly supplied legacy epochs.');
    return { sessionId, order, state, sourceRevision };
  }
  if (startedAtMs < 1) throw new Error('Archived history returned an invalid segment epoch.');
  const endedAtMs = integer(row.endedAtMs); const endReason = text(row.endReason);
  if (state === 'archived' && (endedAtMs <= startedAtMs || !endReason)) throw new Error('Archived history returned an invalid archived epoch.');
  if (state === 'current' && (row.endedAtMs != null || row.endReason != null)) throw new Error('Archived history current segment unexpectedly has an end epoch.');
  return { sessionId, order, state, startedAtMs, sourceRevision, ...(state === 'archived' ? { endedAtMs, endReason } : {}) };
}
function record(value: unknown): Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
function text(value: unknown) { return typeof value === 'string' ? value.trim() : ''; }
function integer(value: unknown) { return typeof value === 'number' && Number.isSafeInteger(value) ? value : -1; }
function isUUID(value: string) { return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value); }
