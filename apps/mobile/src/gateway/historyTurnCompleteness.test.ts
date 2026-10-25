import { describe, expect, it } from 'vitest';
import type { WorkspaceMessage } from '../workspace/workspaceTypes';
import { historyPageCompletesRun, runMissingCanonicalPrompt } from './historyTurnCompleteness';

const row = (id: string, role: WorkspaceMessage['role'], runId?: string): WorkspaceMessage => ({ id, role, text: id, source: 'history', ...(runId ? { runId } : {}) });

describe('bounded cross-device turn completeness', () => {
  it('requests older context only for an assistant with concrete unmatched run identity', () => {
    expect(runMissingCanonicalPrompt([row('answer', 'assistant', 'r1')])).toBe('r1');
    expect(runMissingCanonicalPrompt([row('prompt', 'user', 'r1'), row('answer', 'assistant', 'r1')])).toBe('');
  });

  it('keeps proactive and legacy assistant-only rows as valid negative controls', () => {
    expect(runMissingCanonicalPrompt([row('cron', 'assistant'), row('import', 'assistant')])).toBe('');
  });

  it('accepts only the exact canonical user run from an older page', () => {
    expect(historyPageCompletesRun([row('other', 'user', 'r2')], 'r1')).toBe(false);
    expect(historyPageCompletesRun([row('prompt', 'user', 'r1')], 'r1')).toBe(true);
  });
});
