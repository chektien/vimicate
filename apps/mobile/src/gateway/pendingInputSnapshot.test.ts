import { describe, expect, it } from 'vitest';
import { type WorkspaceMessage } from '../workspace/workspaceTypes';
import { messagesFromPayload } from '../workspace/historyMessageProjection';
import {
  completePendingInputSnapshot,
  pendingInputCustodyCandidates,
  reconcileCompletePendingInputSnapshot,
} from './pendingInputSnapshot';

const sessionKey = 'agent:main:dashboard:thread';
const sessionId = '00000000-0000-4000-8000-000000000117';
const queued = (id: string, acceptedAt: number) => ({
  id, runId: `receipt-${id}`, state: 'queued', acceptedAt,
  message: { role: 'user', content: id, __openclaw: { id: `pending:${id}` } },
});
const payload = (items: unknown[], patch: Record<string, unknown> = {}) => ({
  sessionKey, sessionId, messages: [], pendingInputs: { items, total: items.length, ...patch },
});

describe('complete pending-input snapshots', () => {
  it('accepts one complete same-generation snapshot and rejects missing, partial or paged input', () => {
    const complete = payload([queued('one', 1000)]);
    const projected = messagesFromPayload(complete);
    expect(completePendingInputSnapshot(complete, projected, sessionKey)).toEqual({
      sessionKey, transcriptSessionId: sessionId, rowIDs: ['pending-input:one'],
    });
    expect(completePendingInputSnapshot({ sessionKey, sessionId, messages: [] }, [], sessionKey)).toBeNull();
    expect(completePendingInputSnapshot(payload([queued('one', 1000)], { total: 2 }), projected, sessionKey)).toBeNull();
    expect(completePendingInputSnapshot(payload([queued('one', 1000)], { nextBefore: 'cursor' }), projected, sessionKey)).toBeNull();
    expect(completePendingInputSnapshot(complete, projected, 'other-route')).toBeNull();
    expect(completePendingInputSnapshot({ ...complete, sessionId: 'foreign' }, projected, sessionKey)).toBeNull();
  });

  it('retires only captured custody rows absent from the complete response', () => {
    const original = messagesFromPayload(payload([queued('old', 1000)]));
    const candidates = pendingInputCustodyCandidates(original, sessionKey);
    const settledPayload = payload([]);
    const snapshot = completePendingInputSnapshot(settledPayload, [], sessionKey)!;
    const newer = messagesFromPayload(payload([queued('new', 2000)]))[0]!;
    const foreign: WorkspaceMessage = { ...original[0]!, transcriptSessionId: '00000000-0000-4000-8000-000000000106' };
    const promoted: WorkspaceMessage = {
      ...original[0]!, idempotencyKey: 'submission:user',
      displayPosition: { source: 'sqlite', rawSeq: 10 },
    };

    expect(reconcileCompletePendingInputSnapshot(
      [...original, newer, foreign, promoted], { snapshot, candidates },
    )).toEqual([newer, foreign, promoted]);
  });
});
