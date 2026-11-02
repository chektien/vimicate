import { describe, expect, it } from 'vitest';
import { refreshIntentForGatewayEvent } from './gatewayEvents';

describe('gateway event routing', () => {
  it('refreshes selected history for subscribed session messages', () => {
    expect(refreshIntentForGatewayEvent({ event: 'session.message', payload: { sessionKey: 'agent:main:one' } }, 'agent:main:one')).toEqual({
      detail: 'session.message', refreshSessions: false, refreshRegistry: false, refreshHistory: true,
    });
  });

  it('does not replace the visible transcript for another session', () => {
    expect(refreshIntentForGatewayEvent({ event: 'session.message', payload: { sessionKey: 'agent:main:two' } }, 'agent:main:one')).toMatchObject({ detail: '', refreshHistory: false });
    expect(refreshIntentForGatewayEvent({ event: 'session.message', payload: {} }, 'agent:main:one')).toMatchObject({ detail: '', refreshHistory: false });
    expect(refreshIntentForGatewayEvent({ event: 'chat', payload: { state: 'final' } }, 'agent:main:one')).toMatchObject({ detail: '', refreshHistory: false });
    expect(refreshIntentForGatewayEvent({ event: 'exec.approval.requested', payload: { request: { sessionKey: 'agent:main:two' } } }, 'agent:main:one')).toMatchObject({ detail: '', refreshHistory: false });
  });

  it('lets an unscoped update refresh only the session census', () => {
    expect(refreshIntentForGatewayEvent({ event: 'sessions.changed', payload: { phase: 'updated' } }, 'agent:main:one')).toEqual({ detail: 'sessions.changed:updated', refreshSessions: true, refreshRegistry: false, refreshHistory: false });
  });

  it('refreshes selected history but not the registry for generic session updates', () => {
    expect(refreshIntentForGatewayEvent({ event: 'sessions.changed', payload: { sessionKey: 'agent:main:one', phase: 'updated' } }, 'agent:main:one')).toEqual({
      detail: 'sessions.changed:updated', refreshSessions: true, refreshRegistry: false, refreshHistory: true,
    });
  });

  it('uses the cheap transcript refresh path for selected message changes', () => {
    expect(refreshIntentForGatewayEvent({ event: 'sessions.changed', payload: { sessionKey: 'agent:main:one', phase: 'message' } }, 'agent:main:one').refreshSessions).toBe(false);
  });

  it('refreshes canonical history when the selected agent lifecycle becomes terminal', () => {
    expect(refreshIntentForGatewayEvent({ event: 'agent', payload: { sessionKey: 'agent:main:one', stream: 'lifecycle', data: { phase: 'end' } } }, 'agent:main:one')).toMatchObject({ refreshHistory: true, refreshSessions: true, refreshRegistry: true });
    expect(refreshIntentForGatewayEvent({ event: 'agent', payload: { sessionKey: 'agent:main:two', stream: 'lifecycle', data: { phase: 'end' } } }, 'agent:main:one')).toMatchObject({ detail: '', refreshHistory: false });
  });
});

it.each([
  { sessionKey: 'one', reason: 'activity-summary' },
  { reason: 'update' },
  { sessionKey: 'other', phase: 'message' },
])('keeps routine census $reason $phase off the registry reader', payload => {
  expect(refreshIntentForGatewayEvent({ event: 'sessions.changed', payload }, 'one')).toMatchObject({ refreshSessions: true, refreshRegistry: false });
});
it.each([
  { reason: 'update', catalogChanged: true }, { reason: 'create' }, { reason: 'new' },
  { reason: 'reset' }, { reason: 'delete' }, { reason: 'groups' }, { reason: 'project' },
  { reason: 'sharing' }, { reason: 'profile-identity' }, { phase: 'model' },
  { reason: 'fork' }, { reason: 'rewind' }, { reason: 'branch-switch' }, { reason: 'recovery' },
  { reason: 'archive' }, { reason: 'unarchive' }, { reason: 'cleanup' },
])('refreshes the registry for an explicit catalog mutation %j', payload => {
  expect(refreshIntentForGatewayEvent({ event: 'sessions.changed', payload }, 'one').refreshRegistry).toBe(true);
});

describe('async delivery history authority during a run', () => {
  const intent = (message: Record<string, unknown>) => refreshIntentForGatewayEvent({ event: 'session.message', payload: { sessionKey: 'one', message } }, 'one');
  it('leaves plain assistant progress to its live row instead of reloading canonical history', () => {
    expect(intent({ role: 'assistant', openclawAsyncDelivery: { itemId: 'progress' } })).toMatchObject({ refreshHistory: true });
    expect(intent({ role: 'assistant', openclawAsyncDelivery: { itemId: 'progress' } }).refreshDuringRun).toBeUndefined();
  });
  it('keeps throttled canonical refresh for question deliveries and non-assistant deliveries', () => {
    expect(intent({ role: 'assistant', openclawAsyncDelivery: { itemId: 'q', questions: [{ id: 'a' }] } })).toMatchObject({ refreshDuringRun: true, throttleDuringRun: true });
    expect(intent({ role: 'system', openclawAsyncDelivery: { itemId: 'notice' } })).toMatchObject({ refreshDuringRun: true, throttleDuringRun: true });
  });
});
