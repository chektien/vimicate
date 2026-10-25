import type { WorkspaceMessage } from '../workspace/workspaceTypes';
import { pruneUnownedRestoredLiveRows } from './transcriptChronology';

const CONVERSATION_ROLES = new Set<WorkspaceMessage['role']>([
  'user', 'assistant', 'narration', 'tool', 'media', 'approval', 'error',
]);

export function appendConversationBoundary(
  messages: WorkspaceMessage[],
  boundary: WorkspaceMessage,
): WorkspaceMessage[] {
  messages = pruneUnownedRestoredLiveRows(messages);
  const lastConversation = lastIndex(messages, (message) => CONVERSATION_ROLES.has(message.role));
  const lastBoundary = lastIndex(messages, (message) => message.role === 'boundary');
  if (lastConversation < 0 || lastBoundary > lastConversation) return messages;
  return [...messages, boundary];
}

/** Removes divider-only reset segments while preserving each reset that
 * actually separates or follows visible conversation content. */
export function compactEmptyConversationBoundaries(messages: WorkspaceMessage[]): WorkspaceMessage[] {
  const result: WorkspaceMessage[] = [];
  let lastConversation = -1;
  let lastBoundary = -1;
  for (const message of messages) {
    if (message.role === 'boundary') {
      // Compaction is an authored protocol event, not an empty /new reset.
      // Keep its one-line semantic marker even when the loaded window begins
      // at that event or another reset is adjacent to it.
      if (message.text === '--- compaction ---') {
        result.push(message);
        continue;
      }
      if (lastConversation < 0 || lastBoundary > lastConversation) continue;
      lastBoundary = result.length;
      result.push(message);
      continue;
    }
    result.push(message);
    if (CONVERSATION_ROLES.has(message.role)) lastConversation = result.length - 1;
  }
  return result;
}

function lastIndex(messages: WorkspaceMessage[], predicate: (message: WorkspaceMessage) => boolean) {
  for (let index = messages.length - 1; index >= 0; index -= 1) if (predicate(messages[index]!)) return index;
  return -1;
}
