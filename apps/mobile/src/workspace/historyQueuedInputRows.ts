import { arrayAt, stringAt, isRecord } from './workspacePayloadFields';
import { transcriptSessionIdentity } from './transcriptMetadata';

/** Accepted steer inputs stay outside OpenClaw's model history until their turn runs. */
export function queuedInputRows(payload: Record<string, unknown>) {
  const page = isRecord(payload.pendingInputs) ? payload.pendingInputs : {};
  const sessionKey = stringAt(payload, ['sessionKey', 'stableSessionKey', 'key']);
  const sessionId = transcriptSessionIdentity(payload.sessionId);
  const scoped = (row: Record<string, unknown>) => (row.sessionKey === undefined || row.sessionKey === sessionKey)
    && (row.sessionId === undefined || transcriptSessionIdentity(row.sessionId) === sessionId);
  const items = arrayAt(page, ['items']);
  if (items.length > 1024) return [];
  return items.flatMap((value) => {
    if (!isRecord(value) || value.state !== 'queued' || !isRecord(value.message)) return [];
    const native = isRecord(value.message.__openclaw) ? value.message.__openclaw : {};
    const validKey = (key: unknown) => key === undefined || typeof key === 'string' && key.trim().length > 0 && key.length <= 512;
    if (!scoped(value) || !scoped(value.message) || !scoped(native)
      || value.queued !== undefined && value.queued !== true
      || value.message.role !== undefined && value.message.role !== 'user'
      || !validKey(value.message.idempotencyKey) || !validKey(native.idempotencyKey)
      || value.message.idempotencyKey !== undefined && native.idempotencyKey !== undefined && value.message.idempotencyKey !== native.idempotencyKey) return [];
    const id = stringAt(value, ['id']);
    const runId = stringAt(value, ['runId']);
    const idempotencyKey = stringAt(value.message, ['idempotencyKey']);
    const acceptedAt = value.acceptedAt;
    if (!id || id.length > 512 || typeof acceptedAt !== 'number' || !Number.isSafeInteger(acceptedAt) || acceptedAt < 0
      || typeof value.runId !== 'string' || !value.runId.trim()
      || runId.length > 256 || idempotencyKey.length > 512) return [];
    return [{
      id: `pending-input:${id}`, role: 'user', content: value.message.content, timestamp: acceptedAt,
      ...(runId ? { runId } : {}), ...(idempotencyKey ? { idempotencyKey } : {}),
      ...(value.message.media !== undefined ? { media: value.message.media } : {}),
      ...(value.message.__openclaw !== undefined ? { __openclaw: value.message.__openclaw } : {}),
    }];
  });
}
