import type { WorkspaceMessage } from '../workspace/workspaceTypes';
import { transcriptSessionIdentity } from '../workspace/transcriptMetadata';

/** Presentation/receipt-read identity only. It never authorizes queue mutation. */
export function remoteQueuedInputScope(message: WorkspaceMessage) {
  const sessionId = transcriptSessionIdentity(message.transcriptSessionId);
  const pendingId = message.inputPendingId ?? message.id;
  const receipt = message.inputReceiptRunId;
  const rawPending = message.source === 'history' && message.id === pendingId;
  if (message.role !== 'user' || message.source !== 'history' && message.source !== 'local'
    || !pendingId.startsWith('pending-input:') || pendingId.length <= 14 || pendingId.length > 526
    || !rawPending && message.inputPendingId === undefined || !message.sessionKey || message.sessionKey.length > 1024
    || !sessionId || !receipt || !receipt.trim() || receipt.length > 256
    || rawPending && receipt !== message.runId || !Number.isSafeInteger(message.inputAcceptedAtMs)
    || message.inputAcceptedAtMs! < 0 || message.timestamp !== String(message.inputAcceptedAtMs)
    || message.recovery || message.displayPosition || message.state === 'streaming' || message.state === 'error'
    || message.inputQueueState !== 'queued' && message.inputQueueState !== 'unknown') return;
  return { sessionKey: message.sessionKey, sessionId, runId: receipt };
}
