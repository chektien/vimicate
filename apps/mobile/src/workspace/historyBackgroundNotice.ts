import { transcriptSessionIdentity } from './transcriptMetadata';
import { isRecord } from './workspacePayloadFields';

/** Only the native undelivered notification identity authorizes this label.
 * Its prose is diagnostic, not proof that a worker succeeded or is still busy. */
export function historyBackgroundNotice(raw: Record<string, unknown>, detail: string, sessionKey: string, sessionId: string | undefined) {
  if (!sessionKey || !sessionId || raw.role !== 'custom' || raw.customType !== 'openclaw.system-note' || raw.display !== true
    || raw.sessionKey !== undefined && raw.sessionKey !== sessionKey
    || raw.sessionId !== undefined && transcriptSessionIdentity(raw.sessionId) !== sessionId) return;
  const native = isRecord(raw.__openclaw) ? raw.__openclaw : {};
  if (raw.idempotencyKey !== undefined && native.idempotencyKey !== undefined && raw.idempotencyKey !== native.idempotencyKey) return;
  const key = raw.idempotencyKey ?? native.idempotencyKey;
  if (typeof key !== 'string') return;
  const [kind, ...parts] = key.split(':');
  if (kind !== 'codex-undelivered' || parts.length !== 3 || !parts.every(part => transcriptSessionIdentity(part))) return;
  return 'Background result notification not delivered. Work may have finished. Refresh and check the result before asking to run it again.'
    + `\nTechnical details\n${detail}`;
}
