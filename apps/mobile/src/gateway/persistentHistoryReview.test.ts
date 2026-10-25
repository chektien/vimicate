import { describe, expect, it } from 'vitest';
import type { ArchivedHistoryState } from './archivedHistory';
import { parsedHistoryReview, serializedHistoryReview } from './persistentHistoryReview';
import { restoredHistorySelection, restoredPersistedHistorySelection, type SessionHistoryView } from './sessionHistoryView';
import type { WorkspaceMessage } from '../workspace/workspaceTypes';

const generation = {
  sessionId: '00000000-0000-4000-9000-000000000108',
  sessionStartedAtMs: 1_787_878_751_359,
};
const archive: ArchivedHistoryState = {
  identity: {
    sessionKey: 'agent:main:direct:techbrief',
    currentSessionId: generation.sessionId,
    currentSessionStartedAtMs: generation.sessionStartedAtMs,
  },
  familyToken: 'stable-family-token',
  segments: [
    { sessionId: '00000000-0000-4000-a000-000000000148', order: 0, state: 'archived', startedAtMs: 1, endedAtMs: generation.sessionStartedAtMs, endReason: 'reset', sourceRevision: 'archive-revision' },
    { sessionId: generation.sessionId, order: 1, state: 'current', startedAtMs: generation.sessionStartedAtMs, sourceRevision: 'current-revision' },
  ],
  nextArchivedIndex: -1,
  exhausted: true,
};
const view: SessionHistoryView = {
  generation,
  archive,
  cursor: { sessionKey: archive.identity.sessionKey, nextOffset: null, hasMore: false, totalMessages: 0 },
  windowMode: 'older',
  reviewEntryIntent: 'deliberate',
  historyFailure: null,
  historyProblem: '',
};

function message(index: number): WorkspaceMessage {
  return {
    id: `archive-row-${index}`,
    role: index % 2 ? 'assistant' : 'user',
    text: `archived transcript ${index}`,
    sessionKey: archive.identity.sessionKey,
    source: 'history',
    timestamp: new Date(1_700_000_000_000 + index).toISOString(),
  };
}

describe('persistent archived review', () => {
  it('roundtrips the negotiated SQLite family without legacy epoch invention', () => {
    const nativeArchive: ArchivedHistoryState = { ...archive,
      identity: { ...archive.identity, contract: 'sqlite-family-v1' },
      segments: archive.segments!.map(({ startedAtMs: _start, endedAtMs: _end, endReason: _reason, ...segment }) => segment),
    };
    const nativeView = { ...view, generation: { ...generation, historyModel: 'sqlite-display-v1' as const }, archive: nativeArchive };
    const restored = parsedHistoryReview(serializedHistoryReview(nativeView, [message(0)]));
    expect(restored?.view.archive).toEqual(nativeArchive);
    expect(restoredHistorySelection(restored?.view, nativeView.generation, archive, restored?.messages ?? [], []).windowMode).toBe('latest');
  });

  it('restores a generation-bound archived review independently of an empty latest tail', () => {
    const rows = [message(0), message(1)];
    const persisted = parsedHistoryReview(serializedHistoryReview(view, rows));
    expect(persisted).not.toBeNull();

    const restored = restoredPersistedHistorySelection(
      persisted?.view,
      generation,
      { identity: archive.identity, exhausted: false },
      persisted?.messages ?? [],
      [],
    );
    expect(restored).not.toBeNull();
    expect(restored?.windowMode).toBe('older');
    expect(restored?.messages.map((row) => row.id)).toEqual(rows.map((row) => row.id));
    expect(restored?.archive).toEqual(archive);
    expect(restored?.reviewEntryIntent).toBe('fallback');
  });

  it('does not let a delayed persisted review replace a nonempty current SQLite tail', () => {
    const rows = [message(0), message(1)];
    const persisted = parsedHistoryReview(serializedHistoryReview(view, rows));
    const currentTail: WorkspaceMessage[] = [{
      id: 'current-answer', role: 'assistant', text: 'Current email triage.',
      sessionKey: archive.identity.sessionKey, source: 'history',
    }];

    expect(restoredPersistedHistorySelection(
      persisted?.view,
      generation,
      archive,
      persisted?.messages ?? [],
      currentTail,
    )).toBeNull();
  });

  it('retains the cursor-adjacent 400-message edge rather than the 200-message latest preview', () => {
    const rows = Array.from({ length: 450 }, (_, index) => message(index));
    const persisted = parsedHistoryReview(serializedHistoryReview(view, rows));
    expect(persisted?.messages).toHaveLength(400);
    expect(persisted?.messages[0]?.id).toBe('archive-row-0');
    expect(persisted?.messages.at(-1)?.id).toBe('archive-row-399');
  });

  it('fails closed for a different immutable generation', () => {
    const persisted = parsedHistoryReview(serializedHistoryReview(view, [message(0)]));
    const replacement = { sessionId: '00000000-0000-4000-8000-000000000136', sessionStartedAtMs: generation.sessionStartedAtMs + 10 };
    const restored = restoredHistorySelection(
      persisted?.view,
      replacement,
      { identity: { ...archive.identity, currentSessionId: replacement.sessionId, currentSessionStartedAtMs: replacement.sessionStartedAtMs }, exhausted: false },
      persisted?.messages ?? [],
      [],
    );
    expect(restored.windowMode).toBe('latest');
    expect(restored.messages).toEqual([]);
  });

  it('retains an empty retryable older-history failure but rejects malformed state', () => {
    const retryView = { ...view, historyFailure: 'older' as const, historyProblem: 'host temporarily unavailable' };
    expect(parsedHistoryReview(serializedHistoryReview(retryView, []))?.view).toMatchObject({
      windowMode: 'older',
      historyFailure: 'older',
      historyProblem: 'host temporarily unavailable',
    });
    expect(serializedHistoryReview({ ...view, windowMode: 'latest' }, [message(0)])).toBeNull();
    expect(parsedHistoryReview('{"version":1,"messages":[]}')).toBeNull();
  });

  it('retains the negotiated history model and does not reuse a legacy-policy review', () => {
    const sqlite = { ...generation, historyModel: 'sqlite-display-v1' as const };
    const persisted = parsedHistoryReview(serializedHistoryReview({ ...view, generation: sqlite }, [message(0)]));
    expect(persisted?.view.generation).toEqual(sqlite);
    expect(restoredHistorySelection(persisted?.view, generation, archive, persisted?.messages ?? [], []).windowMode).toBe('latest');
    expect(restoredHistorySelection(persisted?.view, sqlite, archive, persisted?.messages ?? [], []).windowMode).toBe('older');
  });
});
