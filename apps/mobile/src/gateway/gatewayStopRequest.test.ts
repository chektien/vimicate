import { describe, expect, it, vi } from 'vitest';
import { requestGatewayStop } from './gatewayStopRequest';
import { SessionRunRegistry } from './sessionRunRegistry';
import { HistoryPublicationAuthority } from './historyPublicationAuthority';

vi.mock('react', () => ({ useCallback: (callback: unknown) => callback }));
import { useGatewayAbort } from './useGatewayAbort';

const yes = { ok: true, aborted: true, runIds: ['run-one'] };
const no = { ok: true, aborted: false, runIds: [] };
function setup() {
  const registry = new SessionRunRegistry(); registry.registerRun('thread', 'run-one');
  let resolve!: (value: unknown) => void;
  let reject!: (error: Error) => void;
  const response = new Promise((yes, no) => { resolve = yes; reject = no; });
  const client = { status: 'connected', abort: vi.fn(() => response) };
  return { registry, client, resolve, reject, start: () => requestGatewayStop(client, registry, 'thread', 'run-one') };
}
describe('exact-run Stop receipts', () => {
  it.each(['before', 'after'])('a negative receipt never masks failure arriving %s it', async order => {
    const f = setup(); const pending = f.start();
    if (order === 'before') f.registry.observePhase('thread', 'failed', 'run-one');
    f.resolve(no); expect(await pending).toBe('Gateway did not stop this run.');
    if (order === 'after') f.registry.observePhase('thread', 'failed', 'run-one');
    expect(f.registry.phaseFor('thread')).toBe('failed');
  });
  it.each(['before', 'after'])('an exact confirmation preserves stopped semantics with failure %s receipt', async order => {
    const f = setup(); const pending = f.start();
    if (order === 'before') { f.registry.observePhase('thread', 'failed', 'run-one'); expect(f.registry.phaseFor('thread')).toBe('failed'); }
    f.resolve(yes); expect(await pending).toBe('Stop accepted.');
    if (order === 'after') f.registry.observePhase('thread', 'failed', 'run-one');
    expect(f.registry.phaseFor('thread')).toBe('completed');
  });
  it('acceptance does not itself finish an active run', async () => {
    const f = setup(); const pending = f.start(); f.resolve(yes); await pending;
    expect(f.registry.runFor('thread')).toBe('run-one'); expect(f.registry.isBusy('thread')).toBe(true);
  });
  it('late confirmation retains the terminal event timing', async () => {
    const f = setup(); const pending = f.start();
    f.registry.observePhase('thread', 'failed', 'run-one', { endedAtMs: 5000, durationMs: 2500 });
    f.resolve(yes); await pending;
    expect(f.registry.timingFor('thread')).toMatchObject({ endedAtMs: 5000, durationMs: 2500 });
  });
  it.each([null, {}, { ok: true, aborted: true }, { ok: true, aborted: 'true', runIds: ['run-one'] }, { ok: true, aborted: true, runIds: [1] }])('malformed receipt stays unconfirmed: %j', async receipt => {
    const f = setup(); const pending = f.start(); f.resolve(receipt);
    await expect(pending).rejects.toThrow('unconfirmed');
    f.registry.observePhase('thread', 'failed', 'run-one'); expect(f.registry.phaseFor('thread')).toBe('failed');
  });
  it('a receipt for another run cannot confirm this Stop', async () => {
    const f = setup(); const pending = f.start(); f.resolve({ ...yes, runIds: ['other'] });
    expect(await pending).toBe('Gateway did not stop this run.');
    f.registry.observePhase('thread', 'failed', 'run-one'); expect(f.registry.phaseFor('thread')).toBe('failed');
  });
  it('a rejected RPC retires pending intent', async () => {
    const f = setup(); const pending = f.start(); f.reject(new Error('disconnected'));
    await expect(pending).rejects.toThrow('disconnected');
    f.registry.observePhase('thread', 'failed', 'run-one'); expect(f.registry.phaseFor('thread')).toBe('failed');
  });
  it('a late confirmation cannot finish a successor', async () => {
    const f = setup(); const pending = f.start(); f.registry.registerRun('thread', 'successor'); f.resolve(yes); await pending;
    expect(f.registry.runFor('thread')).toBe('successor');
    f.registry.observePhase('thread', 'failed', 'successor'); expect(f.registry.phaseFor('thread')).toBe('failed');
  });
  it('registry retirement invalidates pending confirmations even if the same identity is restored', async () => {
    const f = setup(); const pending = f.start(); f.registry.restore(JSON.stringify({ thread: 'run-one' })); f.resolve(yes); await pending;
    f.registry.observePhase('thread', 'failed', 'run-one'); expect(f.registry.phaseFor('thread')).toBe('failed');
  });
  it('a second negative request cannot erase another confirmed Stop for the same run', async () => {
    const f = setup(); const first = f.registry.beginStopRequest('thread', 'run-one');
    const second = f.registry.beginStopRequest('thread', 'run-one'); first(true); second(false);
    f.registry.observePhase('thread', 'failed', 'run-one'); expect(f.registry.phaseFor('thread')).toBe('completed');
  });
  it('bounds concurrent requests for one run without revoking admitted confirmations', () => {
    const f = setup(); const requests = Array.from({ length: 4 }, () => f.registry.beginStopRequest('thread', 'run-one'));
    expect(() => f.registry.beginStopRequest('thread', 'run-one')).toThrow('already pending');
    requests[0]!(true); for (const settle of requests.slice(1)) settle(false);
    f.registry.observePhase('thread', 'failed', 'run-one'); expect(f.registry.phaseFor('thread')).toBe('completed');
  });
  it('terminal eviction retires pending confirmations for a reappearing identity', () => {
    const registry = new SessionRunRegistry(1); registry.registerRun('first', 'run-one');
    const settle = registry.beginStopRequest('first', 'run-one'); registry.observePhase('first', 'failed', 'run-one');
    registry.registerRun('other', 'run-two'); registry.observePhase('other', 'completed', 'run-two');
    registry.registerRun('first', 'run-one'); settle(true); registry.observePhase('first', 'failed', 'run-one');
    expect(registry.phaseFor('first')).toBe('failed');
  });
  it('terminal eviction removes old confirmed Stop authority', () => {
    const registry = new SessionRunRegistry(1); registry.registerRun('first', 'run-one');
    registry.beginStopRequest('first', 'run-one')(true); registry.observePhase('first', 'failed', 'run-one');
    registry.registerRun('other', 'run-two'); registry.observePhase('other', 'completed', 'run-two');
    registry.registerRun('first', 'run-one'); registry.observePhase('first', 'failed', 'run-one');
    expect(registry.phaseFor('first')).toBe('failed');
  });
});

