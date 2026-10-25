import { describe, expect, it, vi } from 'vitest';
import { LiveMessagePublicationTimers } from './liveMessagePublication';
import { scheduleSharedNarrationRefresh } from './sharedNarrationLiveRefresh';

describe('active shared-narration refresh', () => {
  it('coalesces rapid preambles and refreshes the owning session once', () => {
    vi.useFakeTimers();
    const timers = new LiveMessagePublicationTimers();
    const refresh = vi.fn(async () => undefined);
    const narration = { id: 'pre', role: 'narration' as const, text: 'checking' };

    expect(scheduleSharedNarrationRefresh(timers, narration, 'one', refresh)).toBe(true);
    expect(scheduleSharedNarrationRefresh(timers, narration, 'one', refresh)).toBe(true);
    vi.advanceTimersByTime(120);

    expect(refresh).toHaveBeenCalledTimes(1);
    expect(refresh).toHaveBeenCalledWith('one');
    vi.useRealTimers();
  });

  it('ignores non-narration rows', () => {
    const refresh = vi.fn(async () => undefined);
    expect(scheduleSharedNarrationRefresh(new LiveMessagePublicationTimers(), { id: 'tool', role: 'tool', text: 'x' }, 'one', refresh)).toBe(false);
    expect(refresh).not.toHaveBeenCalled();
  });

  it('reports a rejected delayed refresh through the timer owner', async () => {
    vi.useFakeTimers();
    const failure = vi.fn();
    const refresh = vi.fn(async () => { throw new Error('narration refresh failed'); });

    expect(scheduleSharedNarrationRefresh(
      new LiveMessagePublicationTimers(),
      { id: 'pre', role: 'narration', text: 'checking' },
      'one',
      refresh,
      failure,
    )).toBe(true);
    vi.advanceTimersByTime(120);
    await Promise.resolve();
    await Promise.resolve();

    expect(failure).toHaveBeenCalledWith(expect.objectContaining({ message: 'narration refresh failed' }));
    vi.useRealTimers();
  });
});
