import type { WorkspaceMessage } from '../workspace/workspaceTypes';
import { projectGatewayEvent } from '../gateway/gatewayEventProjection';
import { completedRunMessage, hasRenderedAssistantFinalForRun, pendingFinalRunMessage } from '../gateway/runCompletionMessage';

/** Render actual completion policy for a delayed fragment and a true final. */
export function finalAnswerAuthorityFixture(): WorkspaceMessage[] {
  const sessionKey = 'fixture-final-authority';
  const prompt: WorkspaceMessage = {
    id: 'authority-prompt', role: 'user', text: 'The run ended before its final reply arrived.',
    runId: 'delayed-run', sessionKey, source: 'history', timestamp: '2026-08-30T22:00:00+08:00',
  };
  const partial = projectGatewayEvent({ event: 'chat', payload: {
    sessionKey, runId: 'delayed-run', state: 'delta',
    message: { content: 'Draft review is still arriving.', timestamp: Date.parse('2026-08-30T22:00:01+08:00') },
  } }, sessionKey)!.message;
  const delayed = [prompt, partial];
  const pending = hasRenderedAssistantFinalForRun(delayed, 'delayed-run')
    ? completedRunMessage(sessionKey, 'delayed-run', 12_000)
    : pendingFinalRunMessage(sessionKey, 'delayed-run');
  const finalPrompt: WorkspaceMessage = {
    ...prompt, id: 'final-prompt', runId: 'finished-run', text: 'A separate run has its full canonical reply.',
    timestamp: '2026-08-30T22:01:00+08:00',
  };
  const final: WorkspaceMessage = {
    id: 'authority-final', role: 'assistant', text: 'The complete review is available.',
    sessionKey, source: 'history', timestamp: '2026-08-30T22:01:01+08:00',
  };
  const finished = [finalPrompt, final];
  const completion = hasRenderedAssistantFinalForRun(finished, 'finished-run')
    ? completedRunMessage(sessionKey, 'finished-run', 8_000)
    : pendingFinalRunMessage(sessionKey, 'finished-run');
  return [...delayed, pending, ...finished, completion];
}
