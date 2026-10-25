import { messagesFromPayload } from '../workspace/historyMessageProjection';

export const CLAUDE_LINKED_PROMPT = 'SIMULATOR CLAUDE linked repeated prompt';
export const CLAUDE_LINKED_FIRST = 'SIMULATOR CLAUDE linked answer one.';
export const CLAUDE_LINKED_SECOND = 'SIMULATOR CLAUDE linked answer two.';

/** Two intentional equal-text submissions, each with an older native-only
 * cache row and the enriched canonical prompt returned by OpenClaw's
 * projectImportedIdentity. Neither turn has a canonical aggregate answer.
 * Keep the separate unlinked fixture: this proof must not be invented there. */
export function simulatorClaudePromptIdentityRows() {
  const messages = [1, 2].flatMap(index => {
    const native = { importedFrom: 'claude-cli', cliSessionId: '00000000-0000-4000-8000-000000000114', externalId: `linked-native-${index}` };
    return [
      { role: 'user', content: CLAUDE_LINKED_PROMPT, timestamp: 1789346850000 + index * 1000 + 1,
        __openclaw: { id: native.externalId, ...native } },
      { role: 'assistant', content: index === 1 ? CLAUDE_LINKED_FIRST : CLAUDE_LINKED_SECOND,
        timestamp: 1789346850500 + index * 1000, __openclaw: { id: `linked-answer-${index}` } },
      { role: 'user', content: CLAUDE_LINKED_PROMPT, timestamp: 1789346850000 + index * 1000,
        idempotencyKey: `linked-submission-${index}:user`,
        __openclaw: { id: `linked-canonical-${index}`, ...native, transcriptPosition: { source: 'sqlite', rawSeq: 100 + index } } },
    ];
  });
  return messagesFromPayload({ sessionKey: 'fixture:simulator:claude-linked',
    sessionId: '00000000-0000-4000-8000-000000000130', messages });
}