describe('Stop button receipt publication', () => {
  function button() {
    const f = setup(); const selected = { current: 'thread' }; const scene = { current: new HistoryPublicationAuthority() };
    const detail = vi.fn(); const publish = vi.fn();
    const stop = useGatewayAbort(f.client as never, selected, { current: f.registry }, scene, detail, publish);
    return { ...f, selected, scene, detail, publish, stop };
  }
  it('shows negative receipt instead of leaving aborting and preserves real failure', async () => {
    const f = button(); const pending = f.stop(); f.resolve(no); await pending;
    expect(f.detail).toHaveBeenLastCalledWith('Gateway did not stop this run.');
    f.registry.observePhase('thread', 'failed', 'run-one'); expect(f.registry.phaseFor('thread')).toBe('failed');
  });
  it('publishes terminal-before-confirmation upgrade', async () => {
    const f = button(); const pending = f.stop(); f.registry.observePhase('thread', 'failed', 'run-one'); f.resolve(yes); await pending;
    expect(f.registry.phaseFor('thread')).toBe('completed'); expect(f.publish).toHaveBeenCalledWith('thread');
  });
  it('clears requesting-stop feedback on an owned RPC error', async () => {
    const f = button(); const pending = f.stop(); f.reject(new Error('disconnected'));
    await expect(pending).rejects.toThrow('disconnected');
    expect(f.detail).toHaveBeenLastCalledWith('disconnected');
    f.registry.observePhase('thread', 'failed', 'run-one'); expect(f.registry.phaseFor('thread')).toBe('failed');
  });
  it.each(['switch', 'retire', 'successor'])('does not publish a late response after %s', async action => {
    const f = button(); const pending = f.stop();
    if (action === 'switch') f.selected.current = 'other';
    if (action === 'retire') f.scene.current.suspend();
    if (action === 'successor') f.registry.registerRun('thread', 'successor');
    f.resolve(no); await pending;
    expect(f.detail).toHaveBeenCalledTimes(1); expect(f.publish).not.toHaveBeenCalled();
  });
});
