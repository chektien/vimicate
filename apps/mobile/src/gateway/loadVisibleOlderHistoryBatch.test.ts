import { expect, it, vi } from 'vitest';
import type { OpenClawClient } from './OpenClawClient';
import { loadVisibleOlderHistoryBatch } from './loadVisibleOlderHistoryBatch';
import type { WorkspaceMessage } from '../workspace/workspaceTypes';
import { olderReviewBytes, OLDER_READ_LIMIT, OLDER_REVIEW_BYTE_LIMIT } from './olderHistoryVisibleRows';

const key = 'agent:fixture:batch';
const visible: WorkspaceMessage[] = [{ id: 'tail', role: 'user', text: 'current', source: 'history', sessionKey: key }];
const base = { sessionKey: key, path: '', visible, narration: [] as WorkspaceMessage[], archive: null,
  context: {}, owns: () => true };

it('retains accepted pages and their cursor after a later transport failure for retry', async () => {
  const history = vi.fn(async (_key: string, _limit: number, offset: number) => {
    if (offset === 80) return { sessionKey: key, messages: [{ id: 'older', role: 'assistant', content: 'older' }],
      hasMore: true, nextOffset: 81, totalMessages: 200 };
    throw new Error('temporary transport failure');
  });
  const client = { history, decorateMessages: (rows: WorkspaceMessage[]) => rows } as unknown as OpenClawClient;
  const result = await loadVisibleOlderHistoryBatch({ ...base, client,
    cursor: { sessionKey: key, hasMore: true, nextOffset: 80, totalMessages: 200 } });
  expect(result.older.map(row => row.id)).toEqual(['older']);
  expect(result.cursor?.nextOffset).toBe(81);
  expect(result.problem).toMatchObject({ message: 'temporary transport failure' });
  expect(history.mock.calls.map(call => call[2])).toEqual([80, 81]);
});

it('rejects a nonadvancing cursor and bounds empty-page reads', async () => {
  const stuck = { history: vi.fn(async () => ({ sessionKey: key, messages: [], hasMore: true,
    nextOffset: 80, totalMessages: 200 })), decorateMessages: (rows: WorkspaceMessage[]) => rows } as unknown as OpenClawClient;
  const rejected = await loadVisibleOlderHistoryBatch({ ...base, client: stuck,
    cursor: { sessionKey: key, hasMore: true, nextOffset: 80, totalMessages: 200 } });
  expect(rejected.older).toEqual([]);
  expect(rejected.cursor?.nextOffset).toBe(80);
  expect(rejected.problem).toMatchObject({ message: 'older history cursor did not advance' });

  const history = vi.fn(async (_key: string, _limit: number, offset: number) => ({ sessionKey: key,
    messages: [], hasMore: true, nextOffset: offset + 1, totalMessages: 1000 }));
  const client = { history, decorateMessages: (rows: WorkspaceMessage[]) => rows } as unknown as OpenClawClient;
  const bounded = await loadVisibleOlderHistoryBatch({ ...base, client,
    cursor: { sessionKey: key, hasMore: true, nextOffset: 80, totalMessages: 1000 } });
  expect(history).toHaveBeenCalledTimes(OLDER_READ_LIMIT);
  expect(bounded.cursor?.nextOffset).toBe(80 + OLDER_READ_LIMIT);
});

it('retires without advancing a cursor after authority changes during a read', async () => {
  let owned = true;
  const history = vi.fn(async () => { owned = false; return { sessionKey: key, messages: [],
    hasMore: true, nextOffset: 81, totalMessages: 200 }; });
  const client = { history, decorateMessages: (rows: WorkspaceMessage[]) => rows } as unknown as OpenClawClient;
  const result = await loadVisibleOlderHistoryBatch({ ...base, client, owns: () => owned,
    cursor: { sessionKey: key, hasMore: true, nextOffset: 80, totalMessages: 200 } });
  expect(result.cursor?.nextOffset).toBe(80);
  expect(result.older).toEqual([]);
  expect(history).toHaveBeenCalledOnce();
});

