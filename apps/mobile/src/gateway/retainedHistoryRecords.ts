import type { WorkspaceMessage } from '../workspace/workspaceTypes';
import { transcriptPublicationIdentity } from './transcriptIdentityWall';

/** A fresh page owns both publication aliases and concrete records. Retire
 * stale copies before content scoring or native chronology, even when the
 * new projection corrects a role and therefore changes a submission alias.
 * Narration may instead change its record ID while retaining its alias. */
export function retainedHistoryRecords(earlier: WorkspaceMessage[], latest: WorkspaceMessage[]) {
  const aliases = new Set(latest.map(transcriptPublicationIdentity));
  const records = new Set(latest.map(recordIdentity));
  return earlier.filter(row => !aliases.has(transcriptPublicationIdentity(row)) && !records.has(recordIdentity(row)));
}

function recordIdentity(message: WorkspaceMessage) {
  return JSON.stringify([message.sessionKey, message.transcriptSessionId, message.id]);
}
