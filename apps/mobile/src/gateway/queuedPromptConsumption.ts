import type { WorkspaceMessage } from '../workspace/workspaceTypes';
import { nativeTranscriptMetadata, transcriptDisplayPosition } from '../workspace/transcriptMetadata';

type InputScope = { sessionKey: string; sessionId: string; runId: string };
const MAX_ROWS = 4096;
const bounded = (value: unknown, limit: number): value is string => typeof value === 'string' && value.trim().length > 0 && value.length <= limit;

/** The committed submission key is input identity, not execution-run authority.
 * Claude's imported prompt can omit both runId and native acceptance metadata. */
export function isCanonicalQueuedPrompt(message: WorkspaceMessage, scope: InputScope) {
  return bounded(scope.sessionKey, 2048) && bounded(scope.sessionId, 256) && bounded(scope.runId, 256)
    && message.source === 'history' && message.role === 'user'
    && message.sessionKey === scope.sessionKey && message.transcriptSessionId === scope.sessionId
    && bounded(message.id, 512) && !message.id.startsWith('pending-input:')
    && message.idempotencyKey === `${scope.runId}:user`
    && Boolean(transcriptDisplayPosition(message.displayPosition))
    && !message.recovery && message.state !== 'streaming' && message.state !== 'error';
}

/** No text, time proximity, native external-ID or lifecycle-run fallback. */
export function canonicalQueuedPromptEvent(messages: readonly WorkspaceMessage[], scope: InputScope) {
  if (messages.length > MAX_ROWS) return;
  const ids = new Set(messages.filter(message => isCanonicalQueuedPrompt(message, scope)).map(message => message.id));
  return ids.size === 1 ? [...ids][0] : undefined;
}

/** Read only identity metadata from this already-scoped Gateway page. Do not
 * import the full transcript projector into the queue/identity owners. */
export function canonicalQueuedPromptWireRows(history: Record<string, unknown>): WorkspaceMessage[] {
  if (!Array.isArray(history.messages) || history.messages.length > MAX_ROWS
    || typeof history.sessionKey !== 'string' || typeof history.sessionId !== 'string') return [];
  return history.messages.flatMap(value => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
    const raw = value as Record<string, unknown>;
    if (raw.role !== 'user' || raw.recovery || raw.state === 'streaming' || raw.state === 'error') return [];
    const native = nativeTranscriptMetadata(raw);
    const id = typeof raw.id === 'string' ? raw.id : typeof raw.messageId === 'string' ? raw.messageId : native.id;
    const idempotencyKey = typeof raw.idempotencyKey === 'string' ? raw.idempotencyKey : native.idempotencyKey;
    return [{ id, idempotencyKey, role: 'user' as const, source: 'history' as const, text: '',
      sessionKey: history.sessionKey as string, transcriptSessionId: history.sessionId as string,
      ...(native.displayPosition ? { displayPosition: native.displayPosition } : {}) }];
  });
}
