import { describe, expect, it, vi } from 'vitest';
import { GatewayRefreshBatch } from './gatewayRefreshBatch';
import { refreshIntentForGatewayEvent } from './gatewayEvents';

const frame = (key: string, terminal = false) => terminal
  ? { event: 'agent', payload: { sessionKey: key, stream: 'lifecycle', data: { phase: 'end' } } }
  : { event: 'session.message', payload: { sessionKey: key } };

describe('Gateway event refresh batch', () => {
  it('flushes a terminal batch within 120ms despite continuing message traffic', () => {
    vi.useFakeTimers();
    const batch = new GatewayRefreshBatch();
    const flush = vi.fn(() => batch.take('one', true));
    try {
      batch.schedule(refreshIntentForGatewayEvent(frame('one', true), 'one'), 'one', true, flush);
      for (let event = 0; event < 3; event++) {
        vi.advanceTimersByTime(30);
        batch.schedule(refreshIntentForGatewayEvent(frame('one'), 'one'), 'one', false, flush);
      }
      expect(flush).not.toHaveBeenCalled();
      vi.advanceTimersByTime(30);
      expect(flush).toHaveBeenCalledTimes(1);
      expect(flush.mock.results[0]?.value).toMatchObject({ refreshHistory: true, refreshRegistry: true });
      vi.advanceTimersByTime(120);
      expect(flush).toHaveBeenCalledTimes(1);
    } finally { batch.clear(); vi.useRealTimers(); }
  });

  it('cancels the pending timer on suspension and admits a new batch after resume', () => {
    vi.useFakeTimers();
    const batch = new GatewayRefreshBatch();
    const flush = vi.fn(() => batch.take('one', true));
    try {
      const intent = refreshIntentForGatewayEvent(frame('one', true), 'one');
      batch.schedule(intent, 'one', true, flush);
      batch.clear();
      vi.advanceTimersByTime(200);
      expect(flush).not.toHaveBeenCalled();
      batch.schedule(intent, 'one', true, flush);
      vi.advanceTimersByTime(120);
      expect(flush).toHaveBeenCalledTimes(1);
    } finally { batch.clear(); vi.useRealTimers(); }
  });

  it('retains terminal history and registry work through later live messages, once per batch', () => {
    const batch = new GatewayRefreshBatch();
    batch.add(refreshIntentForGatewayEvent(frame('one', true), 'one'), 'one', true);
    batch.add(refreshIntentForGatewayEvent(frame('one'), 'one'), 'one', false);
    expect(batch.take('one', true)).toEqual({ refreshSessions: true, refreshRegistry: true, refreshHistory: true, requiredHistorySessionKey: 'one' });
    expect(batch.take('one', true)).toEqual({ refreshSessions: false, refreshRegistry: false, refreshHistory: false, requiredHistorySessionKey: '' });
  });

  it('does not transfer terminal hydration authority when the selected thread changes', () => {
    const batch = new GatewayRefreshBatch();
    batch.add(refreshIntentForGatewayEvent(frame('one', true), 'one'), 'one', true);
    batch.add(refreshIntentForGatewayEvent(frame('two'), 'two'), 'two', false);
    expect(batch.take('two', true)).toMatchObject({ refreshSessions: true, refreshHistory: false, requiredHistorySessionKey: '' });
  });

  it('does not authorize selected history from another session’s terminal event', () => {
    const batch = new GatewayRefreshBatch();
    batch.add(refreshIntentForGatewayEvent(frame('other', true), 'one'), 'one', true);
    batch.add(refreshIntentForGatewayEvent(frame('one'), 'one'), 'one', false);
    expect(batch.take('one', true)).toMatchObject({ refreshHistory: false, requiredHistorySessionKey: '' });
  });

  it.each([true, false])('preserves routine history policy when runActive is %s', (active) => {
    const batch = new GatewayRefreshBatch();
    batch.add(refreshIntentForGatewayEvent(frame('one'), 'one'), 'one', false);
    expect(batch.take('one', active)).toMatchObject({ refreshHistory: !active, requiredHistorySessionKey: '' });
  });

  it('retires suspended scene work before fresh events arrive', () => {
    const batch = new GatewayRefreshBatch();
    batch.add(refreshIntentForGatewayEvent(frame('one', true), 'one'), 'one', true);
    batch.clear();
    batch.add(refreshIntentForGatewayEvent(frame('one'), 'one'), 'one', false);
    expect(batch.take('one', true)).toMatchObject({ refreshSessions: false, refreshRegistry: false, refreshHistory: false });
  });
});


it('hydrates another device’s user prompt during an active run, without granting that authority to later routine events', () => {
  const batch = new GatewayRefreshBatch();
  const remote = { event: 'session.message', payload: { sessionKey: 'one', message: { role: 'user', content: 'Also review this.' } } };
  batch.add(refreshIntentForGatewayEvent(remote, 'one'), 'one', false);
  batch.add(refreshIntentForGatewayEvent(frame('one'), 'one'), 'one', false);
  expect(batch.take('one', true)).toMatchObject({ refreshHistory: true, requiredHistorySessionKey: 'one' });
  batch.add(refreshIntentForGatewayEvent(frame('one'), 'one'), 'one', false);
  expect(batch.take('one', true)).toMatchObject({ refreshHistory: false, requiredHistorySessionKey: '' });
});

it('never transfers remote-input hydration authority to another selected thread', () => {
  const batch = new GatewayRefreshBatch();
  const remote = { event: 'session.message', payload: { sessionKey: 'one', message: { role: 'user', content: 'Also review this.' } } };
  batch.add(refreshIntentForGatewayEvent(remote, 'one'), 'one', false);
  batch.add(refreshIntentForGatewayEvent(frame('two'), 'two'), 'two', false);
  expect(batch.take('two', true)).toMatchObject({ refreshHistory: false, requiredHistorySessionKey: '' });
});


it('preserves prompt refresh when a session census shares the batch', () => {
  const batch = new GatewayRefreshBatch();
  const remote = { event: 'session.message', payload: { sessionKey: 'one', message: { role: 'user', content: 'Remote prompt.' } } };
  batch.add(refreshIntentForGatewayEvent(remote, 'one'), 'one', false);
  batch.add(refreshIntentForGatewayEvent({ event: 'sessions.changed', payload: { phase: 'updated' } }, 'one'), 'one', false);
  expect(batch.take('one', true)).toMatchObject({ refreshSessions: true, refreshHistory: true, requiredHistorySessionKey: 'one' });
});

it.each(['assistant', 'tool', undefined])('does not grant input refresh authority to a %s message', (role) => {
  const batch = new GatewayRefreshBatch();
  batch.add(refreshIntentForGatewayEvent({ event: 'session.message', payload: { sessionKey: 'one', message: { role } } }, 'one'), 'one', false);
  expect(batch.take('one', true).refreshHistory).toBe(false);
});
