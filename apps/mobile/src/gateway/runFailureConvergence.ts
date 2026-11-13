import type { WorkspaceMessage } from '../workspace/workspaceTypes';
import { transcriptSessionIdentity } from '../workspace/transcriptMetadata';
import { isClientFailureIdentity } from './clientFailureIdentity';

/** A saved typed failure supersedes only this client's mirrors of that exact
 * attempt. Error prose and shared run IDs on ordinary activity prove nothing. */
export function reconcileRunFailureNotices(messages: WorkspaceMessage[]) {
  const canonical = messages.filter(row => row.source === 'history' && row.role === 'error'
    && row.runFailure === 'before-reply' && row.sessionKey && row.runId
    && transcriptSessionIdentity(row.transcriptSessionId));
  if (!canonical.length) return messages;
  return messages.filter(row => {
    if (!ownedFailureMirror(row)) return true;
    const matches = canonical.filter(saved => saved.sessionKey === row.sessionKey && saved.runId === row.runId);
    if (!row.transcriptSessionId && new Set(matches.map(saved => saved.transcriptSessionId)).size !== 1) return true;
    return !matches.some(saved => !row.transcriptSessionId || row.transcriptSessionId === saved.transcriptSessionId);
  });
}

function ownedFailureMirror(row: WorkspaceMessage) {
  if (row.source !== 'live' || !row.sessionKey || !row.runId
    || row.role !== 'error' && !(row.role === 'system' && row.cachedNotice)
    || !row.runFailure && !row.cachedNotice) return false;
  return isClientFailureIdentity(row);
}
