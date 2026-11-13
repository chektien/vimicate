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
it('a changing total revalidates the witnessed boundary within the same older-history request', async () => {
  const visible = [row('edge', 100)];
  const recorded = recordHistoryTransport(cursor, 0, visible, { sessionKey: key, sessionId: generation });
  const history = vi.fn(async (_key: string, _limit: number, offset: number) => offset === 7
    ? { sessionKey: key, sessionId: generation, totalMessages: 1005, hasMore: true, nextOffset: 10, messages: [{ id: 'unwitnessed', role: 'user', content: 'unmounted' }] }
    : { sessionKey: key, sessionId: generation, totalMessages: 1005, hasMore: false, nextOffset: null,
      messages: [{ id: 'older', role: 'user', content: 'older' }, { id: 'edge', role: 'assistant', content: 'edge' }, { id: 'newer', role: 'assistant', content: 'not admitted' }] });
  const base = { client: { history, decorateMessages: (rows: WorkspaceMessage[]) => rows } as unknown as OpenClawClient,
    sessionKey: key, path: '', visible, narration: [], archive: null, context: {}, owns: () => true };
  const result = await loadVisibleOlderHistoryBatch({ ...base, cursor: recorded });
  expect(result.older.map(row => row.id)).toEqual(['older']);
  expect(result.problem).toBeUndefined();
  expect(history.mock.calls.map(call => call[2])).toEqual([7, 0]);
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

it('bounds a repeatedly changing traversal to one restart and preserves the retry witness', async () => {
  const visible = [row('edge', 100)];
  const recorded = recordHistoryTransport(cursor, 0, visible, { sessionKey: key, sessionId: generation });
  const history = vi.fn(async (_key: string, _limit: number, offset: number) => ({
    sessionKey: key, sessionId: generation, totalMessages: offset === 0 ? 1005 : 1010,
    hasMore: true, nextOffset: offset === 0 ? 8 : offset + 1,
    messages: [{ id: 'disjoint', role: 'assistant', content: 'never publish' }],
  }));
  const result = await loadVisibleOlderHistoryBatch({ client: { history, decorateMessages: (rows: WorkspaceMessage[]) => rows } as unknown as OpenClawClient,
    sessionKey: key, path: '', visible, narration: [], cursor: recorded, archive: null, context: {}, owns: () => true });
  expect(history.mock.calls.map(call => call[2])).toEqual([7, 0, 8]);
  expect(result.older).toEqual([]);
  expect(result.problem).toMatchObject({ message: expect.stringContaining('History changed') });
  expect(result.cursor?.transport?.scan?.revalidate).toBe(true);
});

it('does not cross generations while automatically re-witnessing a changed total', async () => {
  const visible = [row('edge', 100)];
  const recorded = recordHistoryTransport(cursor, 0, visible, { sessionKey: key, sessionId: generation });
  const history = vi.fn(async (_key: string, _limit: number, offset: number) => ({
    sessionKey: key, sessionId: offset === 0 ? 'foreign' : generation, totalMessages: 1005,
    hasMore: false, nextOffset: null,
    messages: [{ id: 'wrong', role: 'user', content: 'wrong' }, { id: 'edge', role: 'assistant', content: 'same ID is not authority' }],
  }));
  const result = await loadVisibleOlderHistoryBatch({ client: { history, decorateMessages: (rows: WorkspaceMessage[]) => rows } as unknown as OpenClawClient,
    sessionKey: key, path: '', visible, narration: [], cursor: recorded, archive: null, context: {}, owns: () => true });
  expect(history.mock.calls.map(call => call[2])).toEqual([7, 0]);
  expect(result.older).toEqual([]);
  expect(result.problem).toMatchObject({ message: 'History concrete generation changed.' });
});

it('keeps a genuine missing-boundary error instead of publishing disjoint history', async () => {
  const visible = [row('edge', 100)];
  const recorded = recordHistoryTransport(cursor, 0, visible, { sessionKey: key, sessionId: generation });
  const history = vi.fn(async (_key: string, _limit: number, offset: number) => ({
    sessionKey: key, sessionId: generation, totalMessages: 1005, hasMore: false, nextOffset: null,
    messages: [{ id: 'disjoint', role: 'assistant', content: 'not connected' }],
  }));
  const result = await loadVisibleOlderHistoryBatch({ client: { history, decorateMessages: (rows: WorkspaceMessage[]) => rows } as unknown as OpenClawClient,
    sessionKey: key, path: '', visible, narration: [], cursor: recorded, archive: null, context: {}, owns: () => true });
  expect(history.mock.calls.map(call => call[2])).toEqual([7, 0]);
  expect(result.older).toEqual([]);
  expect(result.problem).toMatchObject({ message: 'Older history boundary is no longer available.' });
});

it('re-witnesses a shrinking transcript even when its new total is below the stale requested offset', async () => {
  const visible = [row('edge', 100)];
  const recorded = recordHistoryTransport({ ...cursor, nextOffset: 80, totalMessages: 100 }, 0, visible, { sessionKey: key, sessionId: generation });
  const history = vi.fn(async (_key: string, _limit: number, offset: number) => ({
    sessionKey: key, sessionId: generation, offset, totalMessages: 50, hasMore: false, nextOffset: null,
    messages: offset ? [] : [{ id: 'older', role: 'assistant', content: 'older' }, { id: 'edge', role: 'assistant', content: 'edge' }],
  }));
  const result = await loadVisibleOlderHistoryBatch({ client: { history, decorateMessages: (rows: WorkspaceMessage[]) => rows } as unknown as OpenClawClient,
    sessionKey: key, path: '', visible, narration: [], cursor: recorded, archive: null, context: {}, owns: () => true });
  expect(history.mock.calls.map(call => call[2])).toEqual([80, 0]);
  expect(result.older.map(row => row.id)).toEqual(['older']);
  expect(result.problem).toBeUndefined();
});

it('retains the latest admitted boundary across revalidation scan pages after a partial batch', async () => {
  const visible = [row('edge', 100)];
  const recorded = recordHistoryTransport(cursor, 0, visible, { sessionKey: key, sessionId: generation });
  const history = vi.fn(async (_key: string, _limit: number, offset: number) => ({
    sessionKey: key, sessionId: generation, offset, totalMessages: offset === 7 ? 1000 : 1005,
    hasMore: offset !== 9, nextOffset: offset === 7 ? 8 : offset === 0 ? 9 : offset === 8 ? 10 : null,
    messages: (offset === 7 ? ['accepted'] : offset === 8 ? ['unwitnessed'] : offset === 0 ? ['newer'] : ['deep', 'accepted'])
      .map(id => ({ id, role: 'assistant', content: id })),
  }));
  const result = await loadVisibleOlderHistoryBatch({ client: { history, decorateMessages: (rows: WorkspaceMessage[]) => rows } as unknown as OpenClawClient,
    sessionKey: key, path: '', visible, narration: [], cursor: recorded, archive: null, context: {}, owns: () => true });
  expect(history.mock.calls.map(call => call[2])).toEqual([7, 8, 0, 9]);
  expect(result.older.map(row => row.id)).toEqual(['deep', 'accepted']);
  expect(result.problem).toBeUndefined();
});
