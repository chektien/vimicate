import { coalesceTranscriptIdentities } from './transcriptIdentityWall';
import { historyCursorFromPayload } from './historyPagination';
import { historyPageCompletesRun, runMissingCanonicalPrompt } from './historyTurnCompleteness';
import type { OpenClawClient } from './OpenClawClient';
import { messagesFromPayload } from '../workspace/historyMessageProjection';
import { completePendingInputSnapshot } from './pendingInputSnapshot';

export async function completedLatestHistoryPage(
  client: OpenClawClient,
  sessionKey: string,
  firstPayload: Record<string, unknown>,
  workspacePath: string,
  isCurrent: () => boolean,
) {
  if (!isCurrent()) return null;
  let page = firstPayload;
  const publicCursor = historyCursorFromPayload(page, sessionKey);
  let lookbackCursor = publicCursor;
  let messages = client.decorateMessages(messagesFromPayload(page, workspacePath), sessionKey);
  const pendingInputSnapshot = completePendingInputSnapshot(page, messages, sessionKey);
  let lookbackProblem = '';
  const missingRunId = runMissingCanonicalPrompt(messages);
  if (!missingRunId) return { messages, cursor: publicCursor, lookbackProblem, pendingInputSnapshot };
  for (let attempt = 0; attempt < 2 && lookbackCursor.hasMore && lookbackCursor.nextOffset !== null; attempt += 1) {
    try {
      page = await client.history(sessionKey, 80, lookbackCursor.nextOffset);
    } catch (error) {
      if (!isCurrent()) return null;
      // The required latest page already succeeded. Keep its rows (and any
      // completed lookback), while the existing latest-history retry can
      // attempt prompt context again. Projection errors still propagate.
      lookbackProblem = `earlier prompt context: ${error instanceof Error ? error.message : 'history request failed'}`;
      break;
    }
    if (!isCurrent()) return null;
    lookbackCursor = historyCursorFromPayload(page, sessionKey);
    const older = client.decorateMessages(messagesFromPayload(page, workspacePath), sessionKey);
    messages = coalesceTranscriptIdentities([...older, ...messages]);
    if (historyPageCompletesRun(older, missingRunId)) break;
  }
  // Lookback rows make the newest run self-contained for publication, but
  // they do not consume pages from the reader's older-history traversal. The
  // bounded presentation window may omit some lookback rows; advancing the
  // public cursor here would then make that omitted page unreachable.
  return { messages, cursor: publicCursor, lookbackProblem, pendingInputSnapshot };
}
