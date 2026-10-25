import type { WorkspaceMessage } from '../workspace/workspaceTypes';

// Ordinary answers stay fully formatted. Pathological generated blocks are
// folded before React Native can materialize thousands of text cells at once;
// their canonical text and absolute source coordinates remain untouched.
export const MAX_DIRECT_CONVERSATION_ROWS = 600;
export const MAX_DIRECT_CONVERSATION_CHARACTERS = 64_000;
export const MAX_EXPANDED_MESSAGE_ROWS = 2_000;
export const MAX_EXPANDED_LINE_CHARACTERS = 8_000;
export const MACHINE_FOLD_CHARACTER_LIMIT = 1_200;

export function boundedExpandedTranscriptLine(value: string) {
  if (value.length <= MAX_EXPANDED_LINE_CHARACTERS) return value;
  return `${value.slice(0, MAX_EXPANDED_LINE_CHARACTERS)}… [${value.length - MAX_EXPANDED_LINE_CHARACTERS} characters omitted]`;
}

export function transcriptSourceLineCount(value: string) {
  let count = 1;
  for (let index = 0; index < value.length; index += 1) if (value.charCodeAt(index) === 10) count += 1;
  return count;
}

export function oversizedConversationMessage(message: Pick<WorkspaceMessage, 'role' | 'text'>, sourceLineCount = transcriptSourceLineCount(message.text)) {
  return (message.role === 'user' || message.role === 'assistant' || message.role === 'narration' || message.role === 'command')
    && (sourceLineCount > MAX_DIRECT_CONVERSATION_ROWS || message.text.length > MAX_DIRECT_CONVERSATION_CHARACTERS);
}

/**
 * Machine rows publish a semantic headline as their first line and their raw
 * payload underneath. Anything past that headline — object payloads, command
 * bodies, configuration, stdout/stderr, source — stays folded until the reader
 * asks for it, so a short structured payload can no longer render unfolded
 * just because it fits inside the character bound.
 */
export function transcriptMessageIsFoldedByDefault(
  message: Pick<WorkspaceMessage, 'role' | 'text'>,
  sourceLineCount = transcriptSourceLineCount(message.text),
) {
  const conversation = message.role === 'user' || message.role === 'assistant' || message.role === 'narration' || message.role === 'command';
  return message.role === 'tool'
    || oversizedConversationMessage(message, sourceLineCount)
    || (!conversation && (sourceLineCount > 1 || message.text.length > MACHINE_FOLD_CHARACTER_LIMIT));
}
