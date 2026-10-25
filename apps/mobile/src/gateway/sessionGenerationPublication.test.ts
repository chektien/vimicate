import { describe, expect, it } from 'vitest';
import type { WorkspaceMessage } from '../workspace/workspaceTypes';
import { generationReboundPublication, generationReboundVisiblePublication, messagesOwnedBySessionGeneration, sessionGenerationChanged } from './sessionGenerationPublication';

describe('session-generation transcript publication', () => {
  it('detects an immutable generation change independently of archive availability', () => {
    const previous = { sessionId: '00000000-0000-4000-9000-000000000135', sessionStartedAtMs: 1_787_784_000_000 };
    const next = { sessionId: '00000000-0000-4000-a000-000000000127', sessionStartedAtMs: 1_787_801_879_597 };
    expect(sessionGenerationChanged(previous, next)).toBe(true);
    expect(sessionGenerationChanged(next, { ...next })).toBe(false);
  });

  it('treats first immutable authority for an already-mounted stable route as a rebound', () => {
    const next = {
      sessionId: '00000000-0000-4000-a000-000000000127',
      sessionStartedAtMs: 1_787_801_879_597,
    };

    // A selected route can initially be projected without immutable session
    // metadata, then receive it on the next registry refresh. The stable-key
    // cache mounted before that refresh is not evidence of generation
    // ownership, so first authority must cross the same purge/reload boundary
    // as an ordinary `/new` generation change.
    expect(sessionGenerationChanged(null, next)).toBe(true);
  });

  it('does not append a prior generation live answer below the replacement generation', () => {
    const rows: WorkspaceMessage[] = [
      {
        id: 'morning-brief', role: 'assistant', source: 'live',
        text: 'Morning Brief — Thu 27 Aug 2026', timestamp: '2026-08-27T00:06:15.132Z',
      },
      {
        id: 'updated-standup', role: 'assistant', source: 'history',
        text: 'Updated standup.md', timestamp: '2026-08-27T03:40:45.195Z',
      },
    ];

    expect(messagesOwnedBySessionGeneration(rows, {
      sessionId: '00000000-0000-4000-a000-000000000127',
      sessionStartedAtMs: Date.parse('2026-08-27T03:37:59.597Z'),
    }).map((message) => message.id)).toEqual(['updated-standup']);
  });

  it('retains a newly accepted optimistic prompt but rejects ownerless stale live detail', () => {
    const start = 1_787_801_879_597;
    const rows: WorkspaceMessage[] = [
      { id: 'stale', role: 'assistant', source: 'live', text: 'old answer' },
      { id: 'prompt', role: 'user', source: 'local', text: 'new request', timestamp: String(start + 1) },
    ];
    expect(messagesOwnedBySessionGeneration(rows, {
      sessionId: '00000000-0000-4000-a000-000000000127', sessionStartedAtMs: start,
    }).map((message) => message.id)).toEqual(['prompt']);
  });

  it('retains the timestamped new-conversation boundary through generation rebound', () => {
    const start = 1_787_801_879_597;
    const rows: WorkspaceMessage[] = [
      { id: 'old-answer', role: 'assistant', source: 'history', text: 'old answer', timestamp: String(start - 1) },
      { id: 'new-boundary', role: 'boundary', source: 'live', state: 'complete', text: '──────  new conversation  ──────', timestamp: String(start + 1) },
    ];

    expect(messagesOwnedBySessionGeneration(rows, {
      sessionId: 'replacement', sessionStartedAtMs: start,
    }).map((message) => message.id)).toEqual(['new-boundary']);
  });

  it('does not discard cache rows when immutable generation authority is unavailable', () => {
    const rows: WorkspaceMessage[] = [{ id: 'offline', role: 'assistant', text: 'offline' }];
    expect(messagesOwnedBySessionGeneration(rows, null)).toBe(rows);
  });

  it('keeps a mounted older-review dataset stable when foreground reconnect discovers /new', () => {
    const generation = {
      sessionId: 'replacement',
      sessionStartedAtMs: Date.parse('2026-08-27T03:37:59.597Z'),
    };
    const review: WorkspaceMessage[] = [
      { id: 'archived-prompt', role: 'user', text: 'older request', timestamp: '2026-08-26T12:00:00.000Z' },
      { id: 'archived-answer', role: 'assistant', text: 'older answer', timestamp: '2026-08-26T12:01:00.000Z' },
    ];
    const tail: WorkspaceMessage[] = [
      { id: 'stale-live-answer', role: 'assistant', source: 'live', text: 'previous generation', timestamp: '2026-08-27T00:06:15.132Z' },
      { id: 'replacement-prompt', role: 'user', source: 'local', text: 'current generation', timestamp: '2026-08-27T03:40:45.195Z' },
    ];

    const publication = generationReboundPublication('older', review, tail, generation);
    expect(publication.visible).toBe(review);
    expect(publication.visible.map((message) => message.id)).toEqual(['archived-prompt', 'archived-answer']);
    expect(publication.latest.map((message) => message.id)).toEqual(['replacement-prompt']);
  });

  it('filters both mounted and latest state when the reader still owns the live tail', () => {
    const generation = {
      sessionId: 'replacement',
      sessionStartedAtMs: Date.parse('2026-08-27T03:37:59.597Z'),
    };
    const rows: WorkspaceMessage[] = [
      { id: 'old', role: 'assistant', text: 'old', timestamp: '2026-08-27T00:06:15.132Z' },
      { id: 'new', role: 'assistant', text: 'new', timestamp: '2026-08-27T03:40:45.195Z' },
    ];

    const publication = generationReboundPublication('latest', rows, rows, generation);
    expect(publication.visible.map((message) => message.id)).toEqual(['new']);
    expect(publication.latest.map((message) => message.id)).toEqual(['new']);
  });

  it('cannot apply a queued generation rebound from one thread to the newly selected thread', () => {
    const generation = {
      sessionId: 'replacement-a',
      sessionStartedAtMs: Date.parse('2026-08-29T10:00:00.000Z'),
    };
    const threadB: WorkspaceMessage[] = [
      {
        id: 'thread-b-answer', role: 'assistant', text: 'B remains visible',
        source: 'history', sessionKey: 'thread-b', timestamp: '2026-08-29T09:00:00.000Z',
      },
    ];

    const published = generationReboundVisiblePublication(
      'thread-a',
      'thread-b',
      'thread-b',
      generation,
      generation,
      'latest',
      threadB,
      [],
    );

    expect(published).toBe(threadB);
    expect(published.map((message) => message.id)).toEqual(['thread-b-answer']);
  });

  it('cannot apply an older queued generation after the same route rebounds again', () => {
    const olderGeneration = { sessionId: 'replacement-a1', sessionStartedAtMs: 1_000 };
    const activeGeneration = { sessionId: 'replacement-a2', sessionStartedAtMs: 2_000 };
    const current: WorkspaceMessage[] = [
      { id: 'a2-answer', role: 'assistant', text: 'newest generation', source: 'history', sessionKey: 'thread-a', timestamp: '2001' },
    ];

    expect(generationReboundVisiblePublication(
      'thread-a', 'thread-a', 'thread-a',
      olderGeneration, activeGeneration,
      'latest', current, [],
    )).toBe(current);
  });

  it('filters the mounted rows when the exact selected route and generation still own the update', () => {
    const start = 1_800_000_000_000;
    const generation = { sessionId: 'replacement-a', sessionStartedAtMs: start };
    const current: WorkspaceMessage[] = [
      { id: 'a1-answer', role: 'assistant', text: 'old generation', source: 'history', sessionKey: 'thread-a', timestamp: String(start - 1) },
      { id: 'a2-answer', role: 'assistant', text: 'new generation', source: 'history', sessionKey: 'thread-a', timestamp: String(start + 1) },
    ];

    expect(generationReboundVisiblePublication(
      'thread-a', 'thread-a', 'thread-a',
      generation, generation,
      'latest', current, current,
    ).map((message) => message.id)).toEqual(['a2-answer']);
  });
});
