import { describe, expect, it } from 'vitest';
import { newConversationTailMessageID, SessionTranscriptNavigationCache } from './sessionTranscriptNavigation';
import { createTranscriptBuffer, createTranscriptVimState } from './transcriptVim';
import type { WorkspaceMessage } from '../workspace/workspaceTypes';

function message(id: string, text: string): WorkspaceMessage {
  return { id, role: 'assistant', source: 'history', text };
}

function boundary(id: string): WorkspaceMessage {
  return { id, role: 'boundary', source: 'live', text: '──────  new conversation  ──────' };
}

describe('session transcript navigation cache', () => {
  it('restores the same review-owned source line after an active session advances while parked', () => {
    const cache = new SessionTranscriptNavigationCache();
    const before = createTranscriptBuffer([
      message('older-a', 'one\ntwo\nthree'),
      message('older-b', 'four\nfive'),
    ]);
    const review = {
      ...createTranscriptVimState(before),
      cursor: { row: 1, column: 1 },
      desiredColumn: 1,
      followTail: false,
    };
    cache.store('running-thread', before, review);

    const after = createTranscriptBuffer([
      message('newly-loaded', 'zero'),
      message('older-a', 'one\ntwo\nthree'),
      message('older-b', 'four\nfive'),
      message('live-tail', 'still running'),
    ]);
    const restored = cache.restore('running-thread', after);

    expect(restored?.followTail).toBe(false);
    expect(after.lines[restored!.cursor.row]).toMatchObject({ messageId: 'older-a', lineInMessage: 1, text: 'two' });
    expect(restored?.cursor.column).toBe(1);
  });

  it('never lets another session inherit the parked cursor', () => {
    const cache = new SessionTranscriptNavigationCache();
    const source = createTranscriptBuffer([message('source', 'one\ntwo')]);
    cache.store('source-session', source, {
      ...createTranscriptVimState(source),
      cursor: { row: 0, column: 0 },
      followTail: false,
    });

    expect(cache.restore('other-session', createTranscriptBuffer([message('other', 'different')]))).toBeUndefined();
  });

  it('bounds parked session state independently from transcript storage', () => {
    const cache = new SessionTranscriptNavigationCache(2);
    for (const key of ['a', 'b', 'c']) {
      const buffer = createTranscriptBuffer([message(key, key)]);
      cache.store(key, buffer, createTranscriptVimState(buffer));
    }
    expect(cache.restore('a', createTranscriptBuffer([message('a', 'a')]))).toBeUndefined();
    expect(cache.restore('b', createTranscriptBuffer([message('b', 'b')]))).toBeDefined();
    expect(cache.restore('c', createTranscriptBuffer([message('c', 'c')]))).toBeDefined();
  });

  it('retains tail ownership when a new-conversation boundary is the final selected row', () => {
    const cache = new SessionTranscriptNavigationCache();
    const buffer = createTranscriptBuffer([
      message('answer', 'complete'),
      boundary('reset'),
    ]);
    cache.store('reset-thread', buffer, {
      ...createTranscriptVimState(buffer),
      followTail: false,
    });

    const restored = cache.restore('reset-thread', buffer);

    expect(restored?.followTail).toBe(true);
    expect(restored?.cursor.row).toBe(buffer.lines.length - 1);
  });

  it('distinguishes a durable new-conversation tail from compaction', () => {
    expect(newConversationTailMessageID(createTranscriptBuffer([
      message('answer', 'complete'),
      boundary('reset-generation'),
    ]))).toBe('reset-generation');
    expect(newConversationTailMessageID(createTranscriptBuffer([{
      id: 'compaction', role: 'boundary', source: 'history', text: '--- compaction ---',
    }]))).toBe('');
  });

  it('does not reclaim a deliberately parked ordinary final row', () => {
    const cache = new SessionTranscriptNavigationCache();
    const buffer = createTranscriptBuffer([message('answer', 'one\ntwo')]);
    cache.store('review-thread', buffer, {
      ...createTranscriptVimState(buffer),
      followTail: false,
    });

    expect(cache.restore('review-thread', buffer)?.followTail).toBe(false);
  });
});
