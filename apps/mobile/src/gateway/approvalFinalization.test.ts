import { describe, expect, it } from 'vitest';
import type { WorkspaceMessage } from '../workspace/workspaceTypes';
import { approvalDecisionAction, approvalDecisionFailureAction, approvalFailureMeansExpired, approvalReconciliationAction, approvalReconciliationCandidates, incompleteApprovalRunMessage, messageAfterApprovalDecisionFailure, reconcileApprovalAbsence, runHasExpiredApproval } from './approvalFinalization';

const approval = (expiresAtMs?: number): WorkspaceMessage => ({
  id: 'live-approval-a1', role: 'approval', text: 'allow?', state: 'streaming', source: 'live', sessionKey: 'one', runId: 'r1',
  approval: { id: 'a1', kind: 'exec', allowedDecisions: ['allow-once', 'deny'], resolved: false, ...(expiresAtMs === undefined ? {} : { expiresAtMs }) },
});

describe('approval finalization truth', () => {
  it('commits successful decisions against current metadata, not the captured row', () => {
    const original = approval(); const action = approvalDecisionAction(original, 'allow-always');
    const current = { ...original, timestamp: 'newer-timestamp' };
    const neighbor: WorkspaceMessage = { id: 'neighbor', role: 'assistant', text: 'progress', sessionKey: 'one' };
    const next = action([current, neighbor]);
    expect(next[0]).toMatchObject({ timestamp: 'newer-timestamp', state: 'complete',
      approval: { resolved: true, allowedDecisions: [], outcome: 'allowed' } });
    expect(next[1]).toBe(neighbor);
    expect(action(next)[0]).toBe(next[0]);
  });

  it('never transfers successful decisions to a different identity or to unscoped rows', () => {
    const original = approval(); const action = approvalDecisionAction(original, 'deny');
    const unscoped = { ...original }; delete unscoped.sessionKey;
    const others: WorkspaceMessage[] = [
      { ...original, id: 'another-row' }, { ...original, sessionKey: 'two' }, { ...original, runId: 'r2' },
      { ...original, approval: { ...original.approval!, id: 'a2' } },
      { ...original, approval: { ...original.approval!, kind: 'plugin' } }, unscoped,
    ];
    action(others).forEach((row, index) => expect(row).toBe(others[index]));
    expect(approvalDecisionAction(unscoped, 'deny')([unscoped])[0]).toBe(unscoped);
  });

  it('checks the current approval at commit time and preserves newer row metadata and neighboring live rows', () => {
    const original = approval(); const action = approvalDecisionFailureAction(original, new Error('approval expired'));
    const current = { ...original, timestamp: 'newer-timestamp' };
    const neighbor: WorkspaceMessage = { id: 'live', role: 'assistant', text: 'progress', sessionKey: 'one' };
    const next = action([neighbor, current]);
    expect(next[0]).toBe(neighbor);
    expect(next[1]).toMatchObject({ timestamp: 'newer-timestamp', approval: { outcome: 'expired' } });
    const resolved: WorkspaceMessage = { ...current, approval: { ...current.approval!, resolved: true, outcome: 'allowed' } };
    expect(action([resolved])[0]).toBe(resolved);
  });

  it('never transfers an expiry to a different session, run, approval identity or kind', () => {
    const original = approval(); const action = approvalDecisionFailureAction(original, new Error('approval expired'));
    const others: WorkspaceMessage[] = [
      { ...original, sessionKey: 'two' }, { ...original, runId: 'r2' },
      { ...original, approval: { ...original.approval!, id: 'a2' } },
      { ...original, approval: { ...original.approval!, kind: 'plugin' } },
    ];
    action(others).forEach((row, index) => expect(row).toBe(others[index]));
    expect(approvalDecisionFailureAction(original, new Error('offline'))([original])[0]).toBe(original);
  });

  it('marks a provably expired approval incomplete and returns only its owning run', () => {
    const result = reconcileApprovalAbsence([approval(100), { ...approval(100), id: 'other', sessionKey: 'two', runId: 'r2' }], [], 'one', 101);
    expect(result.expiredRunIds).toEqual(['r1']);
    expect(result.messages[0]).toMatchObject({ state: 'error', approval: { resolved: true, outcome: 'expired', allowedDecisions: [] } });
    expect(runHasExpiredApproval(result.messages, 'one', 'r1')).toBe(true);
  });

  it('does not call an approval expired merely because another surface resolved it', () => {
    const result = reconcileApprovalAbsence([approval()], [], 'one', 101);
    expect(result.expiredRunIds).toEqual([]);
    expect(result.messages[0]).toMatchObject({ state: 'complete', approval: { outcome: 'resolved-externally' } });
  });

  it('reconciles against the transcript at commit time without erasing a queued live row', () => {
    const initial = [approval()];
    const liveNarration: WorkspaceMessage = {
      id: 'live-narration-r1', role: 'assistant', text: 'continuing after approval', state: 'streaming', source: 'live', sessionKey: 'one', runId: 'r1',
    };
    const staleAbsolutePreview = reconcileApprovalAbsence(initial, [], 'one', 101).messages;
    expect(staleAbsolutePreview).not.toContainEqual(liveNarration);

    const queuedActions: Array<(current: WorkspaceMessage[]) => WorkspaceMessage[]> = [
      (current) => [...current, liveNarration],
      approvalReconciliationAction([], 'one', approvalReconciliationCandidates(initial, 'one'), 101),
    ];
    const committed = queuedActions.reduce((current, action) => action(current), initial);

    expect(committed).toEqual([
      expect.objectContaining({ id: 'live-approval-a1', approval: expect.objectContaining({ resolved: true, outcome: 'resolved-externally' }) }),
      liveNarration,
    ]);
  });

  it('does not settle an approval that arrived after the pending query began', () => {
    const initial = [approval()];
    const laterApproval: WorkspaceMessage = {
      ...approval(), id: 'live-approval-a2', runId: 'r2',
      approval: { ...approval().approval!, id: 'a2' },
    };
    const candidates = approvalReconciliationCandidates(initial, 'one');
    const action = approvalReconciliationAction([], 'one', candidates, 101);

    expect(action([...initial, laterApproval])).toEqual([
      expect.objectContaining({ id: 'live-approval-a1', approval: expect.objectContaining({ resolved: true }) }),
      laterApproval,
    ]);
  });

  it('converts an unknown-or-expired resolve rejection into non-actionable evidence', () => {
    expect(approvalFailureMeansExpired(new Error('unknown or expired approval id'))).toBe(true);
    expect(approvalFailureMeansExpired(new Error('network disconnected'))).toBe(false);
    expect(messageAfterApprovalDecisionFailure(approval(), new Error('unknown or expired approval id'))).toMatchObject({
      state: 'error', approval: { resolved: true, outcome: 'expired', allowedDecisions: [] },
    });
  });

  it('uses a stable run-owned incomplete footer that a later run cannot replace', () => {
    const earlier = incompleteApprovalRunMessage('one', 'r1', 75_000);
    const later = incompleteApprovalRunMessage('one', 'r2', 2_000);
    expect(earlier.id).not.toBe(later.id);
    expect(earlier.text).toBe('● incomplete after 1m 15s · approval expired before a final answer');
  });
});
