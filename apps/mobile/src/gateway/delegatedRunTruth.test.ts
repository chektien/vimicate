import { describe, expect, it } from 'vitest';
import type { WorkspaceMessage } from '../workspace/workspaceTypes';
import { delegatedFailureQualification } from './delegatedRunTruth';

describe('delegated run truth', () => {
  it('does not call the delegated job failed when only its parent monitor aborts', () => {
    const messages: WorkspaceMessage[] = [{ id: 'poll', role: 'tool', text: 'ccwork.sh poll 20260606-014120\n{"status":"running","remote_alive":true}', sessionKey: 'one', runId: 'parent', state: 'complete' }];
    expect(delegatedFailureQualification({ sessionKey: 'one', runId: 'parent', phase: 'failed' }, messages)).toEqual({
      signal: { sessionKey: 'one', runId: 'parent', phase: 'uncertain' },
      detail: 'parent monitor interrupted · delegated work may continue',
    });
  });

  it('keeps an ordinary failure failed and respects delegated terminal evidence', () => {
    expect(delegatedFailureQualification({ sessionKey: 'one', runId: 'r1', phase: 'failed' }, [])).toBeNull();
    const completed: WorkspaceMessage[] = [{ id: 'poll', role: 'tool', text: 'ccwork poll x {"status":"completed","remote_alive":false}', sessionKey: 'one', runId: 'r1' }];
    expect(delegatedFailureQualification({ sessionKey: 'one', runId: 'r1', phase: 'failed' }, completed)).toBeNull();
  });
});
