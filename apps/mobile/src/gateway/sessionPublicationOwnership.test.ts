import { describe, expect, it } from 'vitest';
import { sessionOwnsDetailPublication, sessionOwnsVisiblePublication } from './sessionPublicationOwnership';

describe('visible live-publication identity wall', () => {
  it('admits a row only while selection and mounted history have the same session owner', () => {
    expect(sessionOwnsVisiblePublication('thread-a', 'thread-a', 'thread-a')).toBe(true);
    expect(sessionOwnsVisiblePublication('thread-a', 'thread-b', 'thread-b')).toBe(false);
    expect(sessionOwnsVisiblePublication('thread-a', 'thread-a', 'thread-b')).toBe(false);
    expect(sessionOwnsVisiblePublication('', 'thread-a', 'thread-a')).toBe(false);
  });

  it('rejects delayed operation detail after the originating session loses selection', () => {
    expect(sessionOwnsDetailPublication('thread-a', 'thread-a')).toBe(true);
    expect(sessionOwnsDetailPublication('thread-a', 'thread-b')).toBe(false);
    expect(sessionOwnsDetailPublication('', 'thread-a')).toBe(false);
  });
});
