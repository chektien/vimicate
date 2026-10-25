import { describe, expect, it } from 'vitest';
import { persistedTranscriptRestorePublication, SessionHistoryCache, shouldResetHistoryForSelection } from './sessionHistoryCache';

describe('session history ownership', () => {
  it('restores each project transcript independently', () => {
    const cache = new SessionHistoryCache();
    const one = [{ id: 'one', role: 'assistant' as const, text: 'one' }];
    const two = [{ id: 'two', role: 'assistant' as const, text: 'two' }];
    cache.store('one', one); cache.store('two', two);
    expect(cache.restore('one')).toBe(one);
    expect(cache.restore('two')).toBe(two);
  });

  it('evicts the least recently used transcript after the bounded session lifetime', () => {
    const cache = new SessionHistoryCache(2);
    const one = [{ id: 'one', role: 'assistant' as const, text: 'one' }];
    const two = [{ id: 'two', role: 'assistant' as const, text: 'two' }];
    const three = [{ id: 'three', role: 'assistant' as const, text: 'three' }];

    cache.store('one', one);
    cache.store('two', two);
    expect(cache.restore('one')).toBe(one);
    cache.store('three', three);

    expect(cache.restore('one')).toBe(one);
    expect(cache.restore('two')).toBeUndefined();
    expect(cache.restore('three')).toBe(three);
  });

  it('bounds the default process-local transcript lifetime to 64 sessions', () => {
    const cache = new SessionHistoryCache();
    for (let index = 0; index < 1_000; index += 1) {
      cache.store(`session-${index}`, [{ id: `row-${index}`, role: 'assistant', text: `row ${index}` }]);
    }

    expect(cache.restore('session-935')).toBeUndefined();
    expect(cache.restore('session-936')?.[0]?.id).toBe('row-936');
    expect(cache.restore('session-999')?.[0]?.id).toBe('row-999');
  });

  it('never clears history when the active project is merely activated again', () => {
    expect(shouldResetHistoryForSelection('one', 'one')).toBe(false);
    expect(shouldResetHistoryForSelection('one', 'two')).toBe(true);
  });

  it('lets the selected persisted transcript replace stale startup rows from the previous session', () => {
    const previousStartup = [{ id: 'startup-1', role: 'system' as const, text: 'MVP terminal chat ready.' }];
    const persisted = [{ id: 'r3cap-history', role: 'assistant' as const, text: 'Restored R3CAP history', source: 'history' as const }];

    expect(persistedTranscriptRestorePublication(previousStartup, [], persisted)).toEqual({
      publish: true,
      messages: persisted,
    });
  });

  it('never lets a delayed persisted read overwrite a newer selected-session tail', () => {
    const live = [{ id: 'live-r3cap', role: 'assistant' as const, text: 'New live answer', source: 'live' as const }];
    const stalePersisted = [{ id: 'old-r3cap', role: 'assistant' as const, text: 'Older persisted answer', source: 'history' as const }];

    expect(persistedTranscriptRestorePublication(live, live, stalePersisted)).toEqual({
      publish: false,
      messages: live,
    });
  });
});

it.each(['chatCumulativeText', 'claudeNativeFullText', 'terminalReplyText'] as const)(
  'retains newer %s authority when the displayed answer is unchanged', (field) => {
    const cache = new SessionHistoryCache();
    const before = { id: field === 'terminalReplyText' ? 'live-run-r' : 'live-chat-r',
      role: field === 'terminalReplyText' ? 'run' as const : 'assistant' as const,
      source: 'live' as const, state: 'complete' as const, sessionKey: 's', runId: 'r', text: 'answer',
      [field]: field === 'terminalReplyText' ? 'first answer' : 'first\n\nanswer' };
    const after = { ...before, [field]: field === 'terminalReplyText' ? 'second answer' : 'second\n\nanswer' };
    cache.store('s', [before]);
    cache.store('s', [after]);
    expect(cache.restore('s')?.[0]?.[field]).toBe(after[field]);
    const unchanged = cache.restore('s');
    cache.store('s', [{ ...after }]);
    expect(cache.restore('s')).toBe(unchanged);
  },
);
