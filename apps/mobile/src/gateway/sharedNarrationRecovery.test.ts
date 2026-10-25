import { expect, it, vi } from 'vitest';
import { loadSharedNarration } from './sharedNarration';

const state = { sessionKey: 'agent:main:direct:synthetic', sessionId: '00000000-0000-4000-b000-000000000126' };
const conflict = 'vimicate narration page failed: vimicate shared narration: snapshot changed';
const page = (revision: string, cursor: number) => ({
  contract: 'shared-narration-v1', stableSessionKey: state.sessionKey, sessionId: state.sessionId,
  snapshotToken: revision.repeat(43), cursor, totalRecords: 2,
  hasMore: cursor === 0, ...(cursor === 0 ? { nextCursor: 1 } : {}),
  records: [{ runId: 'r', itemId: `pre-${cursor}`, text: `${revision}-${cursor}`,
    firstSequence: cursor + 1, lastSequence: cursor + 1, firstTimestampMs: 100 + cursor,
    lastTimestampMs: 100 + cursor, revision: 1 }],
});

it('restarts once from cursor zero after the real inter-page conflict, discarding the abandoned snapshot', async () => {
  const request = vi.fn().mockResolvedValueOnce(page('A', 0)).mockRejectedValueOnce(new Error(conflict))
    .mockResolvedValueOnce(page('B', 0)).mockResolvedValueOnce(page('B', 1));
  const messages = await loadSharedNarration({ sharedNarrationRequest: request }, state);
  expect(messages.map(row => row.text)).toEqual(['B-0', 'B-1']);
  expect(request.mock.calls.map(([params]) => [params.cursor, params.snapshotToken])).toEqual([
    [0, undefined], [1, 'A'.repeat(43)], [0, undefined], [1, 'B'.repeat(43)],
  ]);
});

it('bounds repeated conflict recovery at two complete attempts', async () => {
  const request = vi.fn(async (params: Record<string, unknown>) => {
    if (params.cursor === 0) return page('A', 0);
    throw new Error(conflict);
  });
  await expect(loadSharedNarration({ sharedNarrationRequest: request }, state)).rejects.toThrow(conflict);
  expect(request).toHaveBeenCalledTimes(4);
});

it.each(['permission denied', 'vimicate shared narration: state schema is invalid'])('does not retry genuine failures: %s', async (message) => {
  const request = vi.fn().mockResolvedValueOnce(page('A', 0)).mockRejectedValueOnce(new Error(message));
  await expect(loadSharedNarration({ sharedNarrationRequest: request }, state)).rejects.toThrow(message);
  expect(request).toHaveBeenCalledTimes(2);
});

it('does not retry a conflict once its hydration has been retired', async () => {
  const controller = new AbortController();
  const request = vi.fn(async () => { controller.abort(); throw new Error(conflict); });
  await expect(loadSharedNarration({ sharedNarrationRequest: request }, state, controller.signal)).rejects.toThrow(conflict);
  expect(request).toHaveBeenCalledTimes(1);
});

it.each([false, true])('hydrates an actual 129-record host during mutation, recovering one expired view=%s', async (expire) => {
  // Dynamic path keeps this integration test independent of a declaration shim
  // for the existing JavaScript host contract. No live store or Gateway access.
  const hostModule = new URL('../../../../host/openclaw/vimicate-narration-record-contract.mjs', import.meta.url).href;
  const { createVimicateNarrationRecordContract } = await import(hostModule);
  let saved: unknown = null;
  let clock = 0;
  const contract = createVimicateNarrationRecordContract({
    readState: async () => structuredClone(saved),
    commitState: async (next: unknown) => { saved = structuredClone(next); },
    snapshotNow: () => clock,
  });
  const event = (index: number, text = 'checking', seq = index + 1) => ({
    sessionKey: state.sessionKey, sessionId: state.sessionId, runId: 'r', stream: 'item', seq, ts: 1000 + seq,
    data: { itemId: `pre-${index}`, kind: 'preamble', source: 'codex-app-server', phase: 'update', progressText: text },
  });
  for (let index = 0; index < 129; index += 1) await contract.record(event(index));
  let mutated = false;
  const request = vi.fn(async (params: Record<string, unknown>) => {
    const result = await contract.request(params);
    if (!mutated) {
      mutated = true;
      await contract.record(event(0, 'checking more', 130));
      if (expire) clock = 60_000;
    }
    return result;
  });
  const messages = await loadSharedNarration({ sharedNarrationRequest: request }, state);
  expect(messages).toHaveLength(129);
  expect(messages[0]?.text).toBe(expire ? 'checking more' : 'checking');
  expect(request.mock.calls.map(([params]) => params.cursor)).toEqual(expire ? [0, 128, 0, 128] : [0, 128]);
  const fresh = await loadSharedNarration({ sharedNarrationRequest: request }, state);
  expect(fresh[0]?.text).toBe('checking more');
});
