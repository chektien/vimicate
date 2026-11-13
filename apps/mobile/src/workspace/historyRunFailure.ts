import { runFailureNoticeText } from '../gateway/promptDeliveryNotice';
import { isRecord } from './workspacePayloadFields';
import { nativeTranscriptMetadata, transcriptSessionIdentity } from './transcriptMetadata';

/** Exact saved-input identities in this scoped history page. Ordinary prose,
 * optimistic local rows and internal/inter-session messages prove no custody. */
export function recordedHistoryInputs(rows: unknown[], sessionKey: string, sessionId: string | undefined) {
  const inputs = new Set<string>();
  if (!sessionKey) return inputs;
  for (const raw of rows) {
    if (!isRecord(raw) || raw.role !== 'user' || isRecord(raw.provenance) && raw.provenance.kind !== undefined
      || raw.sessionKey !== undefined && raw.sessionKey !== sessionKey
      || raw.sessionId !== undefined && transcriptSessionIdentity(raw.sessionId) !== sessionId) continue;
    const native = nativeTranscriptMetadata(raw);
    if (isRecord(raw.__openclaw) && raw.idempotencyKey !== undefined && raw.__openclaw.idempotencyKey !== undefined
      && raw.idempotencyKey !== raw.__openclaw.idempotencyKey) continue;
    const key = typeof raw.idempotencyKey === 'string' ? raw.idempotencyKey : native.idempotencyKey;
    if (key.endsWith(':user') && key.length > 5 && key.length <= 261) inputs.add(key.slice(0, -5));
  }
  return inputs;
}

export function historyRunFailure(raw: Record<string, unknown>, recordedInputs: ReadonlySet<string>, sessionKey: string, sessionId: string | undefined) {
  if (raw.role !== 'custom' || raw.customType !== 'run-failed-before-reply' || !isRecord(raw.openclawRunError)) return;
  if (raw.sessionKey !== undefined && raw.sessionKey !== sessionKey
    || raw.sessionId !== undefined && transcriptSessionIdentity(raw.sessionId) !== sessionId) return;
  const { runId, summary } = raw.openclawRunError;
  const native = nativeTranscriptMetadata(raw);
  if (typeof runId !== 'string' || !runId.trim() || runId.length > 256 || typeof summary !== 'string' || !summary.trim()
    || native.runId && native.runId !== runId || raw.runId !== undefined && raw.runId !== runId) return;
  return { runId, text: runFailureNoticeText(summary, { recorded: recordedInputs.has(runId), label: 'This attempt failed before returning a reply' }) };
}
