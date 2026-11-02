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

it('coalesces active-run census and async question delivery on one non-extending two-second deadline', () => {
  vi.useFakeTimers();
  const batch = new GatewayRefreshBatch(); const flush = vi.fn(() => batch.take('one', true));
  const census = refreshIntentForGatewayEvent({ event: 'sessions.changed', payload: { sessionKey: 'one', reason: 'activity-summary' } }, 'one');
  const progress = refreshIntentForGatewayEvent({ event: 'session.message', payload: { sessionKey: 'one', message: { role: 'assistant', openclawAsyncDelivery: { itemId: 'progress', questions: [{ id: 'q' }] } } } }, 'one');
  try {
    batch.schedule(census, 'one', false, flush);
    for (let i = 0; i < 3; i++) { vi.advanceTimersByTime(500); batch.schedule(progress, 'one', false, flush); }
    expect(flush).not.toHaveBeenCalled(); vi.advanceTimersByTime(500);
    expect(flush).toHaveBeenCalledOnce();
    expect(flush.mock.results[0]?.value).toMatchObject({ refreshSessions: true, refreshRegistry: false, refreshHistory: true, requiredHistorySessionKey: 'one' });
    vi.advanceTimersByTime(2000); expect(flush).toHaveBeenCalledOnce();
  } finally { batch.clear(); vi.useRealTimers(); }
});

it('promotes a pending throttled census to the terminal fast path without dropping it', () => {
  vi.useFakeTimers(); const batch = new GatewayRefreshBatch(); let active = true;
  const flush = vi.fn(() => batch.take('one', active));
  try {
    batch.schedule(refreshIntentForGatewayEvent({ event: 'sessions.changed', payload: { reason: 'update' } }, 'one'), 'one', false, flush);
    vi.advanceTimersByTime(500); expect(flush).not.toHaveBeenCalled(); active = false;
    batch.schedule(refreshIntentForGatewayEvent(frame('one', true), 'one'), 'one', true, flush);
    vi.advanceTimersByTime(120); expect(flush).toHaveBeenCalledOnce();
    expect(flush.mock.results[0]?.value).toMatchObject({ refreshSessions: true, refreshRegistry: true, refreshHistory: true });
    vi.advanceTimersByTime(2000); expect(flush).toHaveBeenCalledOnce();
  } finally { batch.clear(); vi.useRealTimers(); }
});

it('keeps remote user input on the fast path during an active run', () => {
  vi.useFakeTimers(); const batch = new GatewayRefreshBatch(); const flush = vi.fn(() => batch.take('one', true));
  try {
    batch.schedule(refreshIntentForGatewayEvent({ event: 'session.message', payload: { sessionKey: 'one', message: { role: 'user' } } }, 'one'), 'one', false, flush);
    vi.advanceTimersByTime(120); expect(flush).toHaveBeenCalledOnce(); expect(flush.mock.results[0]?.value.refreshHistory).toBe(true);
  } finally { batch.clear(); vi.useRealTimers(); }
});

it('flushes pending work on run end even when the terminal event has no selected history intent', () => {
  vi.useFakeTimers(); const batch = new GatewayRefreshBatch(); const flush = vi.fn(() => batch.take('one', false));
  try {
    batch.schedule(refreshIntentForGatewayEvent(frame('one'), 'one'), 'one', false, flush);
    vi.advanceTimersByTime(500); expect(flush).not.toHaveBeenCalled();
    batch.schedule(refreshIntentForGatewayEvent(frame('other', true), 'one'), 'one', true, flush);
    vi.advanceTimersByTime(120); expect(flush).toHaveBeenCalledOnce(); expect(flush.mock.results[0]?.value.refreshHistory).toBe(true);
  } finally { batch.clear(); vi.useRealTimers(); }
});

it('holds other-session census for the five-second window even when the selected thread is idle', () => {
  vi.useFakeTimers(); const batch = new GatewayRefreshBatch(); const flush = vi.fn(() => batch.take('one', false));
  try {
    for (let i = 0; i < 16; i++) { batch.schedule(refreshIntentForGatewayEvent({ event: 'sessions.changed', payload: { sessionKey: 'other', reason: 'activity-summary' } }, 'one'), 'one', false, flush); vi.advanceTimersByTime(300); }
    expect(flush).not.toHaveBeenCalled(); vi.advanceTimersByTime(200);
    expect(flush).toHaveBeenCalledOnce(); expect(flush.mock.results[0]?.value).toMatchObject({ refreshSessions: true, refreshRegistry: false });
  } finally { batch.clear(); vi.useRealTimers(); }
});

it('lets due selected history shorten a pending census window, but not history a running thread will skip', () => {
  vi.useFakeTimers(); const batch = new GatewayRefreshBatch(); const flush = vi.fn(() => batch.take('one', false));
  const census = refreshIntentForGatewayEvent({ event: 'sessions.changed', payload: { sessionKey: 'other', reason: 'activity-summary' } }, 'one');
  const message = refreshIntentForGatewayEvent({ event: 'session.message', payload: { sessionKey: 'one', message: { role: 'assistant' } } }, 'one');
  try {
    batch.schedule(census, 'one', false, flush, true); batch.schedule(message, 'one', false, flush, true);
    vi.advanceTimersByTime(4900); expect(flush).not.toHaveBeenCalled(); vi.advanceTimersByTime(100); expect(flush).toHaveBeenCalledOnce();
    batch.schedule(census, 'one', false, flush, false); batch.schedule(message, 'one', false, flush, false);
    vi.advanceTimersByTime(2000); expect(flush).toHaveBeenCalledTimes(2);
  } finally { batch.clear(); vi.useRealTimers(); }
});
