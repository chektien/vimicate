import { expect, it, vi } from 'vitest';
import { loadVisibleNewerHistoryBatch } from './loadVisibleNewerHistoryBatch';
import type { OpenClawClient } from './OpenClawClient';
import type { WorkspaceMessage } from '../workspace/workspaceTypes';
const key = 'thread';
const row = (index: number): WorkspaceMessage => ({ id: `r${index}`, role: 'user', text: `${index}`, source: 'history', sessionKey: key, timestamp: new Date(1800000000000 + index).toISOString() });
function fixture(total: number) {
  const history = vi.fn(async (_key: string, limit: number, offset: number) => ({ sessionKey: key, totalMessages: total,
    messages: Array.from({ length: Math.min(limit, total - offset) }, (_, index) => {
      const message = row(Math.max(0, total - offset - limit) + index);
      return { ...message, content: message.text };
    }), nextOffset: offset + limit < total ? offset + limit : null, hasMore: offset + limit < total }));
  const client = { history, decorateMessages: (rows: WorkspaceMessage[]) => rows } as unknown as OpenClawClient;
  return { history, input: { client, sessionKey: key, path: '', archive: null, context: {}, owns: () => true,
    cursor: { sessionKey: key, nextOffset: total - 100, totalMessages: total, hasMore: true }, visible: [row(100)], scan: null } };
}
it('loads the consecutive interval after the exact reviewed edge without jumping to latest', async () => {
  const { history, input } = fixture(1000);
  const batch = await loadVisibleNewerHistoryBatch(input);
  expect(batch.newer.map(message => message.id)).toEqual(Array.from({ length: 159 }, (_, index) => `r${101 + index}`));
  expect(batch.newer.at(-1)?.id).not.toBe('r999');
  expect(batch.rewind?.cursor?.nextOffset).toBe(820);
  expect(history.mock.calls.map(call => call[2])).toEqual([900, 820, 740]);
});
it('continues a bounded boundary search on the next request rather than rescanning', async () => {
  const { history, input } = fixture(10000);
  const first = await loadVisibleNewerHistoryBatch({ ...input, visible: [row(8000)] });
  expect(first.newer).toEqual([]); expect(first.scan).not.toBeNull(); expect(history).toHaveBeenCalledTimes(32);
  const offset = first.scan!.offset;
  await loadVisibleNewerHistoryBatch({ ...input, visible: [row(8000)], scan: first.scan });
  expect(history.mock.calls[32]![2]).toBe(offset - 80);
});
it('rewinds to a containing raw page so a subsequent newer request can find its retained edge', async () => {
  const { input } = fixture(1000);
  const first = await loadVisibleNewerHistoryBatch(input);
  const second = await loadVisibleNewerHistoryBatch({ ...input, cursor: first.rewind!.cursor,
    visible: [first.newer.at(-1)!], scan: null });
  expect(second.newer[0]?.id).toBe('r260');
});
it('does not publish a guessed interval if the review identity disappeared', async () => {
  const { input } = fixture(200);
  await expect(loadVisibleNewerHistoryBatch({ ...input, visible: [{ ...row(100), id: 'missing' }] })).rejects.toThrow('boundary');
});
it('stops without an interval when request authority is retired during transport', async () => {
  const { input } = fixture(1000); let owns = true;
  const original = input.client.history;
  input.client.history = async (...args) => { const payload = await original(...args); owns = false; return payload; };
  const batch = await loadVisibleNewerHistoryBatch({ ...input, owns: () => owns });
  expect(batch.newer).toEqual([]); expect(batch.rewind).toBeNull();
});
it('compensates raw coordinate growth after finding the reviewed boundary', async () => {
  const { input } = fixture(1000); let call = 0;
  input.client.history = async (_key, limit = 80, offset = 0) => {
    const total = ++call >= 3 ? 1200 : 1000;
    return { sessionKey: key, totalMessages: total, hasMore: offset + limit < total, nextOffset: offset + limit < total ? offset + limit : null, messages: Array.from({ length: limit }, (_, index) => {
      const message = row(total - offset - limit + index); return { ...message, content: message.text };
    }) };
  };
  const batch = await loadVisibleNewerHistoryBatch(input);
  expect(batch.newer.map(message => message.id)).toEqual(Array.from({ length: 159 }, (_, index) => `r${101 + index}`));
});
it('rejects a stale same-ID generation before the interval can publish', async () => {
  const { input } = fixture(1000);
  const id = '00000000-0000-4000-8000-000000000001';
  const history = input.client.history;
  input.client.history = async (...args) => ({ ...await history(...args), sessionId: id });
  input.client.readRegistry = async () => ({ capabilities: { sessionHistory: 'sqlite-display-v1' },
    currentSessionGenerations: { [key]: { sessionId: id, sessionStartedAtMs: 200 } } });
  await expect(loadVisibleNewerHistoryBatch({ ...input, generation: { sessionId: id, sessionStartedAtMs: 100, historyModel: 'sqlite-display-v1' } })).rejects.toThrow('generation changed');
});
it('traverses an immutable archived segment into consecutive current history after cold review restore', async () => {
  const id = '00000000-0000-4000-8000-000000000001';
  const current = '00000000-0000-4000-8000-000000000002';
  const { input } = fixture(200);
  const old = { sessionId: id, order: 0, state: 'archived' as const, sourceRevision: 'immutable' };
  const now = { sessionId: current, order: 1, state: 'current' as const, sourceRevision: 'current' };
  input.client.archivedHistoryRequest = async params => {
    const offset = params.offset as number; const limit = params.limit as number;
    return { contract: 'sqlite-family-v1', proof: 'verified-import+sqlite-ownership-v1', stableSessionKey: key,
      currentSessionId: current, currentSessionStartedAtMs: 200, familyToken: 'family', sessionId: id, segment: old,
      offset, totalMessages: 200, hasMore: offset + limit < 200, nextOffset: offset + limit < 200 ? offset + limit : null, messages: Array.from({ length: limit }, (_, index) => {
        const message = row(200 - offset - limit + index); return { ...message, content: message.text };
      }) };
  };
  const history = input.client.history;
  input.client.history = async (...args) => {
    const payload = await history(...args);
    return { ...payload, messages: (payload.messages as { id: string; content: string }[]).map(message => {
      const index = Number(message.id.slice(1)) + 200; return { ...message, id: `r${index}`, content: `${index}`, timestamp: row(index).timestamp };
    }) };
  };
  const archive = { identity: { sessionKey: key, currentSessionId: current, currentSessionStartedAtMs: 200, contract: 'sqlite-family-v1' as const },
    familyToken: 'family', segments: [old, now], nextArchivedIndex: -1, exhausted: true };
  const first = await loadVisibleNewerHistoryBatch({ ...input, archive, visible: [{ ...row(100), id: `archive:${id}:r100`, transcriptSessionId: id }] });
  expect(first.newer[0]?.id).toBe(`archive:${id}:r101`);
  expect(first.newer.at(-1)?.id).toBe(`archive:${id}:r199`);
  const second = await loadVisibleNewerHistoryBatch({ ...input, archive: first.rewind!.archive,
    visible: [first.newer.at(-1)!] });
  expect(second.newer[0]?.id).toBe('r200');
  expect(second.newer.at(-1)?.id).toBe('r279');
});
