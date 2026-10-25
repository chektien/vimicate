import { describe, expect, it } from 'vitest';
import { BoundedSessionCache } from './boundedSessionCache';

describe('bounded session cache', () => {
  it('can retire a stale per-session value when the current owner has no value', () => {
    const cache = new BoundedSessionCache<number>();
    cache.store('session-a', 0.45);

    expect(cache.delete('session-a')).toBe(true);
    expect(cache.restore('session-a')).toBeUndefined();
    expect(cache.delete('')).toBe(false);
  });
});
