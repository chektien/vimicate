import { afterEach, describe, expect, it, vi } from 'vitest';
import { SessionRunMonitorOwners } from './sessionRunMonitorOwners';

describe('session run monitor ownership', () => {
  afterEach(() => { vi.useRealTimers(); });
  it('lets a replacement run own monitoring before the old wait returns', () => {
    const owners = new SessionRunMonitorOwners();
    const old = owners.claim('one', 'old')!;
    expect(owners.owns('one', old)).toBe(true);
    expect(owners.claim('one', 'old')).toBeNull();
    const replacement = owners.claim('one', 'new')!;
    expect(owners.owns('one', old)).toBe(false);
    expect(owners.owns('one', replacement)).toBe(true);
    expect(owners.owns('two', replacement)).toBe(false);
    expect(owners.runFor('one')).toBe('new');
    expect(owners.release('one', old)).toBe(false);
    expect(owners.runFor('one')).toBe('new');
    expect(owners.release('one', replacement)).toBe(true);
    expect(owners.owns('one', replacement)).toBe(false);
  });

  it('revokes an exact ticket on clear even when the same run is reclaimed', () => {
    const owners = new SessionRunMonitorOwners(); const first = owners.claim('one', 'r1')!;
    owners.clear(); const second = owners.claim('one', 'r1')!;
    expect(owners.owns('one', first)).toBe(false);
    expect(owners.owns('one', second)).toBe(true);
    expect(owners.release('one', first)).toBe(false);
  });

  it('keeps independent session monitors concurrent', () => {
    const owners = new SessionRunMonitorOwners();
    expect(owners.claim('one', 'r1')).not.toBeNull();
    expect(owners.claim('two', 'r2')).not.toBeNull();
    expect(owners.runFor('one')).toBe('r1');
    expect(owners.runFor('two')).toBe('r2');
  });

  it.each(['release', 'clear', 'replacement', 'abort'] as const)('disposes its wait and listener on %s', async (action) => {
    vi.useFakeTimers();
    const owners = new SessionRunMonitorOwners(); const controller = new AbortController();
    const remove = vi.spyOn(controller.signal, 'removeEventListener');
    const token = owners.claim('one', 'r1', controller.signal)!;
    const wait = owners.wait('one', token, 60_000);
    expect(owners.wait('one', token, 60_000)).toBe(wait);
    expect(vi.getTimerCount()).toBe(1);
    if (action === 'release') owners.release('one', token);
    if (action === 'clear') owners.clear();
    if (action === 'replacement') owners.claim('one', 'r2');
    if (action === 'abort') controller.abort();
    await wait;
    expect(vi.getTimerCount()).toBe(0);
    expect(owners.owns('one', token)).toBe(false);
    expect(remove).toHaveBeenCalledOnce();
    owners.clear();
  });

  it('releases only the originating scene and rejects aborted admission', () => {
    const owners = new SessionRunMonitorOwners(); const first = new AbortController(); const second = new AbortController();
    owners.claim('one', 'r1', first.signal); const other = owners.claim('two', 'r2', second.signal)!;
    first.abort();
    expect(owners.claim('one', 'r1', first.signal)).toBeNull();
    expect(owners.owns('two', other)).toBe(true);
    const replacement = owners.claim('one', 'r1', second.signal)!;
    expect(replacement).not.toBeNull();
    owners.clear();
    expect(owners.owns('one', replacement)).toBe(false);
    expect(owners.owns('two', other)).toBe(false);
  });

  it('lets an owned wait elapse normally without losing its ticket or retaining a timer', async () => {
    vi.useFakeTimers();
    const owners = new SessionRunMonitorOwners(); const token = owners.claim('one', 'r1')!;
    const first = owners.wait('one', token, 250); await vi.advanceTimersByTimeAsync(250); await first;
    expect(owners.owns('one', token)).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
    const second = owners.wait('one', token, 750); expect(second).not.toBe(first);
    owners.release('one', token); await second;
    await owners.wait('one', token, 60_000);
    expect(vi.getTimerCount()).toBe(0);
  });
});
