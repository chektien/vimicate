import type { WorkspaceMessage } from '../workspace/workspaceTypes';

export const QUESTION_PROMPT_FIXTURE_MODE = 'qa-question-prompt-v1';

/** Isolated QA design fixture: one pending two-question agent prompt. */
export function questionPromptFixtureMessages(nowMs = Date.now()): WorkspaceMessage[] {
  const sessionKey = 'fixture-question-session';
  return [
    { id: 'qp-user', role: 'user', text: 'Tidy the release notes and ship the OTA.', source: 'history', sessionKey, timestamp: String(nowMs - 60_000) },
    { id: 'qp-assistant', role: 'assistant', text: 'Two decisions before I publish.', source: 'history', sessionKey, state: 'complete', timestamp: String(nowMs - 30_000),
      question: {
        id: 'qp-record', sessionKey, createdAtMs: nowMs - 30_000, expiresAtMs: nowMs + 9 * 60_000, status: 'pending',
        questions: [
          { questionId: 'channel', header: 'Channel', question: 'Which channel should the update go to?', isOther: true, options: [
            { label: 'TestFlight', description: 'Internal group home only' },
            { label: 'Production', description: 'Every installed build on runtime 0.1.1' },
            { label: 'Hold', description: 'Commit the notes, publish later' },
          ] },
          { questionId: 'notes', header: 'Notes', question: 'Which items belong in the release notes?', multiSelect: true, options: [
            { label: 'Transcript accuracy' }, { label: 'Font steps' }, { label: 'Question cards' },
          ] },
        ],
      } },
  ];
}
