import { expect, it } from 'vitest';
import { upsertLiveMessage } from './gatewayEventProjection';
import { mergeSharedNarration } from './sharedNarration';
import { mergeLatestHistory } from './historyPagination';
import type { WorkspaceMessage } from '../workspace/workspaceTypes';
const sessionKey = 'one';
const native = (id: string, timestamp: string, seq: number, role: WorkspaceMessage['role'] = 'assistant'): WorkspaceMessage => ({
  id, text: id, timestamp, role, source: 'history', sessionKey, transcriptSessionId: 'generation',
  displayPosition: { source: 'sqlite', rawSeq: seq },
});
const page = [
  { ...native('prompt', '1789194400000', 12920, 'user'), runId: 'run' },
  { ...native('working', '1789194490454', 12936, 'narration'), runId: 'run' },
  native('question', '1789194494075', 12937),
  native('useful', '1789194571947', 12942),
];
const caught: WorkspaceMessage = { id: 'live-item-run-caught', text: 'caught', role: 'narration', source: 'live', sessionKey, runId: 'run', timestamp: '1789194668458', state: 'streaming' };
const order = (rows: WorkspaceMessage[]) => rows.map(row => row.text);
it('keeps newer timed commentary after flushed assistants, on arrival and partial history refresh', () => {
  let current = upsertLiveMessage(page, caught);
  expect(order(current)).toEqual(['prompt', 'working', 'question', 'useful', 'caught']);
  for (let pass = 0; pass < 3; pass++) {
    current = mergeLatestHistory(page, current, sessionKey);
    expect(order(current)).toEqual(['prompt', 'working', 'question', 'useful', 'caught']);
  }
});
it('repairs a misplaced live commentary before shared hydration supplies its generation', () => {
  const current = [page[0]!, caught, ...page.slice(1)];
  expect(order(mergeLatestHistory(page, current, sessionKey))).toEqual(['prompt', 'working', 'question', 'useful', 'caught']);
});

it('keeps delayed commentary between host-timed rows and before an untimed completion', () => {
  const delayed = { ...caught, timestamp: '1789194530000' };
  expect(order(upsertLiveMessage(page, delayed))).toEqual(['prompt', 'working', 'question', 'caught', 'useful']);
  const footer: WorkspaceMessage = { id: 'done', text: 'done', role: 'run', source: 'live', sessionKey, runId: 'run', state: 'complete' };
  expect(order(upsertLiveMessage([...page, footer], caught))).toEqual(['prompt', 'working', 'question', 'useful', 'caught', 'done']);
});
it('does not cross a later optimistic steering prompt whose client clock is ahead', () => {
  const steer: WorkspaceMessage = { id: 'steer', text: 'steer', role: 'user', source: 'local', sessionKey, runId: 'run', timestamp: '1789194999999' };
  expect(order(upsertLiveMessage([...page, steer], caught))).toEqual(['prompt', 'working', 'question', 'useful', 'steer', 'caught']);
});

it('keeps the publication key and order through shared hydration and native canonical catch-up', () => {
  const shared = { ...caught, source: 'history' as const, transcriptSessionId: 'generation', narrationItemId: 'caught' };
  let rows = mergeSharedNarration(upsertLiveMessage(page, caught), [shared]);
  const canonical = { ...shared, id: 'native-caught', displayPosition: { source: 'sqlite', rawSeq: 12957 } };
  for (let pass = 0; pass < 3; pass++) {
    rows = mergeSharedNarration(mergeLatestHistory([...page, canonical], rows, sessionKey), [shared]);
    expect(order(rows)).toEqual(['prompt', 'working', 'question', 'useful', 'caught']);
    expect(rows.at(-1)?.id).toBe(caught.id);
  }
});
