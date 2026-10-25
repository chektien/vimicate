import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PROJECT_REGISTRY_RETRY_DELAYS_MS, ProjectRegistryRetryOwner } from './projectRegistryRetry';

describe('project registry startup retry owner', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('owns one retry timer and advances bounded backoff only after it fires', () => {
    const owner = new ProjectRegistryRetryOwner();
    const retry = vi.fn();

    expect(owner.schedule(retry)).toBe(true);
    expect(owner.schedule(retry)).toBe(false);
    expect(owner.pending).toBe(true);
    vi.advanceTimersByTime(PROJECT_REGISTRY_RETRY_DELAYS_MS[0] - 1);
    expect(retry).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(retry).toHaveBeenCalledOnce();
    expect(owner.pending).toBe(false);

    expect(owner.schedule(retry)).toBe(true);
    vi.advanceTimersByTime(PROJECT_REGISTRY_RETRY_DELAYS_MS[1]);
    expect(retry).toHaveBeenCalledTimes(2);
  });

  it('settles accepted authority, cancels pending work and resets backoff', () => {
    const owner = new ProjectRegistryRetryOwner();
    const retry = vi.fn();
    owner.schedule(retry);

    expect(owner.acceptAuthority()).toBe(true);
    expect(owner.pending).toBe(false);
    vi.runAllTimers();
    expect(retry).not.toHaveBeenCalled();

    owner.schedule(retry);
    vi.advanceTimersByTime(PROJECT_REGISTRY_RETRY_DELAYS_MS[0]);
    expect(retry).toHaveBeenCalledOnce();
  });

  it('suspends without leaving hidden background work', () => {
    const owner = new ProjectRegistryRetryOwner();
    const retry = vi.fn();
    owner.schedule(retry);
    owner.suspend();
    vi.runAllTimers();
    expect(retry).not.toHaveBeenCalled();
    expect(owner.pending).toBe(false);
  });
});
