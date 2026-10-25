import type { WorkspaceMessage } from '../workspace/workspaceTypes';
import { mergeLatestHistory, mergeOlderHistory } from './historyPagination';
import { withHistoryRunCompletions } from './historyRunCompletion';
import { oversizedConversationMessage } from '../transcript/transcriptRowBudget';
import { coalesceTranscriptIdentities } from './transcriptIdentityWall';
import { historyMessageBytes, OLDER_REVIEW_BYTE_LIMIT } from './historyWindowBudget';
import type { PendingInputSnapshotReconciliation } from './pendingInputSnapshot';

export const MAX_VISIBLE_HISTORY_ROWS = 480;

export function latestHistoryWindow(latest: WorkspaceMessage[], current: WorkspaceMessage[], sessionKey: string, limit = MAX_VISIBLE_HISTORY_ROWS, pendingInputs?: PendingInputSnapshotReconciliation) {
  const merged = withHistoryRunCompletions(mergeLatestHistory(latest, current, sessionKey, pendingInputs));
  return boundedPresentationWindow(merged, 'latest', limit);
}

export function olderHistoryWindow(older: WorkspaceMessage[], current: WorkspaceMessage[], sessionKey: string, limit = MAX_VISIBLE_HISTORY_ROWS, retainThroughID?: string) {
  const merged = withHistoryRunCompletions(mergeOlderHistory(older, current, sessionKey));
  const bounded = boundedPresentationWindow(merged, 'older', limit);
  const boundary = retainThroughID ? merged.findIndex(row => row.id === retainThroughID) : -1;
  // A transport page is sized before admission. Its last indivisible raw
  // record may exceed the soft budget, but cannot erase the reviewed boundary.
  return boundary >= bounded.length ? merged.slice(0, boundary + 1) : bounded;
}

export function latestPresentationWindow(messages: WorkspaceMessage[], limit = MAX_VISIBLE_HISTORY_ROWS) {
  return boundedPresentationWindow(messages, 'latest', limit);
}

export function transcriptPresentationRowCost(message: WorkspaceMessage) {
  const machineFolded = message.role === 'tool' || oversizedConversationMessage(message) || (!['user', 'assistant', 'narration'].includes(message.role) && message.text.length > 1200);
  const textRows = machineFolded ? 1 : Math.max(1, message.text.split('\n').filter((line) => line.trim()).length);
  const mediaRows = message.attachments?.length ? Math.ceil(message.attachments.length / 3) * 6 : 0;
  return textRows + mediaRows;
}

function boundedPresentationWindow(messages: WorkspaceMessage[], side: 'latest' | 'older', limit: number) {
  messages = coalesceTranscriptIdentities(messages);
  if (messages.length < 2) return messages;
  if (side === 'latest') return boundedLatestPresentationWindow(messages, limit);
  const ordered = messages;
  const retained: WorkspaceMessage[] = [];
  let rows = 0;
  let bytes = 0;
  for (const message of ordered) {
    const cost = transcriptPresentationRowCost(message);
    const messageBytes = historyMessageBytes(message);
    if (retained.length && (rows + cost > limit || bytes + messageBytes > OLDER_REVIEW_BYTE_LIMIT)) break;
    retained.push(message); rows += cost; bytes += messageBytes;
  }
  return retained;
}

function boundedLatestPresentationWindow(messages: WorkspaceMessage[], limit: number) {
  let start = messages.length;
  let rows = 0;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const cost = transcriptPresentationRowCost(messages[index]!);
    if (start < messages.length && rows + cost > limit) break;
    start = index;
    rows += cost;
  }
  if (start <= 0 || messages[start]?.role === 'user' || messages[start]?.role === 'boundary') return messages.slice(start);

  const promptIndex = precedingUserTurnBoundary(messages, start);
  if (promptIndex < 0) return messages.slice(start);
  const prompt = messages[promptIndex]!;
  const promptCost = transcriptPresentationRowCost(prompt);
  // Keep the accepted turn boundary and discard the oldest detail inside that
  // turn. A single newest message remains even when two individually legal
  // conversation blocks exceed the soft presentation budget together.
  while (start < messages.length - 1 && rows + promptCost > limit) {
    rows -= transcriptPresentationRowCost(messages[start]!);
    start += 1;
  }
  return [prompt, ...messages.slice(start)];
}

function precedingUserTurnBoundary(messages: WorkspaceMessage[], start: number) {
  for (let index = start - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === 'boundary') return -1;
    if (messages[index]?.role === 'user') return index;
  }
  return -1;
}
