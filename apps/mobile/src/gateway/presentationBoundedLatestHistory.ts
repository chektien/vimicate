import type { OpenClawClient } from './OpenClawClient';
import type { WorkspaceMessage } from '../workspace/workspaceTypes';
import { completedLatestHistoryPage } from './completedLatestHistoryPage';
import { MAX_VISIBLE_HISTORY_ROWS, transcriptPresentationRowCost } from './historyWindow';
import { withHistoryRunCompletions } from './historyRunCompletion';
import { mergeSharedNarration } from './sharedNarration';

/** Reject oversized candidates before consuming their raw-record cursor. */
export async function presentationBoundedLatestHistory(
  client: OpenClawClient, sessionKey: string, firstPayload: Record<string, unknown>,
  workspacePath: string, owns: () => boolean, narration: WorkspaceMessage[],
) {
  let payload = firstPayload;
  // The caller's first request is 80. At most seven candidate sizes; one raw
  // record is indivisible. Lookback remains non-consuming for older traversal.
  for (let limit = 80; ; limit = Math.max(1, Math.floor(limit / 2))) {
    if (!owns()) return null;
    if (limit !== 80) payload = await client.history(sessionKey, limit, 0);
    if (!owns()) return null;
    const completed = await completedLatestHistoryPage(client, sessionKey, payload, workspacePath, owns);
    if (!completed) return null;
    const messages = mergeSharedNarration(completed.messages, narration);
    if (limit === 1 || withHistoryRunCompletions(messages).reduce((cost, message) => cost + transcriptPresentationRowCost(message), 0) <= MAX_VISIBLE_HISTORY_ROWS) return { ...completed, messages };
  }
}
