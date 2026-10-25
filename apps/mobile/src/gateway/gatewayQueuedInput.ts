import type { WorkspaceMessage } from '../workspace/workspaceTypes';
import { canonicalQueuedPromptEvent, canonicalQueuedPromptWireRows } from './queuedPromptConsumption';

/** Native pending input is durable custody, not a durable execution scheduler.
 * A source chat final or a started ACK must never be treated as consumption. */
export type GatewayQueuedInputScope = { sessionKey: string; sessionId: string; runId: string; agentId?: string };
export type GatewayQueuedInputPort = { request(method: string, params?: Record<string, unknown>): Promise<unknown> };
export type GatewayQueuedInputState =
  | { state: 'queued' }
  | { state: 'consumed'; consumedByEventId: string }
  | { state: 'interrupted'; reason: 'interrupted' | 'cancelled' }
  | { state: 'unknown' };

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}
function nonempty(value: unknown): value is string { return typeof value === 'string' && value.trim().length > 0; }
function validScope(scope: GatewayQueuedInputScope) {
  return nonempty(scope.sessionKey) && nonempty(scope.sessionId) && nonempty(scope.runId) && scope.runId.length <= 256
    && (scope.agentId === undefined || nonempty(scope.agentId));
}

/** The native early ACK proves admission only. It does not yet prove enqueue. */
export function gatewayQueuedInputAck(payload: unknown, expectedRunId: string): { state: 'accepted' | 'unknown' } {
  const ack = record(payload);
  const timing = record(ack?.serverTiming);
  const valid = nonempty(expectedRunId) && ack?.runId === expectedRunId && ack.status === 'started'
    && (ack.messageSeq === undefined || typeof ack.messageSeq === 'number' && Number.isSafeInteger(ack.messageSeq) && ack.messageSeq > 0)
    && (ack.interruptedActiveRun === undefined || ack.interruptedActiveRun === true)
    && (ack.serverTiming === undefined || timing && Object.values(timing).every(value => typeof value === 'number' && Number.isFinite(value) && value >= 0));
  return { state: valid ? 'accepted' : 'unknown' };
}

function validatedQueuedHistory(payload: unknown, scope: GatewayQueuedInputScope) {
  const history = record(payload);
  if (!validScope(scope) || !history || history.sessionKey !== scope.sessionKey || history.sessionId !== scope.sessionId) return;
  const session = record(history.sessionInfo);
  if (history.sessionInfo !== undefined && !session || history.agentId !== undefined && history.agentId !== scope.agentId
    || session?.sessionId !== undefined && session.sessionId !== scope.sessionId
    || scope.agentId && session?.agentId !== undefined && session.agentId !== scope.agentId) return;
  if (!Array.isArray(history.inputReceipts) || history.inputReceipts.length > 1) return;
  const page = record(history.pendingInputs);
  if (history.pendingInputs !== undefined && (!page || !Array.isArray(page.items))) return;
  const pending = page?.items as unknown[] | undefined;
  if (pending && (pending.length > 4096 || pending.some(value => !record(value)))) return;
  const items = pending?.map(record).filter(item => item?.runId === scope.runId) ?? [];
  if (items.length > 1) return;
  const item = items[0];
  if (item && (!nonempty(item.id) || !['queued', 'cancelled', 'interrupted'].includes(String(item.state))
    || item.queued !== undefined && item.queued !== true)) return;
  return { history, receipts: history.inputReceipts, item };
}

/** Read exact custody instead of inferring it from display pagination. Native
 * receipt lookup returns no receipts for a non-current concrete generation. */
export function gatewayQueuedInputFromHistory(payload: unknown, scope: GatewayQueuedInputScope, canonicalMessages: readonly WorkspaceMessage[] = []): GatewayQueuedInputState {
  const validated = validatedQueuedHistory(payload, scope);
  if (!validated) return { state: 'unknown' };
  const { history, receipts, item } = validated;
  if (!receipts.length) {
    if (item) return { state: 'unknown' };
    const consumedByEventId = canonicalQueuedPromptEvent([...canonicalMessages, ...canonicalQueuedPromptWireRows(history)], scope);
    return consumedByEventId ? { state: 'consumed', consumedByEventId } : { state: 'unknown' };
  }
  const receipt = record(receipts[0]);
  if (!receipt || receipt.runId !== scope.runId) return { state: 'unknown' };
  if (receipt.state === 'consumed') {
    return nonempty(receipt.consumedByEventId) && receipt.queued === undefined && receipt.cancelled === undefined && !item
      ? { state: 'consumed', consumedByEventId: receipt.consumedByEventId } : { state: 'unknown' };
  }
  if (receipt.state !== 'pending' || receipt.consumedByEventId !== undefined
    || receipt.queued !== undefined && receipt.queued !== true || receipt.cancelled !== undefined && receipt.cancelled !== true
    || receipt.queued === true && receipt.cancelled === true) return { state: 'unknown' };
  if (receipt.queued === true) return !item || item.state === 'queued' && item.queued === true ? { state: 'queued' } : { state: 'unknown' };
  if (item?.queued === true) return { state: 'unknown' };
  if (receipt.cancelled === true) return !item || item.state === 'cancelled' ? { state: 'interrupted', reason: 'cancelled' } : { state: 'unknown' };
  if (item?.state === 'interrupted') return { state: 'interrupted', reason: 'interrupted' };
  return { state: 'unknown' };
}

export async function readGatewayQueuedInput(port: GatewayQueuedInputPort, scope: GatewayQueuedInputScope, canonicalMessages: readonly WorkspaceMessage[] = []): Promise<GatewayQueuedInputState> {
  scope = { ...scope };
  if (!validScope(scope)) return { state: 'unknown' };
  const params = {
    // Native history permits sessionId only with messageId, but anchored reads
    // do not return input receipts. Read current history and validate its exact
    // concrete generation below before authorizing any queue action.
    sessionKey: scope.sessionKey,
    ...(scope.agentId ? { agentId: scope.agentId } : {}), inputRunIds: [scope.runId], limit: 1,
  };
  const payload = await port.request('chat.history', params);
  const state = gatewayQueuedInputFromHistory(payload, scope, canonicalMessages);
  const page = validatedQueuedHistory(payload, scope);
  if (state.state !== 'unknown' || !page || page.receipts.length || page.item) return state;
  // Temporary custody can disappear before this client's display tail catches
  // up. One bounded read finds the committed input behind later tool activity.
  // Never infer consumption from an empty page or inspect another generation.
  const recent = await port.request('chat.history', { ...params, limit: 64 });
  return gatewayQueuedInputFromHistory(recent, scope, canonicalMessages);
}

/** Withdraw only proven queued custody. Native withdrawal commits before the
 * abort and holds adoption while doing so. A false/no-match result is a race,
 * not permission to launch a replacement with a new idempotency key. */
export async function cancelGatewayQueuedInput(port: GatewayQueuedInputPort, scope: GatewayQueuedInputScope): Promise<{ state: 'cancelled' | 'unknown' }> {
  scope = { ...scope };
  if ((await readGatewayQueuedInput(port, scope)).state !== 'queued') return { state: 'unknown' };
  const result = record(await port.request('chat.abort', {
    sessionKey: scope.sessionKey, ...(scope.agentId ? { agentId: scope.agentId } : {}), runId: scope.runId, discardPendingInput: true,
  }));
  return { state: result?.ok === true && result.aborted === true && Array.isArray(result.runIds)
    && result.runIds.length === 1 && result.runIds[0] === scope.runId ? 'cancelled' : 'unknown' };
}
