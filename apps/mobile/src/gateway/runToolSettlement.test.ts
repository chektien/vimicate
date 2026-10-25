import { describe, expect, it } from 'vitest';
import type { WorkspaceMessage } from '../workspace/workspaceTypes';
import { settleRunToolMessages } from './runToolSettlement';

const tool = (id: string, sessionKey: string, runId: string): WorkspaceMessage => ({ id, role: 'tool', text: id, sessionKey, runId, source: 'live', state: 'streaming', tool: { name: id, summary: id } });

describe('terminal run tool settlement', () => {
  it('settles a missing tool terminal frame when its owning run completes', () => {
    const rows = [tool('web-search', 'one', 'run-1'), { ...tool('web-fetch', 'one', 'run-1'), state: 'complete' as const }, tool('other-run', 'one', 'run-2'), tool('other-session', 'two', 'run-1')];
    const settled = settleRunToolMessages(rows, 'one', 'run-1', 'completed');
    expect(settled.map((row) => row.state)).toEqual(['complete', 'complete', 'streaming', 'streaming']);
  });

  it('marks an unresolved owned tool failed only on authoritative run failure', () => {
    expect(settleRunToolMessages([tool('exec', 'one', 'run-1')], 'one', 'run-1', 'failed')[0]?.state).toBe('error');
  });
});
