import type { OpenClawClient } from './OpenClawClient';
import { parseArchivedSegment, type ArchivedHistoryState } from './archivedHistory';
import { registrySessionGeneration, sameSessionGeneration, type GatewaySessionGeneration } from './registrySessionIdentity';
import type { HistoryCursor } from './historyPagination';
import { transcriptPublicationIdentity } from './transcriptIdentityWall';
import { type WorkspaceMessage } from '../workspace/workspaceTypes';
import { messagesFromPayload } from '../workspace/historyMessageProjection';
import { addedOlderVisibleRowCount, OLDER_READ_LIMIT, OLDER_VISIBLE_ROW_TARGET, olderReviewBytes, OLDER_REVIEW_BYTE_LIMIT, type OlderHistoryVisibleContext } from './olderHistoryVisibleRows';

export type NewerHistoryScan = { boundary: string; segment: number | null; offset: number; total: number };
type Input = { client: OpenClawClient; sessionKey: string; path: string; visible: WorkspaceMessage[];
  cursor: HistoryCursor | null; archive: ArchivedHistoryState | null; context: OlderHistoryVisibleContext;
  generation?: GatewaySessionGeneration | null; scan: NewerHistoryScan | null; owns: () => boolean };

/** Reverse the raw transport coordinate, never infer it from projected row counts. */
export async function loadVisibleNewerHistoryBatch(input: Input) {
  const edge = input.visible.findLast(message => message.source === 'history' && !message.id.startsWith('history-run-'));
  if (!edge) throw new Error('Newer history needs an authoritative review boundary.');
  const boundary = transcriptPublicationIdentity(edge);
  const archive = input.archive;
  const archivedIndex = archive?.segments?.findIndex(segment => segment.state === 'archived'
    && (segment.sessionId === edge.transcriptSessionId || edge.id.startsWith(`archive:${segment.sessionId}:`))) ?? -1;
  let scan = input.scan?.boundary === boundary ? input.scan : {
    boundary, segment: archivedIndex >= 0 ? archivedIndex : null,
    offset: archivedIndex >= 0
      ? archive?.pageCursor?.segmentIndex === archivedIndex ? Math.min(archive.pageCursor.totalRawRecords, archive.pageCursor.nextOffset + 80) : -1
      : input.cursor?.nextOffset != null ? Math.min(input.cursor.totalMessages, input.cursor.nextOffset + 80) : input.cursor?.totalMessages ?? 0,
    total: archivedIndex >= 0
      ? archive?.pageCursor?.segmentIndex === archivedIndex ? archive.pageCursor.totalRawRecords : -1
      : input.cursor?.totalMessages ?? 0,
  };
  let reads = 0;
  let readCurrent = false;
  let found = false;
  let newer: WorkspaceMessage[] = [];
  let rewind: { cursor: HistoryCursor | null; archive: ArchivedHistoryState | null } | null = null;
  const read = async (offset: number, limit: number) => {
    if (scan.segment === null) {
      reads++; readCurrent = true;
      const payload = await input.client.history(input.sessionKey, limit, offset);
      if (payload.sessionKey !== input.sessionKey || (input.generation && payload.sessionId !== input.generation.sessionId)) throw new Error('Newer history current session generation changed.');
      const total = payload.totalMessages;
      if (!Number.isSafeInteger(total) || (total as number) < 0) throw new Error('Newer history returned an invalid raw total.');
      if (scan.total >= 0 && (total as number) < scan.total) throw new Error('Newer history raw total changed backwards.');
      // Current history can grow during review. Shift the captured raw edge by
      // that growth before locating it, rather than silently skipping records.
      const growth = Math.max(0, (total as number) - scan.total);
      if (scan.total >= 0 && growth) {
        scan = { ...scan, offset: scan.offset + growth, total: total as number };
        if (rewind?.cursor && scan.segment === null) rewind = { ...rewind, cursor: { ...rewind.cursor,
          nextOffset: rewind.cursor.nextOffset === null ? null : rewind.cursor.nextOffset + growth, totalMessages: total as number } };
        return null;
      }
      return { messages: input.client.decorateMessages(messagesFromPayload(payload, input.path), input.sessionKey), total: total as number,
        end: rawPageEnd(payload, offset, limit) };
    }
    if (!archive?.segments || !archive.familyToken) throw new Error('Newer history archive authority is unavailable.');
    const segment = archive.segments[scan.segment]!;
    const identity = archive.identity;
    reads++;
    const payload = await input.client.archivedHistoryRequest({ contract: identity.contract ?? 'archived-family-v1', mode: 'page',
      stableSessionKey: input.sessionKey, expectedCurrentSessionId: identity.currentSessionId,
      expectedCurrentSessionStartedAtMs: identity.currentSessionStartedAtMs, familyToken: archive.familyToken,
      sessionId: segment.sessionId, segmentOrder: segment.order, sourceRevision: segment.sourceRevision, offset, limit });
    const total = payload.totalMessages;
    if (payload.contract !== (identity.contract ?? 'archived-family-v1')
      || payload.proof !== (identity.contract ? 'verified-import+sqlite-ownership-v1' : 'audited-baseline+contiguous-ledger-v1')
      || payload.stableSessionKey !== input.sessionKey || payload.currentSessionId !== identity.currentSessionId
      || payload.currentSessionStartedAtMs !== identity.currentSessionStartedAtMs || payload.familyToken !== archive.familyToken
      || payload.sessionId !== segment.sessionId || payload.offset !== offset
      || parseArchivedSegment(payload.segment, segment.order, identity.contract).sourceRevision !== segment.sourceRevision
      || !Number.isSafeInteger(total) || (total as number) < 0 || (total as number) > 32768
      || (scan.total >= 0 && total !== scan.total)
      || !Array.isArray(payload.messages) || payload.messages.length > 512) throw new Error('Newer history archive page changed authority.');
    const rows = messagesFromPayload({ ...payload, sessionKey: input.sessionKey }, input.path)
      .map(message => ({ ...message, id: `archive:${segment.sessionId}:${message.id}` }));
    return { messages: input.client.decorateMessages(rows, input.sessionKey), total: total as number, end: rawPageEnd(payload, offset, limit) };
  };
  while (input.owns() && reads < OLDER_READ_LIMIT) {
    if (scan.offset < 0) {
      const probe = await read(0, 1);
      if (!input.owns()) break;
      if (!probe) continue;
      scan = { ...scan, offset: probe.total, total: probe.total };
    }
    if (reads >= OLDER_READ_LIMIT) break;
    const endOffset = scan.offset;
    let limit = Math.max(1, Math.min(80, endOffset));
    let offset = Math.max(0, endOffset - limit);
    let page = await read(offset, limit);
    // A byte-capped response contains the newer side of the requested range.
    // It is not adjacent to our reviewed edge until its raw end reaches that
    // edge. Narrow and reread against the same edge; never skip the omitted gap.
    while (page && input.owns() && (page.end < endOffset || (olderReviewBytes(page.messages) > OLDER_REVIEW_BYTE_LIMIT && limit > 1))) {
      if (reads >= OLDER_READ_LIMIT) { page = null; break; }
      limit = page.end < endOffset ? page.end - offset : Math.max(1, Math.floor(limit / 2));
      offset = Math.max(0, endOffset - limit);
      page = await read(offset, limit);
    }
    if (!input.owns()) break;
    if (!page) continue;
    const index = page.messages.findIndex(message => transcriptPublicationIdentity(message) === boundary);
    if (!found && index >= 0) {
      found = true;
      rewind = scan.segment === null
        ? { cursor: { sessionKey: input.sessionKey, nextOffset: offset, hasMore: page.total > offset, totalMessages: page.total }, archive }
        : { cursor: input.cursor, archive: { ...archive!, nextArchivedIndex: scan.segment, exhausted: false,
          pageCursor: offset > 0 ? { segmentIndex: scan.segment, nextOffset: offset, totalRawRecords: page.total } : undefined } };
      newer = page.messages.slice(index + 1);
    } else if (found) newer = [...newer, ...page.messages];
    scan = { ...scan, offset, total: page.total };
    if (found && (addedOlderVisibleRowCount(input.visible, [...input.visible, ...newer], input.context) >= OLDER_VISIBLE_ROW_TARGET
      || olderReviewBytes(newer) >= OLDER_REVIEW_BYTE_LIMIT)) break;
    if (offset === 0) {
      if (scan.segment === null) break;
      const next = scan.segment + 1;
      scan = { ...scan, segment: archive?.segments?.[next]?.state === 'archived' ? next : null, offset: -1, total: -1 };
    }
  }
  if (readCurrent && input.generation && input.owns()) {
    const registry = await input.client.readRegistry();
    if (!sameSessionGeneration(input.generation, registrySessionGeneration(input.sessionKey, registry))) throw new Error('Newer history current session generation changed.');
  }
  if (!found && scan.segment === null && scan.offset === 0) throw new Error('Newer history review boundary is no longer available.');
  return { newer, scan: found ? null : scan, rewind, reachedLatest: found && scan.segment === null && scan.offset === 0 };
}

function rawPageEnd(payload: Record<string, unknown>, offset: number, limit: number) {
  const total = payload.totalMessages as number;
  const end = payload.hasMore === true ? payload.nextOffset : payload.hasMore === false ? total : undefined;
  if (!Number.isSafeInteger(end) || (end as number) < offset || ((end as number) === offset && offset < total)
    || (end as number) > Math.min(total, offset + limit)
    || (payload.offset !== undefined && payload.offset !== offset)) throw new Error('Newer history raw page coverage is invalid.');
  return end as number;
}
