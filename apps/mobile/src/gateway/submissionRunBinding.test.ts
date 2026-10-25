import { describe, expect, it } from 'vitest';
import type { WorkspaceMessage } from '../workspace/workspaceTypes';
import { bindOptimisticPromptToRun } from './submissionRunBinding';

describe('optimistic prompt run binding', () => {
  it('binds only the locally-authored prompt so delayed preambles retain their turn anchor', () => {
    const rows: WorkspaceMessage[] = [
      { id: 'local-one', role: 'user', text: 'question', source: 'local', sessionKey: 'one' },
      { id: 'history-one', role: 'assistant', text: 'old', source: 'history', sessionKey: 'one' },
    ];
    expect(bindOptimisticPromptToRun(rows, 'local-one', 'run-one')).toEqual([
      { ...rows[0]!, runId: 'run-one' }, rows[1],
    ]);
  });
});
