import { describe, expect, it } from 'vitest';
import { SessionTranscriptFoldCache } from './sessionTranscriptFoldCache';

describe('session transcript fold cache', () => {
  it('evicts the least-recently-used dataset beyond its session bound', () => {
    const cache = new SessionTranscriptFoldCache(2, 4);
    cache.setExpanded('one', 'message-one', true);
    cache.setExpanded('two', 'message-two', true);
    cache.expanded('one');
    cache.setExpanded('three', 'message-three', true);

    expect(cache.expanded('one')).toEqual(new Set(['message-one']));
    expect(cache.expanded('two')).toEqual(new Set());
    expect(cache.expanded('three')).toEqual(new Set(['message-three']));
  });

  it('retains only the newest expanded identities inside one dataset', () => {
    const cache = new SessionTranscriptFoldCache(2, 3);
    for (let index = 0; index < 4; index += 1) cache.setExpanded('one', `message-${index}`, true);

    expect(cache.expanded('one')).toEqual(new Set(['message-1', 'message-2', 'message-3']));
  });

  it('releases an empty dataset slot and reports no-op updates', () => {
    const cache = new SessionTranscriptFoldCache(1, 2);
    expect(cache.setExpanded('one', 'message', true)).toBe(true);
    expect(cache.setExpanded('one', 'message', true)).toBe(false);
    expect(cache.setExpanded('one', 'message', false)).toBe(true);
    expect(cache.expanded('one')).toEqual(new Set());
  });
});
