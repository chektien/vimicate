import type { WorkspaceMessage } from '../workspace/workspaceTypes';
import { transcriptSessionIdentity } from '../workspace/transcriptMetadata';

/** Generated client identities, including the original empty-generation ID
 * retained when census later enriches a snapshot's concrete session. */
export function isClientFailureIdentity(row: WorkspaceMessage) {
  if (!row.sessionKey || row.sessionKey.length > 1024) return false;
  const generation = transcriptSessionIdentity(row.transcriptSessionId);
  if (row.transcriptSessionId && !generation) return false;
  const owner = row.runId || row.timestamp;
  if (owner && (row.id === `session-failure:${JSON.stringify([row.sessionKey, generation ?? '', owner])}`
    || row.id === `session-failure:${JSON.stringify([row.sessionKey, '', owner])}`)) return true;
  if (!row.runId || row.runId.length > 256) return false;
  return row.id === `live-chat-${row.runId}` || row.id === `live-run-${row.runId}`
    || row.runFailure === 'runtime' && row.id.startsWith(`live-error-${row.runId}-`)
      && /^(event|\d+)$/.test(row.id.slice(`live-error-${row.runId}-`.length));
}
