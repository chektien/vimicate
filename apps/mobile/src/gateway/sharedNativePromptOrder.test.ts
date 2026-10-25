import { expect, it } from 'vitest';
import { mergeSharedNarration } from './sharedNarration';
import { mergeLatestHistory } from './historyPagination';
import { latestHistoryRefreshAction } from './historyReviewPublication';
import { parsedTranscriptCache, serializedTranscriptCache } from './persistentTranscriptCache';
import type { WorkspaceMessage } from '../workspace/workspaceTypes';

const sessionKey = 'one';
const generation = '00000000-0000-4000-8000-000000000117';
const prior: WorkspaceMessage = { id: 'prior', role: 'assistant', text: 'prior answer', source: 'history',
  sessionKey, transcriptSessionId: generation, timestamp: '1788856809468', displayPosition: { source: 'sqlite', rawSeq: 8591 } };
const prompt: WorkspaceMessage = { id: 'prompt', role: 'user', text: 'main request', source: 'local',
  sessionKey, runId: 'run', idempotencyKey: 'run:user', timestamp: '1788856948407' };
const steer: WorkspaceMessage = { ...prompt, id: 'steer', text: 'follow-up', idempotencyKey: 'steer:user', timestamp: '1788856956396' };
const first: WorkspaceMessage = { id: 'live-item-run-first', role: 'narration', text: 'first commentary', source: 'history',
  sessionKey, transcriptSessionId: generation, runId: 'run', narrationItemId: 'first', timestamp: '1788856954255' };
const second: WorkspaceMessage = { ...first, id: 'live-item-run-second', text: 'second commentary', narrationItemId: 'second', timestamp: '1788856963631' };
const ids = (rows: WorkspaceMessage[]) => rows.map(row => row.id);
const expected = ['prior', 'prompt', first.id, 'steer', second.id];

it('keeps the mounted latest-history publication ordered when narration beats prompt persistence', () => {
  let current = [prior, prompt, steer];
  const projected = mergeSharedNarration([prior], [first, second]);
  const publish = latestHistoryRefreshAction(projected, sessionKey, () => current);
  for (let refresh = 0; refresh < 3; refresh += 1) {
    current = publish(current);
    expect(ids(current.filter(row => row.role !== 'run'))).toEqual(expected);
  }
});

it('interleaves hydrated commentary with optimistic prompts after a native SQLite tail', () => {
  // Exact source timestamps from the reported Codex turn, with synthetic text.
  // History still ends at the preceding answer while narration hydration wins.
  const rows = mergeSharedNarration([prior, prompt, steer], [first, second]);
  expect(ids(rows)).toEqual(expected);
  expect(rows.filter(row => row.source === 'local').every(row => !row.displayPosition && !row.transcriptSessionId)).toBe(true);
  expect(ids(mergeSharedNarration(rows, [first, second]))).toEqual(expected);
});

it('repairs an already misplaced cache and remains ordered as prompts become canonical', () => {
  let rows = parsedTranscriptCache(serializedTranscriptCache([prior, first, second, prompt, steer]));
  rows = mergeSharedNarration(rows, [first, second]);
  expect(ids(rows)).toEqual(expected);
  const nativePrompt: WorkspaceMessage = { ...prompt, source: 'history', transcriptSessionId: generation,
    displayPosition: { source: 'sqlite', rawSeq: 8592 } };
  rows = mergeSharedNarration(mergeLatestHistory([prior, nativePrompt], rows, sessionKey), [first, second]);
  expect(ids(rows)).toEqual(expected);
  const nativeSteer: WorkspaceMessage = { ...steer, source: 'history', transcriptSessionId: generation,
    displayPosition: { source: 'sqlite', rawSeq: 8596 } };
  rows = mergeSharedNarration(mergeLatestHistory([prior, nativePrompt, nativeSteer], rows, sessionKey), [first, second]);
  expect(ids(rows)).toEqual(expected);
});

it('does not use a foreign prompt or one beyond a generation boundary as a narration anchor', () => {
  for (const suffix of [
    [{ ...prompt, sessionKey: 'other' }],
    [{ ...prior, id: 'other-generation', transcriptSessionId: 'other', displayPosition: { source: 'other', rawSeq: 1 } }, prompt],
    [{ id: 'boundary', role: 'boundary' as const, text: 'new generation' }, prompt],
  ]) {
    const rows = mergeSharedNarration([prior, ...suffix], [first]);
    expect(ids(rows).indexOf(first.id)).toBe(1);
  }
});
