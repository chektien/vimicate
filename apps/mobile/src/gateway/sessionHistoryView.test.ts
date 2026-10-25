import { describe, expect, it } from 'vitest';
import type { WorkspaceMessage } from '../workspace/workspaceTypes';
import type { ArchivedHistoryState } from './archivedHistory';
import type { HistoryCursor } from './historyPagination';
import {
  SessionHistoryViewCache,
  returnToLatestHistory,
  restoredHistorySelection,
  threadEntryHistoryPresentation,
  type SessionHistoryView,
} from './sessionHistoryView';

const generation = {
  sessionId: '00000000-0000-4000-9000-000000000108',
  sessionStartedAtMs: 1_787_878_751_359,
};
const archive: ArchivedHistoryState = {
  identity: {
    sessionKey: 'techbrief',
    currentSessionId: generation.sessionId,
    currentSessionStartedAtMs: generation.sessionStartedAtMs,
  },
  familyToken: 'family-token',
  segments: [
    { sessionId: '00000000-0000-4000-a000-000000000148', order: 0, state: 'archived', startedAtMs: 1, endedAtMs: generation.sessionStartedAtMs, endReason: 'reset', sourceRevision: 'source' },
    { sessionId: generation.sessionId, order: 1, state: 'current', startedAtMs: generation.sessionStartedAtMs, sourceRevision: 'current' },
  ],
  nextArchivedIndex: -1,
  exhausted: true,
};
const cursor: HistoryCursor = { sessionKey: 'techbrief', nextOffset: null, hasMore: false, totalMessages: 0 };
const review: WorkspaceMessage[] = [
  { id: 'archived-prompt', role: 'user', text: 'Review the SOG brief', source: 'history', sessionKey: 'techbrief' },
  { id: 'archived-answer', role: 'assistant', text: 'The brief is ready.', source: 'history', sessionKey: 'techbrief' },
];

function reviewView(overrides: Partial<SessionHistoryView> = {}): SessionHistoryView {
  return {
    generation,
    archive,
    cursor,
    windowMode: 'older',
    reviewEntryIntent: 'deliberate',
    historyFailure: null,
    historyProblem: '',
    ...overrides,
  };
}

describe('per-session history review ownership', () => {
  it('evicts the least recently used review after the bounded session lifetime', () => {
    const cache = new SessionHistoryViewCache(2);
    const one = reviewView({ historyProblem: 'one' });
    const two = reviewView({ historyProblem: 'two' });
    const three = reviewView({ historyProblem: 'three' });

    cache.store('one', one);
    cache.store('two', two);
    expect(cache.restore('one')).toBe(one);
    cache.store('three', three);

    expect(cache.restore('one')).toBe(one);
    expect(cache.restore('two')).toBeUndefined();
    expect(cache.restore('three')).toBe(three);
  });

  it('restores a loaded archived review instead of an empty latest generation after a project round trip', () => {
    const cache = new SessionHistoryViewCache();
    cache.store('techbrief', reviewView());

    const restored = restoredHistorySelection(
      cache.restore('techbrief'),
      generation,
      archive,
      review,
      [],
    );

    expect(restored.windowMode).toBe('older');
    expect(restored.messages).toEqual(review);
    expect(restored.archive).toBe(archive);
    expect(restored.cursor).toBe(cursor);
    expect(restored.canLoadOlder).toBe(false);
    expect(threadEntryHistoryPresentation(restored)).toBe('preserve-review');
  });

  it('preserves an intentional review across re-entry while keeping a nonempty current tail hidden', () => {
    const current: WorkspaceMessage[] = [
      { id: 'current-answer', role: 'assistant', text: 'Current answer', source: 'history', sessionKey: 'techbrief' },
    ];
    const restored = restoredHistorySelection(reviewView(), generation, archive, review, current);

    expect(restored.messages).toEqual(review);
    expect(restored.windowMode).toBe('older');
    expect(threadEntryHistoryPresentation(restored)).toBe('preserve-review');
  });

  it('reveals a current tail when the older window was restored only as an automatic fallback', () => {
    const current: WorkspaceMessage[] = [
      { id: 'current-email', role: 'assistant', text: 'Current email triage', source: 'history', sessionKey: 'techbrief' },
    ];
    const fallback = {
      ...reviewView(),
      reviewEntryIntent: 'fallback' as const,
    };
    const restored = restoredHistorySelection(fallback, generation, archive, review, current);

    expect(restored.messages).toEqual(review);
    expect(restored.windowMode).toBe('older');
    expect(threadEntryHistoryPresentation(restored)).toBe('reveal-current');
  });

  it('reveals a nonempty current tail on first entry when no in-process review exists', () => {
    const current: WorkspaceMessage[] = [
      { id: 'current-answer', role: 'assistant', text: 'Current answer', source: 'history', sessionKey: 'techbrief' },
    ];
    const restored = restoredHistorySelection(undefined, generation, archive, [], current);

    expect(restored.messages).toEqual(current);
    expect(restored.windowMode).toBe('latest');
    expect(threadEntryHistoryPresentation(restored)).toBe('reveal-current');
  });

  it('retains a retryable history failure and its recovery affordance across project switches', () => {
    const problem = 'archived family temporarily unavailable';
    const restored = restoredHistorySelection(
      reviewView({ historyFailure: 'older', historyProblem: problem, archive: { ...archive, blocked: problem } }),
      generation,
      archive,
      review,
      [],
    );

    expect(restored.historyFailure).toBe('older');
    expect(restored.historyProblem).toBe(problem);
    expect(restored.messages).toEqual(review);
  });

  it('invalidates a cached review when the immutable session generation changes', () => {
    const replacement = { sessionId: '00000000-0000-4000-8000-000000000136', sessionStartedAtMs: generation.sessionStartedAtMs + 10 };
    const replacementArchive: ArchivedHistoryState = {
      identity: { sessionKey: 'techbrief', currentSessionId: replacement.sessionId, currentSessionStartedAtMs: replacement.sessionStartedAtMs },
      exhausted: false,
    };
    const restored = restoredHistorySelection(reviewView(), replacement, replacementArchive, review, []);

    expect(restored.windowMode).toBe('latest');
    expect(restored.messages).toEqual([]);
    expect(restored.archive).toBe(replacementArchive);
    expect(threadEntryHistoryPresentation(restored)).toBe('reveal-current');
  });

  it('does not let bare G replace the only loaded archived transcript with an empty current generation', () => {
    expect(returnToLatestHistory('older', [], review)).toEqual({ windowMode: 'older', messages: review });
    expect(returnToLatestHistory('older', [review[1]!], review)).toEqual({ windowMode: 'latest', messages: [review[1]!] });
  });
});
