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

  it('lets an unscoped registry event refresh only the project census', () => {
    expect(refreshIntentForGatewayEvent({ event: 'sessions.changed', payload: { phase: 'updated' } }, 'agent:main:one')).toEqual({ detail: 'sessions.changed:updated', refreshSessions: true, refreshRegistry: true, refreshHistory: false });
  });

  it('refreshes the registry for lifecycle session changes', () => {
    expect(refreshIntentForGatewayEvent({ event: 'sessions.changed', payload: { sessionKey: 'agent:main:one', phase: 'updated' } }, 'agent:main:one')).toEqual({
      detail: 'sessions.changed:updated', refreshSessions: true, refreshRegistry: true, refreshHistory: true,
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
