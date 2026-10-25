import type { WorkspaceMessage } from '../workspace/workspaceTypes';

const POSITIONAL_LIVE_ROLES = new Set<WorkspaceMessage['role']>([
  'narration', 'tool', 'approval', 'error',
]);

/**
 * Older RN builds could persist transient live-detail rows without a source time.
 * Their former array slot is not chronology evidence after canonical history
 * refreshes. Keep fresh streaming rows, rows with a comparable timestamp,
 * rows with another prompt/answer/lifecycle owner from the same run, and rows
 * still immediately owned by the nearest user turn. Remove only a restored
 * orphan whose nearest conversation row is already an assistant/boundary;
 * authoritative live/history can republish it with truthful ownership later.
 */
export function pruneUnownedRestoredLiveRows(messages: WorkspaceMessage[]) {
  const runOwnerCounts = new Map<string, number>();
  for (const message of messages) {
    if (!message.runId || (message.role !== 'user' && message.role !== 'assistant' && message.role !== 'run')) continue;
    runOwnerCounts.set(message.runId, (runOwnerCounts.get(message.runId) ?? 0) + 1);
  }
  return messages.filter((message, index) => {
    const hasExternalRunOwner = Boolean(message.runId
      && (runOwnerCounts.get(message.runId) ?? 0) > 0);
    const restoredOrphan = message.source === 'live'
      && POSITIONAL_LIVE_ROLES.has(message.role)
      && !message.timestamp
      && message.state !== 'streaming'
      && !hasExternalRunOwner;
    if (!restoredOrphan) return true;
    // A restored live row immediately following the latest user turn still
    // has truthful positional ownership even if an old cache omitted runId on
    // that prompt. It is unrecoverable only when a completed assistant turn
    // or generation boundary is the nearest preceding conversation row.
    for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
      const role = messages[cursor]?.role;
      if (role === 'user') return true;
      if (role === 'assistant' || role === 'boundary') return false;
    }
    // A cache window may begin in the middle of the owning turn. Absence of a
    // preceding conversation row is uncertainty, not proof of orphaning; the
    // next canonical merge can decide once surrounding rows are available.
    return true;
  });
}
