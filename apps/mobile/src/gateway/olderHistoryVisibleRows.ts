import type { WorkspaceMessage } from '../workspace/workspaceTypes';
import { projectTranscriptDisplayGroups } from '../transcript/transcriptDisplayProjection';
import { visibleTranscriptMessages, type TranscriptDisplayOptions } from '../transcript/transcriptDisplayOptions';
import { buildVisibleTranscriptRenderRows } from '../transcript/transcriptVisibleRows';

export const OLDER_VISIBLE_ROW_TARGET = 80;
export const OLDER_REVIEW_COST_LIMIT = 2048;
export { OLDER_REVIEW_BYTE_LIMIT, olderReviewBytes } from './historyWindowBudget';
export const OLDER_READ_LIMIT = 32;

export type OlderHistoryVisibleContext = {
  retainedBoundaryMessageID?: string | undefined;
  expandedMessageIDs?: ReadonlySet<string>;
  displayOptions?: TranscriptDisplayOptions;
  previousProjectedMessages?: WorkspaceMessage[];
};

function renderedKeys(messages: WorkspaceMessage[], context: OlderHistoryVisibleContext) {
  const grouped = projectTranscriptDisplayGroups(messages, context.previousProjectedMessages);
  const visible = visibleTranscriptMessages(grouped, context.displayOptions ?? { verbose: true, progress: true });
  return buildVisibleTranscriptRenderRows(visible, context.expandedMessageIDs ?? new Set()).map(row => row.key);
}

/** Count actual newly rendered cells, including disclosure state and stable group keys. */
export function addedOlderVisibleRowCount(before: WorkspaceMessage[], after: WorkspaceMessage[], context: OlderHistoryVisibleContext) {
  const beforeKeys = new Set(renderedKeys(before, context));
  return renderedKeys(after, context).filter(key => !beforeKeys.has(key)).length;
}
