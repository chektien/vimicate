import { describe, expect, it } from 'vitest';
import { completedRunMessage, failedRunMessage, hasRenderedAssistantFinalForRun, pendingFinalRunMessage, reconcileOwnedPendingFinal, reconcileAuthoritativeActiveRunLifecycle, reconcileCompletedRunMessage, runElapsedDescription, runLifecycleMessageID } from './runCompletionMessage';
import type { WorkspaceMessage } from '../workspace/workspaceTypes';

describe('native-like run completion row', () => {
  it('retires only stale pending notices and preserves an older verified completion', () => {
    const pending = pendingFinalRunMessage('one', 'old');
    const done = completedRunMessage('one', 'verified', 1000);
    expect(reconcileOwnedPendingFinal([pending, done], 'one', 'old', false)).toEqual([done]);
    expect(reconcileOwnedPendingFinal([done], 'one', 'verified', false)).toEqual([done]);
  });

  it('formats elapsed time compactly', () => {
    expect(runElapsedDescription(12_900)).toBe('12s');
    expect(runElapsedDescription(62_000)).toBe('1m 2s');
    expect(runElapsedDescription(3_600_000)).toBe('1h');
  });

  it('formats a run-owned failure without borrowing another turn', () => {
    expect(failedRunMessage('one', 'r1', 62_000, 'error: quota')).toMatchObject({
      id: runLifecycleMessageID('one', 'r1'),
      role: 'error',
      state: 'error',
      text: '● failed after 1m 2s · error: quota',
      sessionKey: 'one',
      runId: 'r1',
    });
  });

  it('replaces the same run start while preserving earlier completed turns', () => {
    const first = completedRunMessage('one', 'r0', 1_000);
    const start: WorkspaceMessage = { id: runLifecycleMessageID('one', 'r1'), role: 'run', text: 'start', source: 'live', sessionKey: 'one', runId: 'r1' };
    const reconciled = reconcileCompletedRunMessage([first, start], completedRunMessage('one', 'r1', 2_500));
    expect(reconciled.map((message) => message.text)).toEqual(['✓ done in 1s', '✓ done in 2s']);
  });

  it('requires terminal assistant authority for the right run', () => {
    const answer: WorkspaceMessage = { id: 'new', role: 'assistant', text: 'new answer', runId: 'new-run' };
    expect(hasRenderedAssistantFinalForRun([{ id: 'old', role: 'assistant', text: 'older answer' }], 'new-run')).toBe(false);
    expect(hasRenderedAssistantFinalForRun([{ ...answer, state: 'streaming' }], 'new-run')).toBe(false);
    for (const state of ['complete', 'error'] as const) {
      expect(hasRenderedAssistantFinalForRun([{ ...answer, state }], 'new-run')).toBe(true);
      expect(hasRenderedAssistantFinalForRun([{ ...answer, state, runId: 'other-run' }], 'new-run')).toBe(false);
    }
  });

  it('accepts a canonical final without run metadata only inside the owned prompt turn', () => {
    const prompt: WorkspaceMessage = { id: 'prompt', role: 'user', text: 'question', source: 'local', runId: 'new-run' };
    const canonicalFinal: WorkspaceMessage = { id: 'final', role: 'assistant', text: 'answer', source: 'history' };
    expect(hasRenderedAssistantFinalForRun([prompt, canonicalFinal], 'new-run')).toBe(true);
  });

  it('does not borrow an assistant before the owned prompt or beyond a newer prompt', () => {
    const oldAnswer: WorkspaceMessage = { id: 'old-answer', role: 'assistant', text: 'old', source: 'history' };
    const prompt: WorkspaceMessage = { id: 'prompt', role: 'user', text: 'question', source: 'local', runId: 'new-run' };
    const newerPrompt: WorkspaceMessage = { id: 'newer-prompt', role: 'user', text: 'next question', source: 'history' };
    const newerAnswer: WorkspaceMessage = { id: 'newer-answer', role: 'assistant', text: 'next answer', source: 'history' };
    expect(hasRenderedAssistantFinalForRun([oldAnswer, prompt], 'new-run')).toBe(false);
    expect(hasRenderedAssistantFinalForRun([prompt, newerPrompt, newerAnswer], 'new-run')).toBe(false);
  });

  it('does not mistake narration or tool progress for a final answer', () => {
    const prompt: WorkspaceMessage = { id: 'prompt', role: 'user', text: 'question', source: 'local', runId: 'new-run' };
    const narration: WorkspaceMessage = { id: 'narration', role: 'narration', text: 'working', source: 'live', runId: 'new-run' };
    const tool: WorkspaceMessage = { id: 'tool', role: 'tool', text: 'result', source: 'live', runId: 'new-run' };
    expect(hasRenderedAssistantFinalForRun([prompt, narration, tool], 'new-run')).toBe(false);
  });

  it('keeps missing-final recovery non-red and removes stale recovery artifacts when the authoritative run remains active', () => {
    expect(pendingFinalRunMessage('one', 'operation')).toMatchObject({ role: 'run', state: 'streaming' });
    const staleLegacy: WorkspaceMessage = { id: runLifecycleMessageID('one', 'operation'), role: 'error', text: '● incomplete after 0s · run finished without a final answer', state: 'error', runId: 'operation', sessionKey: 'one', source: 'live' };
    const real = pendingFinalRunMessage('one', 'real-run');
    const priorDone = completedRunMessage('one', 'prior-run', 2_000);
    expect(reconcileAuthoritativeActiveRunLifecycle([staleLegacy, real, priorDone], 'one', 'real-run')).toEqual([real, priorDone]);
  });
});
