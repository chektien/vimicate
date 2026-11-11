import { expect, it, vi } from 'vitest';
import { recordHistoryTransport, reconcileHistoryCursor } from './historyTransport';
import { loadVisibleOlderHistoryBatch } from './loadVisibleOlderHistoryBatch';
import type { WorkspaceMessage } from '../workspace/workspaceTypes';
import type { OpenClawClient } from './OpenClawClient';
const key = 'route';
const generation = '00000000-0000-4000-8000-000000000117';
const row = (id: string, rawSeq: number): WorkspaceMessage => ({ id, role: 'assistant', text: id, sessionKey: key, source: 'history', transcriptSessionId: generation, displayPosition: { source: 'sqlite', rawSeq } });
const cursor = { sessionKey: key, nextOffset: 7, hasMore: true, totalMessages: 1000 };
it('replays the canonical containing page when a sparse grouped window cuts through its membership', () => {
  const page = [row('a', 10), row('b', 100), row('projection-a', 900), row('projection-b', 900)];
  const recorded = recordHistoryTransport(cursor, 0, page, { sessionKey: key, sessionId: generation });
  const next = reconcileHistoryCursor(recorded, page.slice(1), key)!;
  expect(next.nextOffset).toBe(0);
  expect(next.transport?.scan?.revalidate).toBe(true);
  // The raw display coordinate 100 is not the offset and numeric gaps are legal.
  expect(reconcileHistoryCursor(recorded, page, key)?.nextOffset).toBe(7);
});
it('an uncached edge offers bounded witness revalidation instead of silently disabling older history', () => {
  const next = reconcileHistoryCursor(null, [row('restored', 900)], key)!;
  expect(next.hasMore).toBe(true); expect(next.nextOffset).toBe(0);
  expect(next.transport?.boundary).toBe('message\0restored');
});
it('rejects a foreign generation and never consumes its cursor', async () => {
  const visible = [row('edge', 100)];
  const recorded = recordHistoryTransport(cursor, 0, visible, { sessionKey: key, sessionId: generation });
  const history = vi.fn(async () => ({ sessionKey: key, sessionId: 'foreign', totalMessages: 1000,
    hasMore: true, nextOffset: 9, messages: [{ id: 'foreign', role: 'user', content: 'wrong' }] }));
  const result = await loadVisibleOlderHistoryBatch({ client: { history, decorateMessages: (rows: WorkspaceMessage[]) => rows } as unknown as OpenClawClient,
    sessionKey: key, path: '', visible, narration: [], cursor: recorded, archive: null, context: {}, owns: () => true });
  expect(result.older).toEqual([]); expect(result.cursor?.nextOffset).toBe(0);
  expect(result.problem).toMatchObject({ message: 'History concrete generation changed.' });
});
it('a changing total rebases to bounded canonical revalidation and then reaches older history without G', async () => {
  const visible = [row('edge', 100)];
  const recorded = recordHistoryTransport(cursor, 0, visible, { sessionKey: key, sessionId: generation });
  const history = vi.fn(async (_key: string, _limit: number, offset: number) => offset === 7
    ? { sessionKey: key, sessionId: generation, totalMessages: 1005, hasMore: true, nextOffset: 10, messages: [{ id: 'unwitnessed', role: 'user', content: 'unmounted' }] }
    : { sessionKey: key, sessionId: generation, totalMessages: 1005, hasMore: false, nextOffset: null,
      messages: [{ id: 'older', role: 'user', content: 'older' }, { id: 'edge', role: 'assistant', content: 'edge' }, { id: 'newer', role: 'assistant', content: 'not admitted' }] });
  const base = { client: { history, decorateMessages: (rows: WorkspaceMessage[]) => rows } as unknown as OpenClawClient,
    sessionKey: key, path: '', visible, narration: [], archive: null, context: {}, owns: () => true };
  const failed = await loadVisibleOlderHistoryBatch({ ...base, cursor: recorded });
  expect(failed.older).toEqual([]); expect(failed.cursor?.nextOffset).toBe(0);
  expect(failed.cursor?.transport?.scan?.revalidate).toBe(true);
  const retry = await loadVisibleOlderHistoryBatch({ ...base, cursor: failed.cursor });
  expect(retry.older.map(row => row.id)).toEqual(['older']);
  expect(retry.problem).toBeUndefined(); expect(history.mock.calls.map(call => call[2])).toEqual([7, 0]);
});
it('revalidation scans a corrupt overlap without publishing disjoint rows before a later failure', async () => {
  const visible = [row('edge', 100)];
  const recorded = reconcileHistoryCursor(null, visible, key)!;
  const history = vi.fn(async (_key: string, _limit: number, offset: number) => {
    if (offset) throw new Error('offline');
    return { sessionKey: key, sessionId: generation, totalMessages: 1000, hasMore: true, nextOffset: 8,
      messages: [{ id: 'distant', role: 'assistant', content: 'not connected' }] };
  });
  const result = await loadVisibleOlderHistoryBatch({ client: { history, decorateMessages: (rows: WorkspaceMessage[]) => rows } as unknown as OpenClawClient,
    sessionKey: key, path: '', visible, narration: [], cursor: recorded, archive: null, context: {}, owns: () => true });
  expect(result.older).toEqual([]); expect(result.cursor?.nextOffset).toBe(8);
  expect(result.cursor?.transport?.scan?.revalidate).toBe(true);
  expect(result.problem).toMatchObject({ message: 'offline' });
});
