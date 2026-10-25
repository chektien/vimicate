import { describe, expect, it } from 'vitest';
import type { WorkspaceMessage } from '../workspace/workspaceTypes';
import { projectGatewayEvent, upsertLiveMessage } from './gatewayEventProjection';
import { mergeLatestHistory } from './historyPagination';
import { shouldRefreshCanonicalHistory } from './historyRefreshPolicy';
import { SessionRunRegistry, sessionSubmissionDisposition } from './sessionRunRegistry';
import { bindOptimisticPromptToRun } from './submissionRunBinding';

const sessionKey = 'one';
const runId = 'run-a';

function prompt(id: string, text: string, source: 'history' | 'local', submission: string): WorkspaceMessage {
  return { id, text, role: 'user', source, sessionKey, runId, idempotencyKey: submission };
}

function assistantFrame(text: string, state: 'delta' | 'final' = 'delta') {
  const projection = projectGatewayEvent({
    event: 'chat',
    payload: { sessionKey, runId, state, message: { content: text } },
  }, sessionKey);
  if (!projection) throw new Error('assistant frame was not projected');
  return projection.message;
}

describe('queued follow-up stream convergence', () => {
  it('does not orphan cumulative answer snapshots around answerless history pages', () => {
    const registry = new SessionRunRegistry();
    registry.registerRun(sessionKey, runId);

    expect(sessionSubmissionDisposition(registry, sessionKey, false, true)).toBe('active-run-input');
    expect(shouldRefreshCanonicalHistory(Boolean(registry.runFor(sessionKey)), false)).toBe(false);

    const old: WorkspaceMessage = {
      id: 'old-answer', text: 'Previous answer.', role: 'assistant', source: 'history', sessionKey,
    };
    const firstLocal = prompt('local-a', 'Run the long audit.', 'local', 'submission-a');
    const secondLocal = prompt('local-b', 'Also include the latest notes.', 'local', 'submission-b');
    const firstCanonical = prompt('history-a', firstLocal.text, 'history', 'submission-a:user');
    const secondCanonical = prompt('history-b', secondLocal.text, 'history', 'submission-b:user');

    let published = upsertLiveMessage([old, firstLocal], assistantFrame('The audit is underway.'));
    published = bindOptimisticPromptToRun([...published, secondLocal], secondLocal.id, runId);
    expect(registry.runFor(sessionKey)).toBe(runId);

    // This page models the stale poll that caused the native A→B→A trail. RN
    // normally suppresses it above; forcing it through must still retain the
    // richer run-owned assistant rather than dropping and later re-appending it.
    let cumulative = 'The audit is underway.';
    for (let index = 1; index <= 40; index += 1) {
      published = mergeLatestHistory(
        index % 2 ? [old, firstCanonical] : [old, firstCanonical, secondCanonical],
        published,
        sessionKey,
      );
      cumulative += ` section-${index}`;
      published = upsertLiveMessage(published, assistantFrame(cumulative));
      expect(published.filter((message) => message.id === `live-chat-${runId}`)).toEqual([
        expect.objectContaining({ text: cumulative, state: 'streaming' }),
      ]);
    }

    published = upsertLiveMessage(published, assistantFrame('The audit is complete.', 'final'));

    const canonicalFinal: WorkspaceMessage = {
      id: 'history-final', text: 'The audit is complete.', role: 'assistant', source: 'history',
      sessionKey, idempotencyKey: 'submission-a:assistant',
    };
    published = mergeLatestHistory([old, firstCanonical, secondCanonical, canonicalFinal], published, sessionKey);

    expect(published.filter((message) => message.role === 'assistant').map((message) => message.text)).toEqual([
      'Previous answer.', 'The audit is complete.',
    ]);
    expect(published.some((message) => message.text.includes('underway'))).toBe(false);
  });
});
