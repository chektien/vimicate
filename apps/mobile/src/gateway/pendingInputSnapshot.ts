import type { WorkspaceMessage } from '../workspace/workspaceTypes';
import { transcriptSessionIdentity } from '../workspace/transcriptMetadata';

const MAX_PENDING_INPUTS = 1_024;

export type PendingInputCustodyIdentity = {
  id: string;
  sessionKey: string;
  transcriptSessionId: string;
};

export type CompletePendingInputSnapshot = {
  sessionKey: string;
  transcriptSessionId: string;
  rowIDs: readonly string[];
};

export type PendingInputSnapshotReconciliation = {
  snapshot: CompletePendingInputSnapshot;
  candidates: readonly PendingInputCustodyIdentity[];
};

/**
 * Pending inputs are a current Gateway custody snapshot, not durable history.
 * A missing, partial, malformed, or differently scoped snapshot proves
 * nothing and therefore cannot retire an already-published row.
 */
export function completePendingInputSnapshot(
  payload: Record<string, unknown>,
  projected: WorkspaceMessage[],
  expectedSessionKey: string,
): CompletePendingInputSnapshot | null {
  const sessionKey = textAt(payload, ['sessionKey', 'stableSessionKey', 'key'], 512);
  const transcriptSessionId = transcriptSessionIdentity(payload.sessionId);
  const page = record(payload.pendingInputs);
  const items = Array.isArray(page.items) ? page.items : null;
  if (!sessionKey || sessionKey !== expectedSessionKey || !transcriptSessionId || !items
    || items.length > MAX_PENDING_INPUTS || !safeCount(page.total) || page.total !== items.length
    || page.nextBefore !== undefined && page.nextBefore !== null) return null;

  const rowIDs: string[] = [];
  const seen = new Set<string>();
  for (const value of items) {
    const item = record(value);
    const id = textAt(item, ['id'], 512);
    const rowID = id ? `pending-input:${id}` : '';
    if (!rowID || item.state !== 'queued' || seen.has(rowID)) return null;
    seen.add(rowID); rowIDs.push(rowID);
  }
  const projectedIDs = projected.filter((message) => isPendingInputCustodyRow(message)
    && message.sessionKey === sessionKey && message.transcriptSessionId === transcriptSessionId).map((message) => message.id);
  if (projectedIDs.length !== rowIDs.length || projectedIDs.some((id) => !seen.has(id))) return null;
  return { sessionKey, transcriptSessionId, rowIDs };
}

/** Capture only rows that existed before the request began. */
export function pendingInputCustodyCandidates(messages: WorkspaceMessage[], sessionKey: string) {
  return messages.flatMap<PendingInputCustodyIdentity>((message) => isPendingInputCustodyRow(message)
    && message.sessionKey === sessionKey && message.transcriptSessionId
    ? [{ id: message.id, sessionKey, transcriptSessionId: message.transcriptSessionId }]
    : []);
}

/**
 * Retire only pre-request candidates absent from a complete same-generation
 * snapshot. Rows first published while the request was in flight are kept.
 */
export function reconcileCompletePendingInputSnapshot(
  messages: WorkspaceMessage[],
  reconciliation: PendingInputSnapshotReconciliation | undefined,
) {
  if (!reconciliation) return messages;
  const { snapshot, candidates } = reconciliation;
  const current = new Set(snapshot.rowIDs);
  const retired = new Set(candidates.flatMap((candidate) => candidate.sessionKey === snapshot.sessionKey
    && candidate.transcriptSessionId === snapshot.transcriptSessionId && !current.has(candidate.id)
    ? [identity(candidate)] : []));
  if (!retired.size) return messages;
  return messages.filter((message) => !isPendingInputCustodyRow(message) || !retired.has(identity(message)));
}

export function isPendingInputCustodyRow(message: WorkspaceMessage) {
  return message.role === 'user' && message.source === 'history'
    && message.id.startsWith('pending-input:') && !message.idempotencyKey
    && !message.displayPosition && explicitAcceptedInput(message);
}

function explicitAcceptedInput(message: WorkspaceMessage) {
  return Boolean(message.sessionKey && message.transcriptSessionId && message.runId
    && message.inputAcceptedAtMs !== undefined
    && message.timestamp === String(message.inputAcceptedAtMs)
    && !message.recovery
    && message.state !== 'streaming' && message.state !== 'error');
}

function identity(value: Partial<PendingInputCustodyIdentity>) {
  return `${value.sessionKey ?? ''}\u0000${value.transcriptSessionId ?? ''}\u0000${value.id ?? ''}`;
}

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function textAt(value: Record<string, unknown>, keys: string[], limit: number) {
  for (const key of keys) {
    const candidate = value[key];
    if (typeof candidate === 'string' && candidate.length > 0 && candidate.length <= limit) return candidate;
  }
  return '';
}

function safeCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}
