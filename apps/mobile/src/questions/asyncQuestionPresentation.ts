import type { WorkspaceMessage } from '../workspace/workspaceTypes';

/** Only the complete readable fallback for this same structured item is redundant.
 * Extra prose, unknown formatting and ordinary assistant messages stay visible.
 * Compare display-safe labels, never the private wire labels used for replies.
 */
export function isAsyncQuestionFallback(message: WorkspaceMessage) {
  if (message.role !== 'assistant' || !message.asyncQuestion || message.asyncQuestion.questions.some(q => q.isSecret)) return false;
  const expected = message.asyncQuestion.questions.flatMap(q => [q.title, ...(q.options ?? []).map(option => `- ${option}`)]).join('\n');
  const normalized = (text: string) => text.split('\n').map(line => line.trim()).filter(Boolean).join('\n');
  return normalized(message.text) === normalized(expected);
}
