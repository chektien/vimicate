import type { WorkspaceMessage } from '../workspace/workspaceTypes';

/** A folded header needs one surviving member; expanded detail needs its visible group. */
export function transcriptForwardReviewBoundary(messages: WorkspaceMessage[], messageIndex: number | undefined,
  expanded: ReadonlySet<string>) {
  const message = messageIndex === undefined ? undefined : messages[messageIndex];
  if (!message?.toolGroup) return message?.id;
  return expanded.has(message.id) ? messages[messageIndex! + 1]?.id ?? message.toolGroup.lastMessageId
    : message.toolGroup.lastMessageId;
}
