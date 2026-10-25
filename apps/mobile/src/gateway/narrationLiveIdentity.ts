import type { WorkspaceMessage } from '../workspace/workspaceTypes';

/** A native narration record names the exact live transport ID it replaces.
 * Bridge that explicit alias before shared hydration has supplied metadata;
 * never infer item identity from equal prose or parse an ambiguous run/item ID. */
export function identifyCanonicalNarrationAliases(messages: WorkspaceMessage[]) {
  const owners = new Map<string, WorkspaceMessage | null>();
  for (const row of messages) {
    if (row.role !== 'narration' || row.source !== 'history' || !row.sessionKey
      || !row.runId || !row.transcriptSessionId || !row.narrationItemId) continue;
    const key = `${row.sessionKey}\0live-item-${row.runId}-${row.narrationItemId}`;
    const previous = owners.get(key);
    if (previous === null) continue;
    owners.set(key, previous && (previous.transcriptSessionId !== row.transcriptSessionId
      || previous.runId !== row.runId || previous.narrationItemId !== row.narrationItemId) ? null : row);
  }
  let changed = false;
  const identified = messages.map(row => {
    if (row.role !== 'narration' || !row.sessionKey || !row.runId) return row;
    const owner = owners.get(`${row.sessionKey}\0${row.id}`);
    if (!owner || !owner.transcriptSessionId || !owner.narrationItemId || owner.runId !== row.runId
      || row.transcriptSessionId && row.transcriptSessionId !== owner.transcriptSessionId
      || row.narrationItemId && row.narrationItemId !== owner.narrationItemId
      || row.transcriptSessionId === owner.transcriptSessionId && row.narrationItemId === owner.narrationItemId) return row;
    changed = true;
    return { ...row, transcriptSessionId: owner.transcriptSessionId, narrationItemId: owner.narrationItemId };
  });
  return changed ? identified : messages;
}