it('continues from the current cursor into archived raw pages without deriving offsets from projected rows', async () => {
  const currentID = '33333333-3333-4333-8333-333333333333';
  const archivedID = '00000000-0000-4000-b000-000000000122';
  const segment = { sessionId: archivedID, order: 0, state: 'archived' as const, startedAtMs: 100,
    endedAtMs: 900, endReason: 'new', sourceRevision: 'revision-old' };
  const state = { identity: { sessionKey: key, currentSessionId: currentID, currentSessionStartedAtMs: 1000 },
    familyToken: 'family', segments: [segment, { sessionId: currentID, order: 1, state: 'current' as const,
      startedAtMs: 1000, sourceRevision: 'revision-current' }], nextArchivedIndex: 0, exhausted: false };
  const requests: number[] = [];
  const client = {
    history: vi.fn(async () => ({ sessionKey: key, messages: [{ id: 'current-older', role: 'assistant', content: 'current' }],
      hasMore: false, nextOffset: null, totalMessages: 81 })),
    archivedHistoryRequest: vi.fn(async (params: Record<string, unknown>) => {
      requests.push(Number(params.offset));
      const offset = Number(params.offset);
      return { contract: 'archived-family-v1', proof: 'audited-baseline+contiguous-ledger-v1',
        stableSessionKey: key, currentSessionId: currentID, currentSessionStartedAtMs: 1000,
        familyToken: 'family', segment, sessionId: archivedID, offset, totalMessages: 20,
        hasMore: offset === 0, ...(offset === 0 ? { nextOffset: 10 } : {}),
        messages: [{ id: `projected-${offset}`, role: 'assistant', content: `archive ${offset}` }] };
    }),
    decorateMessages: (rows: WorkspaceMessage[]) => rows,
  } as unknown as OpenClawClient;
  const result = await loadVisibleOlderHistoryBatch({ ...base, client, archive: state,
    cursor: { sessionKey: key, hasMore: true, nextOffset: 80, totalMessages: 81 } });
  expect(requests).toEqual([0, 10]);
  expect(result.cursor?.hasMore).toBe(false);
  expect(result.archive?.exhausted).toBe(true);
  expect(result.older.map(row => row.id)).toEqual([
    `archive:${archivedID}:projected-10`, `archive:${archivedID}:projected-0`, 'current-older',
  ]);
});

it('stops a tool-heavy batch at its retained byte ceiling even when folding hides every member', async () => {
  const raw = Array.from({ length: 100 }, (_, index) => ({ id: `heavy-${index}`, role: 'tool',
    content: `call ${index} ${'x'.repeat(100_000)}` }));
  const history = vi.fn(async (_key: string, limit: number, offset: number) => {
    const end = raw.length - offset;
    const messages = raw.slice(Math.max(0, end - limit), end);
    const next = offset + messages.length;
    return { sessionKey: key, messages, hasMore: next < raw.length,
      nextOffset: next < raw.length ? next : null, totalMessages: raw.length };
  });
  const client = { history, decorateMessages: (rows: WorkspaceMessage[]) => rows } as unknown as OpenClawClient;
  const result = await loadVisibleOlderHistoryBatch({ ...base, client,
    cursor: { sessionKey: key, hasMore: true, nextOffset: 1, totalMessages: raw.length } });
  expect(result.older.length).toBeGreaterThan(0);
  expect(result.cursor?.hasMore).toBe(true);
  expect(olderReviewBytes([...result.older, ...visible])).toBeLessThanOrEqual(OLDER_REVIEW_BYTE_LIMIT);
  expect(history.mock.calls.length).toBeLessThanOrEqual(OLDER_READ_LIMIT);
});

it('keeps reading through a full older review until a collapsed tool continuation exposes a row', async () => {
  const tool = (id: string): WorkspaceMessage => ({ id, role: 'tool', text: `call ${id}`, source: 'history', sessionKey: key });
  const fullReview = Array.from({ length: 1968 }, (_, index) => tool(`visible-${index}`));
  const older = [
    { id: 'earlier-answer', role: 'assistant', text: 'Earlier answer', source: 'history', sessionKey: key } as WorkspaceMessage,
    ...Array.from({ length: 160 }, (_, index) => tool(`older-${index}`)),
  ];
  const history = vi.fn(async (_key: string, limit: number, offset: number) => {
    const end = older.length - offset;
    const messages = older.slice(Math.max(0, end - limit), end).map(message => ({ id: message.id, role: message.role, content: message.text }));
    const next = offset + messages.length;
    return { sessionKey: key, messages, hasMore: next < older.length,
      nextOffset: next < older.length ? next : null, totalMessages: older.length };
  });
  const client = { history, decorateMessages: (rows: WorkspaceMessage[]) => rows } as unknown as OpenClawClient;
  const result = await loadVisibleOlderHistoryBatch({ ...base, visible: fullReview, client,
    cursor: { sessionKey: key, hasMore: true, nextOffset: 1, totalMessages: older.length } });
  expect(history.mock.calls.length).toBeGreaterThan(1);
  expect(history.mock.calls.map(call => call[2])).toEqual([1, 81]);
  expect(new Set(result.older.map(message => message.id)).size).toBe(result.older.length);
  expect(result.older.some(message => message.id === 'earlier-answer')).toBe(true);
  expect(result.cursor?.hasMore).toBe(false);
  expect(result.addedVisibleRowCount).toBeGreaterThan(0);
});
