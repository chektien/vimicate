import type { WorkspaceMessage } from '../workspace/workspaceTypes';
import { hasRenderedAssistantFinalForRun } from './runCompletionMessage';
import type { RunLifecycleSignal } from './runLifecycleProjection';

/**
 * The Gateway can fail a run after its answer reached the thread. In the reproduced case, a watchdog killed the idle CLI ten minutes
 * after its answer was saved. A saved end-turn answer after the latest prompt means the
 * prompt was answered; commentary rows are narration and do not count.
 */
export function runAnsweredBeforeFailure(messages: WorkspaceMessage[], runId: string) {
  if (hasRenderedAssistantFinalForRun(messages, runId)) return true;
  const prompt = messages.findLastIndex((row) => row.role === 'user' && !row.asyncQuestionAnswerText);
  return prompt >= 0 && messages.slice(prompt + 1).some((row) => row.role === 'assistant' && row.source === 'history'
    && row.state !== 'streaming' && row.state !== 'error' && !row.asyncMessage && !row.asyncQuestion && Boolean(row.text.trim()));
}

/** An answered run's late failure settles the run as completed. */
export function answeredFailureAsCompletion(signal: RunLifecycleSignal | null, messages: WorkspaceMessage[]): RunLifecycleSignal | null {
  return signal?.phase === 'failed' && signal.runId && runAnsweredBeforeFailure(messages, signal.runId) ? { ...signal, phase: 'completed' } : signal;
}
