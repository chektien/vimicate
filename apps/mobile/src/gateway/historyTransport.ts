import type { WorkspaceMessage } from '../workspace/workspaceTypes';
import type { HistoryCursor } from './historyPagination';
import { transcriptPublicationIdentity } from './transcriptIdentityWall';

/** Only canonical transport receipts, never fetched row content or rawSeq offsets. */
export type HistoryTransportReceipt = {
  offset: number;
  nextOffset: number | null;
  total: number;
  sessionId?: string;
  members: string[];
};
export type HistoryTransport = {
  receipts: HistoryTransportReceipt[];
  boundary?: string;
  scan?: { offset: number; revalidate: boolean };
};
/** A stale tail-relative offset must be re-witnessed, never arithmetically adjusted. */
export class HistoryTraversalChanged extends Error {
  constructor() { super('History changed during traversal. Retry from a witnessed boundary.'); }
}
const MAX_RECEIPTS = 64;
const MAX_MEMBERS = 4096;

export function historyBoundary(rows: readonly WorkspaceMessage[], sessionKey: string) {
  // A detached prompt provides context, not mounted coverage of its turn.
  const omission = rows.find(row => row.historyOmission)?.historyOmission;
  const edge = rows.find(row => row.source === 'history' && row.sessionKey === sessionKey
    && !row.id.startsWith('history-run-') && row.id !== omission?.promptMessageId
    && !row.displayPosition?.activity);
  return edge?.id.startsWith('archive:') ? undefined : edge;
}

export function recordHistoryTransport(cursor: HistoryCursor, offset: number, rows: WorkspaceMessage[], payload: Record<string, unknown>, previous?: HistoryCursor | null): HistoryCursor {
  const sessionId = typeof payload.sessionId === 'string' ? payload.sessionId : rows.find(row => row.transcriptSessionId)?.transcriptSessionId;
  if (payload.sessionKey !== undefined && payload.sessionKey !== cursor.sessionKey) throw new Error('History route changed.');
  if (rows.some(row => row.sessionKey && row.sessionKey !== cursor.sessionKey
    || sessionId && row.transcriptSessionId && row.transcriptSessionId !== sessionId)) throw new Error('History concrete generation changed.');
  const prior = previous?.transport?.receipts ?? [];
  const previousSessionId = prior.find(receipt => receipt.sessionId)?.sessionId;
  if (offset > 0 && previousSessionId && sessionId !== previousSessionId) throw new Error('History concrete generation changed.');
  if (offset > 0 && sessionId && previousSessionId && previous?.totalMessages !== cursor.totalMessages) throw new HistoryTraversalChanged();
  if (payload.offset !== undefined && payload.offset !== offset) throw new Error('History returned an invalid requested offset.');
  if (payload.hasMore === true && (!Number.isSafeInteger(payload.nextOffset) || (payload.nextOffset as number) <= offset)
    || payload.totalMessages !== undefined && (!Number.isSafeInteger(payload.totalMessages) || (payload.totalMessages as number) < offset)) throw new Error('History returned an invalid cursor.');
  if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(cursor.totalMessages) || cursor.totalMessages < 0
    || cursor.hasMore && (cursor.nextOffset === null || !Number.isSafeInteger(cursor.nextOffset) || cursor.nextOffset <= offset || cursor.nextOffset > cursor.totalMessages)) throw new Error('History returned an invalid cursor.');
  const receipt: HistoryTransportReceipt = { offset, nextOffset: cursor.hasMore ? cursor.nextOffset : null, total: cursor.totalMessages,
    ...(sessionId ? { sessionId } : {}), members: rows.filter(row => row.source === 'history' && !row.id.startsWith('history-run-')).map(transcriptPublicationIdentity).slice(0, MAX_MEMBERS) };
  const compatible = prior.filter(value => value.total === receipt.total && value.sessionId === receipt.sessionId && value.offset !== offset);
  const receipts = [...compatible, receipt].slice(-MAX_RECEIPTS);
  let count = receipts.reduce((sum, value) => sum + value.members.length, 0);
  while (receipts.length > 1 && count > MAX_MEMBERS) count -= receipts.shift()!.members.length;
  return { ...cursor, transport: { receipts } };
}

/** One writer reconciles an action against the actual retained publication. */
export function reconcileHistoryCursor(cursor: HistoryCursor | null, rows: readonly WorkspaceMessage[], sessionKey: string): HistoryCursor | null {
  const edge = historyBoundary(rows, sessionKey);
  if (!edge) return cursor?.sessionKey === sessionKey ? cursor : null;
  const boundary = transcriptPublicationIdentity(edge);
  if (!cursor || cursor.sessionKey !== sessionKey) return revalidateHistoryCursor(null, rows, sessionKey);
  const transport = cursor.transport;
  if (!transport) return revalidateHistoryCursor(cursor, rows, sessionKey);
  if (transport.boundary === boundary && transport.scan) return cursor;
  const receipt = [...transport.receipts].reverse().find(value => (!edge.transcriptSessionId || value.sessionId === edge.transcriptSessionId)
    && value.members.includes(boundary));
  if (!receipt) return revalidateHistoryCursor(cursor, rows, sessionKey);
  const present = new Set(rows.map(transcriptPublicationIdentity));
  const index = receipt.members.indexOf(boundary);
  const replay = receipt.members.slice(0, index).some(key => !present.has(key));
  const offset = replay ? receipt.offset : receipt.nextOffset;
  return { ...cursor, nextOffset: offset, hasMore: offset !== null, totalMessages: receipt.total,
    transport: { receipts: transport.receipts.filter(value => value.members.some(key => present.has(key))), boundary,
      ...(replay ? { scan: { offset: receipt.offset, revalidate: true } } : {}) } };
}

export function revalidateHistoryCursor(cursor: HistoryCursor | null, rows: readonly WorkspaceMessage[], sessionKey: string): HistoryCursor {
  const edge = historyBoundary(rows, sessionKey);
  return { sessionKey, hasMore: true, nextOffset: 0, totalMessages: cursor?.totalMessages ?? 0,
    transport: { receipts: [], ...(edge ? { boundary: transcriptPublicationIdentity(edge) } : {}), scan: { offset: 0, revalidate: Boolean(edge) } } };
}

export function continueHistoryScan(cursor: HistoryCursor, rows: readonly WorkspaceMessage[], revalidate: boolean): HistoryCursor {
  const edge = historyBoundary(rows, cursor.sessionKey);
  return { ...cursor, transport: { receipts: cursor.transport?.receipts ?? [],
    ...(edge ? { boundary: transcriptPublicationIdentity(edge) } : {}),
    ...(cursor.hasMore && cursor.nextOffset !== null ? { scan: { offset: cursor.nextOffset, revalidate } } : {}) } };
}
