import { describe, expect, it } from 'vitest';
import type { WorkspaceMessage } from '../workspace/workspaceTypes';
import { runLifecycleMessageID } from './runCompletionMessage';
import { reconcileFailedRunWait } from './runWaitSettlement';

describe('definitive agent.wait failure settlement', () => {
  const sessionKey = 'notes';
  const runId = 'run-failed';

  it('publishes one run-owned transcript error and settles its open tools', () => {
    const messages: WorkspaceMessage[] = [
      { id: 'prompt', role: 'user', text: 'do the work', source: 'local', sessionKey, runId },
      { id: 'tool', role: 'tool', text: 'bash', state: 'streaming', source: 'live', sessionKey, runId },
      { id: runLifecycleMessageID(sessionKey, runId), role: 'run', text: 'start', state: 'streaming', source: 'live', sessionKey, runId },
    ];

    const settled = reconcileFailedRunWait(
      messages,
      sessionKey,
      runId,
      { status: 'error', error: 'provider unavailable' },
      75_500,
    );

    expect(settled).toHaveLength(3);
    expect(settled.find((message) => message.id === 'tool')).toMatchObject({ state: 'error' });
    expect(settled.find((message) => message.id === runLifecycleMessageID(sessionKey, runId))).toMatchObject({
      role: 'error',
      state: 'error',
      text: '● failed after 1m 15s · error: provider unavailable',
      sessionKey,
      runId,
    });
  });

  it('does not synthesize an error for timeout, uncertainty or completion', () => {
    const messages: WorkspaceMessage[] = [
      { id: 'prompt', role: 'user', text: 'do the work', source: 'local', sessionKey, runId },
    ];
    expect(reconcileFailedRunWait(messages, sessionKey, runId, { status: 'timeout' }, 1_000)).toBe(messages);
    expect(reconcileFailedRunWait(messages, sessionKey, runId, { status: 'mystery' }, 1_000)).toBe(messages);
    expect(reconcileFailedRunWait(messages, sessionKey, runId, { status: 'done' }, 1_000)).toBe(messages);
  });
});
