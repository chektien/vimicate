import { recordHistoryTransport } from './historyTransport';
import { transcriptPublicationIdentity } from './transcriptIdentityWall';
import type { OpenClawClient } from './OpenClawClient';
import { historyCursorFromPayload, mergeOlderHistory, type HistoryCursor } from './historyPagination';
import { type WorkspaceMessage } from '../workspace/workspaceTypes';
import { messagesFromPayload } from '../workspace/historyMessageProjection';

const MAX_CONTINUITY_PAGES = 6;

type CompletedLatestHistory<T> = T & {
  cursor: HistoryCursor;
  messages: WorkspaceMessage[];
  nativeHistoryFloor?: NativeHistoryFloor;
};

/**
 * A latest-page refresh can arrive after more than one transport page was
 * appended elsewhere. Native placement coordinates let us prove that the
 * retained tail and the fresh page have a hole. Fill that hole before the
 * normal bounded publication decides which contiguous edge to retain.
 *
 * Bridge reads are deliberately non-consuming: the public cursor still names
 * the first latest page, so rows omitted by the presentation budget remain
 * reachable through ordinary older-history loading.
 */
export async function completedNativeHistoryContinuity<T>(
  client: OpenClawClient,
  sessionKey: string,
  completed: CompletedLatestHistory<T>,
  retained: WorkspaceMessage[],
  workspacePath: string,
  owns: () => boolean,
  bridgeRetainedTail = true,
  projectionContext?: (() => WorkspaceMessage[]) | undefined,
): Promise<CompletedLatestHistory<T> | null> {
  if (!owns()) return null;
  const edge = nativeContinuityEdge(retained, completed.messages, sessionKey);
  if (!edge) return completed;
  // Explicit thread entry asks for the newest window, not an invisible walk
  // back to an old cache. Use the same scoped replacement as budget exhaustion;
  // the unchanged cursor keeps every omitted page reachable by older loading.
  if (!bridgeRetainedTail) return freshNativeWindow(completed, sessionKey, edge);

  let messages = completed.messages;
  let pageCursor = completed.cursor;
  let transport = completed.cursor.transport;
  for (let pageCount = 0; pageCount < MAX_CONTINUITY_PAGES && pageCursor.hasMore && pageCursor.nextOffset !== null; pageCount += 1) {
    const offset = pageCursor.nextOffset;
    const payload = await client.history(sessionKey, 80, offset);
    if (!owns()) return null;
    const older = client.decorateMessages(messagesFromPayload(payload, workspacePath, [...retained, ...messages, ...(projectionContext?.() ?? [])]), sessionKey);
    const next = recordHistoryTransport(historyCursorFromPayload(payload, sessionKey), offset, older, payload, { ...pageCursor, transport });
    transport = next.transport;
    messages = mergeOlderHistory(older, messages, sessionKey);
    if (nativeEdgeReached(messages, edge)) return { ...completed, messages, cursor: { ...completed.cursor, transport } };
    if (!next.hasMore || next.nextOffset === null) return freshNativeWindow({ ...completed, messages, cursor: { ...completed.cursor, transport } }, sessionKey, edge);
    if (next.nextOffset <= offset) throw new Error('history continuity page did not advance');
    pageCursor = next;
  }
  if (!nativeEdgeReached(messages, edge)) {
    // A device may be days behind. The budget bounds catch-up work, not the
    // age of a usable cache: publish a fresh window rather than retrying the
    // same impossible bridge forever. Do not join the disconnected old edge.
    // Keep the original cursor so the omitted span remains pageable.
    return freshNativeWindow(completed, sessionKey, edge);
  }
  return { ...completed, messages, cursor: { ...completed.cursor, transport } };
}

function freshNativeWindow<T>(completed: CompletedLatestHistory<T>, sessionKey: string, edge: NativeContinuityEdge): CompletedLatestHistory<T> {
  const rawSeq = Math.min(...completed.messages.filter(message => message.source === 'history'
    && message.sessionKey === sessionKey && message.transcriptSessionId === edge.transcriptSessionId
    && message.displayPosition?.source === edge.source).map(message => message.displayPosition!.rawSeq));
  return { ...completed, nativeHistoryFloor: { source: edge.source, transcriptSessionId: edge.transcriptSessionId, rawSeq, members: completed.messages.map(transcriptPublicationIdentity) } };
}

type NativeContinuityEdge = {
  source: string;
  transcriptSessionId: string;
  members: Set<string>;
};

function nativeContinuityEdge(retained: WorkspaceMessage[], latest: WorkspaceMessage[], sessionKey: string): NativeContinuityEdge | null {
  const first = latest.find(message => message.source === 'history' && message.sessionKey === sessionKey
    && message.transcriptSessionId && message.displayPosition);
  if (!first?.transcriptSessionId || !first.displayPosition) return null;
  const nativeRetained = retained.filter(message => (message.source === 'history' || message.source === 'live')
    && message.sessionKey === sessionKey && message.transcriptSessionId === first.transcriptSessionId
    && message.displayPosition?.source === first.displayPosition!.source);
  const members = new Set(nativeRetained.map(nativeWitness));
  return members.size && !latest.some(message => members.has(nativeWitness(message)))
    ? { source: first.displayPosition.source, transcriptSessionId: first.transcriptSessionId, members } : null;
}

function nativeEdgeReached(messages: WorkspaceMessage[], edge: NativeContinuityEdge) {
  return messages.some(message => message.source === 'history'
    && message.transcriptSessionId === edge.transcriptSessionId
    && message.displayPosition?.source === edge.source
    && edge.members.has(nativeWitness(message)));
}

export type NativeHistoryFloor = { source: string; transcriptSessionId: string; rawSeq: number; members?: string[] };

/** Applied to the current tail at publication time, never by clearing a cache. */
export function retainedNativeHistoryWindow(messages: WorkspaceMessage[], sessionKey: string, floor?: NativeHistoryFloor) {
  if (!floor) return messages;
  return messages.filter(message => !(message.source === 'history' && message.sessionKey === sessionKey
    && message.transcriptSessionId === floor.transcriptSessionId && message.displayPosition?.source === floor.source
    && (floor.members ? !floor.members.includes(transcriptPublicationIdentity(message)) : message.displayPosition.rawSeq < floor.rawSeq)));
}

/** Native position is a scoped record witness, never a transport offset. */
function nativeWitness(message: WorkspaceMessage) {
  return message.displayPosition && message.transcriptSessionId
    ? `${message.sessionKey}\0${message.transcriptSessionId}\0${message.displayPosition.source}\0${message.displayPosition.rawSeq}`
    : transcriptPublicationIdentity(message);
}
