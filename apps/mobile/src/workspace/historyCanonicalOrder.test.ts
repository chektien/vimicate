import { expect, it } from 'vitest';
import { historyDisplayOrder } from './historyDisplayOrder';
import type { WorkspaceMessage } from './workspaceTypes';
const row = (id: string, rawSeq: number, extra: Partial<WorkspaceMessage> = {}): WorkspaceMessage => ({ id, role: 'assistant', text: id, source: 'history', sessionKey: 'route', transcriptSessionId: 'generation', displayPosition: { source: 'sqlite', rawSeq }, ...extra });
const order = (rows: WorkspaceMessage[]) => historyDisplayOrder(rows, () => true);
it('repairs sparse overlapping native rows and keeps equal-record projections and their live attachment', () => {
  const live = { id: 'detail', role: 'tool', text: 'detail', source: 'live', sessionKey: 'route' } as WorkspaceMessage;
  const rows = [row('40', 40), row('80', 80), row('10', 10), row('20a', 20), row('20b', 20), live, row('160', 160)];
  const result = order(rows);
  expect(result.map(row => row.id)).toEqual(['10', '20a', '20b', 'detail', '40', '80', '160']);
  expect(order(result)).toBe(result);
});
it('never sorts across same-source route or concrete-generation boundaries', () => {
  const rows = [row('late', 80), row('other', 1, { transcriptSessionId: 'other' }), row('early', 10), row('foreign', 2, { sessionKey: 'foreign' })];
  expect(order(rows)).toBe(rows);
});
it('a late leading activity cannot lift a later accepted prompt above its earlier chronology witness', () => {
  const prompt = row('prompt', 40, { role: 'user', timestamp: '200', inputAcceptedAtMs: 200 });
  const activity = row('leading', 80, { timestamp: '900', displayPosition: { source: 'sqlite', rawSeq: 80, activity: { afterRawSeq: null, scopeId: 'run', startOrder: 0 } } });
  const result = order([row('prior', 10, { timestamp: '100' }), prompt, row('answer', 60, { timestamp: '300' }), activity]);
  expect(result.map(row => row.id)).toEqual(['leading', 'prior', 'prompt', 'answer']);
});
it('keeps a live detail attached to an accepted prompt when acceptance-time placement is recomputed', () => {
  const prompt = row('accepted', 20, { role: 'user', timestamp: '200', inputAcceptedAtMs: 200 });
  const live: WorkspaceMessage = { id: 'live-detail', role: 'tool', source: 'live', sessionKey: 'route', text: 'live' };
  expect(order([row('prior', 10, { timestamp: '100' }), prompt, live, row('answer', 30, { timestamp: '300' })]).map(row => row.id))
    .toEqual(['prior', 'accepted', 'live-detail', 'answer']);
});
it('accepted chronology never crosses an explicit boundary even when the concrete generation is reused', () => {
  const rows = [row('old', 10, { timestamp: '900' }), { id: 'boundary', role: 'boundary', text: 'boundary' } as WorkspaceMessage,
    row('prompt', 20, { role: 'user', inputAcceptedAtMs: 200, timestamp: '200' }), row('answer', 30, { timestamp: '300' })];
  expect(order(rows).map(row => row.id)).toEqual(['old', 'boundary', 'prompt', 'answer']);
});
it('orders two accepted prompts inside their witnessed interval despite delayed ingress and unrelated late activity', () => {
  const leading = row('leading', 90, { timestamp: '900', displayPosition: { source: 'sqlite', rawSeq: 90, activity: { afterRawSeq: null, scopeId: 'run', startOrder: 0 } } });
  const rows = [row('prior', 10, { timestamp: '100' }), row('answer', 20, { timestamp: '400' }),
    row('first', 40, { role: 'user', timestamp: '200', inputAcceptedAtMs: 200 }),
    row('second', 60, { role: 'user', timestamp: '300', inputAcceptedAtMs: 300 }), row('final', 80, { timestamp: '600' }), leading];
  const expected = ['leading', 'prior', 'first', 'second', 'answer', 'final'];
  expect(order(rows).map(row => row.id)).toEqual(expected);
  expect(order(order(rows)).map(row => row.id)).toEqual(expected);
});
