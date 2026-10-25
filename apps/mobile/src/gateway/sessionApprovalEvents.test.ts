import { expect, it } from 'vitest';
import { projectGatewayEvent, upsertLiveMessage } from './gatewayEventProjection';

const snapshot = {
  id: 'plugin:numbers', status: 'pending', createdAtMs: 1000, expiresAtMs: 121000,
  presentation: { kind: 'plugin', title: 'Allow ChatGPT to use Numbers?', description: 'Allow ChatGPT to use Numbers?', allowedDecisions: ['allow-once', 'allow-always', 'deny'] },
};
const frame = (approval = snapshot, phase = 'pending') => ({ event: 'session.approval', payload: { sessionKey: 'notes', sourceSessionKey: 'notes', phase, updatedAtMs: 1000, approval } });
it('projects the actual session-scoped Numbers approval contract with every offered choice', () => {
  expect(projectGatewayEvent(frame(), 'notes')?.message).toMatchObject({ id: 'live-approval-plugin:numbers', role: 'approval', sessionKey: 'notes', text: 'Allow ChatGPT to use Numbers?', approval: { kind: 'plugin', resolved: false, allowedDecisions: ['allow-once', 'allow-always', 'deny'], expiresAtMs: 121000 } });
});
it('keeps session audience authority and never borrows current selection', () => {
  expect(projectGatewayEvent(frame(), 'other')).toBeNull();
  expect(projectGatewayEvent({ event: 'session.approval', payload: { approval: snapshot } }, 'notes')).toBeNull();
});
it.each(['expired', 'denied', 'allowed', 'cancelled'])('projects a terminal %s snapshot without actionable buttons', status => {
  const approval = { ...snapshot, status, resolvedAtMs: 121000, reason: status === 'expired' ? 'timeout' : 'user', ...(status === 'allowed' ? { decision: 'allow-once' } : {}) };
  expect(projectGatewayEvent(frame(approval, 'terminal'), 'notes')?.message.approval).toMatchObject({ resolved: true, allowedDecisions: [], outcome: status === 'cancelled' ? 'resolved-externally' : status });
});
it.each([
  { ...snapshot, id: '' }, { ...snapshot, expiresAtMs: '121000' },
  { ...snapshot, presentation: { ...snapshot.presentation, kind: 'unknown' } },
  { ...snapshot, presentation: { ...snapshot.presentation, allowedDecisions: ['accept-anything'] } },
])('fails closed on malformed snapshots', approval => {
  expect(projectGatewayEvent({ ...frame(), payload: { ...frame().payload, approval } }, 'notes')).toBeNull();
});
it('does not resurrect a terminal approval when pending replay or the legacy event arrives late', () => {
  const terminal = projectGatewayEvent(frame({ ...snapshot, status: 'expired', resolvedAtMs: 121000 } as typeof snapshot, 'terminal'), 'notes')!.message;
  const pending = projectGatewayEvent(frame(), 'notes')!.message;
  expect(upsertLiveMessage([terminal], pending)[0]?.approval).toMatchObject({ resolved: true, outcome: 'expired' });
});

it('does not resurrect an answered row through the older list-recovery path either', async () => {
  const { reconcileApprovalAbsence } = await import('./approvalFinalization');
  const terminal = projectGatewayEvent(frame({ ...snapshot, status: 'allowed', resolvedAtMs: 2000, decision: 'allow-once' } as typeof snapshot, 'terminal'), 'notes')!.message;
  const pending = projectGatewayEvent(frame(), 'notes')!.message;
  expect(reconcileApprovalAbsence([terminal], [pending], 'notes', 3000).messages[0]?.approval).toMatchObject({ resolved: true, outcome: 'allowed' });
});
it('rejects foreign, malformed and oversized replay without inferring session ownership', async () => {
  const { sessionApprovalReplayFrames } = await import('./sessionApprovalEvents');
  expect(sessionApprovalReplayFrames({ sessionKey: 'other', approvals: [snapshot] }, 'notes')).toEqual([]);
  expect(sessionApprovalReplayFrames({ approvals: [snapshot] }, 'notes')).toEqual([]);
  expect(sessionApprovalReplayFrames({ sessionKey: 'notes', approvals: Array(1001).fill(snapshot) }, 'notes')).toEqual([]);
  expect(sessionApprovalReplayFrames({ sessionKey: 'notes', truncated: true, approvals: [snapshot, { ...snapshot, id: '' }] }, 'notes')).toHaveLength(1);
});
