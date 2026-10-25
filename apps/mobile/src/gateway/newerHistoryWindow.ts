import type { WorkspaceMessage } from '../workspace/workspaceTypes';
import { latestPresentationWindow, olderHistoryWindow } from './historyWindow';
import { historyMessageBytes, OLDER_REVIEW_BYTE_LIMIT } from './historyWindowBudget';
import { mergeOlderHistory } from './historyPagination';
import { withHistoryRunCompletions } from './historyRunCompletion';
import { OLDER_REVIEW_COST_LIMIT } from './olderHistoryVisibleRows';

/** Leave room for forward progress while retaining overlapping reader geometry. */
export function newerHistoryWindow(visible: WorkspaceMessage[], newer: WorkspaceMessage[], sessionKey: string, retainedBoundaryMessageID?: string) {
  const boundaryIndex = retainedBoundaryMessageID ? visible.findIndex(row => row.id === retainedBoundaryMessageID) : -1;
  let suffix = boundaryIndex >= 0 ? visible.slice(boundaryIndex) : latestPresentationWindow(visible, 240);
  let bytes = suffix.reduce((sum, row) => sum + historyMessageBytes(row), 0);
  while (boundaryIndex < 0 && suffix.length > 1 && bytes > OLDER_REVIEW_BYTE_LIMIT / 4) {
    bytes -= historyMessageBytes(suffix[0]!); suffix = suffix.slice(1);
  }
  const boundary = suffix.at(-1);
  const merged = withHistoryRunCompletions(mergeOlderHistory(suffix, newer, sessionKey));
  const next = olderHistoryWindow([], merged, sessionKey, OLDER_REVIEW_COST_LIMIT, boundary?.id);
  const retained = new Set(visible.map(row => row.id));
  if (next.some(row => !retained.has(row.id)) || !newer.length) return next;
  // The measured reader span and its immediate successor are the minimum
  // safe handoff. Like older boundary admission, this explicit overlap
  // exception progresses even if one indivisible record exceeds the soft cap.
  const successor = newer.find(row => !retained.has(row.id));
  return successor && boundary ? [...suffix, successor] : next;
}
