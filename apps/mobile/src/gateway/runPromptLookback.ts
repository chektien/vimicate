import { BoundedSessionCache } from '../workspace/boundedSessionCache';
import type { WorkspaceMessage } from '../workspace/workspaceTypes';

/**
 * A long run pushes its prompt out of the 80-record latest page, so every
 * refresh used to fetch older pages again to find it. Transcript records older
 * than the latest page are append-only, so the rows from that run's prompt
 * onward can be retained and reused while they still join the fresh page.
 */
export class RunPromptLookback {
  private readonly values = new BoundedSessionCache<{ runId: string; rows: WorkspaceMessage[] }>(16);

  /** Retained rows strictly older than `page`, or null when they cannot be proven contiguous. */
  olderRows(sessionKey: string, runId: string, page: readonly WorkspaceMessage[]) {
    const entry = this.values.restore(sessionKey);
    const firstId = page[0]?.id;
    if (!entry || entry.runId !== runId || !firstId) return null;
    const boundary = entry.rows.findIndex(row => row.id === firstId);
    if (boundary <= 0) return null;
    const older = entry.rows.slice(0, boundary);
    return older.some(row => row.role === 'user' && row.runId === runId) ? older : null;
  }

  record(sessionKey: string, runId: string, messages: readonly WorkspaceMessage[]) {
    const prompt = messages.findIndex(row => row.role === 'user' && row.runId === runId);
    if (prompt >= 0) this.values.store(sessionKey, { runId, rows: messages.slice(prompt) });
  }
}
