// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { beforeEach, expect, it, vi } from 'vitest';
import type { WorkspaceMessage } from '../workspace/workspaceTypes';
import { messagesFromPayload } from '../workspace/historyMessageProjection';
import { HistoryPublicationAuthority } from './historyPublicationAuthority';
import { SessionRunRegistry } from './sessionRunRegistry';
import { parsedTranscriptCache, serializedTranscriptCache } from './persistentTranscriptCache';
import { useRemoteQueuedInputs } from './useRemoteQueuedInputs';
import { mergeLatestHistory } from './historyPagination';
import { coalesceTranscriptIdentities } from './transcriptIdentityWall';
const generation = '11111111-1111-4111-8111-111111111111';
const other = '22222222-2222-4222-8222-222222222222';
const payload = { sessionKey: 'route', sessionId: generation, messages: [], pendingInputs: { total: 1, items: [
  { id: 'server-item', runId: 'receipt', state: 'queued', queued: true, acceptedAt: 1000, message: { role: 'user', content: 'Is it still running?', idempotencyKey: 'receipt' } },
] } };
const receipt = (state: 'queued' | 'consumed' = 'queued') => ({ ...payload, pendingInputs: { items: state === 'queued' ? payload.pendingInputs.items : [] },
  inputReceipts: [state === 'queued' ? { runId: 'receipt', state: 'pending', queued: true } : { runId: 'receipt', state: 'consumed', consumedByEventId: 'saved-prompt' }] });
function harness() {
  const root = createRoot(document.createElement('div')); let value!: ReturnType<typeof useRemoteQueuedInputs>;
  let messages = messagesFromPayload(payload); let sessionId = generation; let local = false;
  let status: 'connected' | 'disconnected' = 'connected';
  const authority = { current: new HistoryPublicationAuthority() }; const runRegistry = { current: new SessionRunRegistry() };
  const client = { connectionRevision: 1, request: vi.fn(async (): Promise<unknown> => receipt()) };
  function Component() { value = useRemoteQueuedInputs({ endpoint: 'ws://fixture', status, client, authority, runRegistry, selectedSessionKey: 'route', selectedSessionId: sessionId, messages }, () => local); return null; }
  return { value: () => value, row: () => messages[0]!, client, authority,
    render: () => act(async () => root.render(<Component />)), unmount: () => act(async () => root.unmount()),
    messages: (next: WorkspaceMessage[]) => { messages = next; }, generation: (next: string) => { sessionId = next; },
    status: (next: typeof status) => { status = next; }, local: () => { local = true; } };
}
beforeEach(() => { vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); });
it('shows exact server custody without a local preparation or predecessor and only reads history', async () => {
  const test = harness(); await test.render();
  expect(test.value().view(test.row())).toMatchObject({ readOnly: true, state: 'unknown', canCancel: false, canRunNow: false });
  await act(async () => test.value().refresh());
  expect(test.value().view(test.row())).toMatchObject({ state: 'queued', runId: 'receipt', sessionId: generation });
  expect(test.value().view(test.row())?.predecessorRunId).toBeUndefined();
  expect(test.client.request).toHaveBeenCalledExactlyOnceWith('chat.history', { sessionKey: 'route', inputRunIds: ['receipt'], limit: 1 });
  test.client.request.mockResolvedValue(receipt('consumed')); await act(async () => test.value().refresh());
  expect(test.value().view(test.row())?.state).toBe('consumed');
  await test.unmount();
});
it('restores queued rows as unknown even when they have an idempotency key, then rechecks without replay', async () => {
  const test = harness();
  const restored = parsedTranscriptCache(serializedTranscriptCache([test.row()]));
  expect(restored[0]).toMatchObject({ idempotencyKey: 'receipt', inputQueueState: 'unknown' });
  test.messages(restored); await test.render();
  expect(test.value().view(test.row())?.state).toBe('unknown');
  await act(async () => test.value().refresh());
  expect(test.value().view(test.row())?.state).toBe('queued');
  test.status('disconnected'); await test.render();
  expect(test.value().view(test.row())?.state).toBe('unknown');
  test.status('connected'); await test.render();
  expect(test.value().view(test.row())?.state).toBe('unknown');
  await test.unmount();
});
it('rejects wrong-generation receipts and late reads after navigation, reconnect or scene retirement', async () => {
  for (const retire of ['generation', 'connection', 'scene', 'unmount'] as const) {
    const test = harness(); await test.render();
    let resolve!: (value: unknown) => void;
    test.client.request.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    let pending!: Promise<void>; await act(async () => { pending = test.value().refresh(); });
    if (retire === 'generation') { test.generation(other); await test.render(); }
    if (retire === 'connection') { test.client.connectionRevision++; await test.render(); }
    if (retire === 'scene') test.authority.current.suspend();
    if (retire === 'unmount') await test.unmount();
    await act(async () => { resolve(receipt()); await pending; });
    if (retire === 'generation') expect(test.value().view(test.row())).toBeUndefined();
    if (retire === 'connection' || retire === 'scene') expect(test.value().view(test.row())?.state).toBe('unknown');
    if (retire !== 'unmount') await test.unmount();
  }
  const test = harness(); await test.render();
  test.client.request.mockResolvedValue({ ...receipt(), sessionId: other });
  await act(async () => test.value().refresh());
  expect(test.value().view(test.row())?.state).toBe('unknown'); await test.unmount();
});
it('rejects authored lookalikes, conflicting identities and rows owned by the local queue owner', async () => {
  const test = harness(); await test.render(); const row = test.row();
  for (const patch of [{ role: 'assistant' }, { source: 'live' }, { transcriptSessionId: other }, { sessionKey: 'foreign' },
    { inputQueueState: undefined }, { inputReceiptRunId: 'different' }, { inputAcceptedAtMs: NaN }, { displayPosition: { source: 'native', rawSeq: 1 } }]) {
    expect(test.value().view({ ...row, ...patch } as WorkspaceMessage)).toBeUndefined();
  }
  test.local(); await test.render(); await act(async () => test.value().refresh());
  expect(test.value().view(row)).toBeUndefined(); expect(test.client.request).not.toHaveBeenCalled();
  await test.unmount();
});
it.each([false, true])('keeps server custody visible on an optimistic alias without changing lifecycle ownership, keyed=%s', async keyed => {
  const test = harness();
  const item = payload.pendingInputs.items[0]!;
  const pending = messagesFromPayload({ ...payload, pendingInputs: { items: [{ ...item,
    message: keyed ? item.message : { role: 'user', content: item.message.content } }] } });
  const local: WorkspaceMessage = { id: 'local-submission', role: 'user', source: 'local', sessionKey: 'route',
    transcriptSessionId: generation, runId: 'running-task', inputReceiptRunId: 'receipt', idempotencyKey: 'receipt',
    text: item.message.content, timestamp: '999' };
  const merged = coalesceTranscriptIdentities([local, ...pending]);
  expect(merged).toHaveLength(1);
  expect(merged[0]).toMatchObject({ id: local.id, source: 'local', runId: 'running-task', inputReceiptRunId: 'receipt',
    inputQueueState: 'queued', inputPendingId: 'pending-input:server-item' });
  const restored = parsedTranscriptCache(serializedTranscriptCache(merged));
  expect(restored[0]).toMatchObject({ runId: 'running-task', inputReceiptRunId: 'receipt', inputQueueState: 'unknown' });
  test.messages(restored); await test.render(); await act(async () => test.value().refresh());
  expect(test.value().view(test.row())).toMatchObject({ state: 'queued', readOnly: true, runId: 'receipt', canRunNow: false });
  const canonical = messagesFromPayload({ sessionKey: 'route', sessionId: generation, messages: [{
    id: 'canonical-prompt', role: 'user', content: item.message.content, timestamp: 1000, idempotencyKey: 'receipt:user',
    __openclaw: { runId: 'running-task', transcriptPosition: { source: 'native', rawSeq: 1 }, recordTimestampMs: 1001,
      mirrorOrigin: 'codex-app-server', mirrorIdentity: 'receipt:prompt' },
  }] });
  const pickedUp = mergeLatestHistory(canonical, merged, 'route');
  expect(pickedUp.filter(row => row.role === 'user')).toHaveLength(1);
  test.messages(pickedUp); await test.render();
  expect(test.value().view(test.row())).toBeUndefined(); await test.unmount();
});
it('cannot revive a retired receipt when a child reads before the parent hook renders again', async () => {
  const test = harness(); await test.render(); await act(async () => test.value().refresh());
  expect(test.value().view(test.row())?.state).toBe('queued');
  test.authority.current.suspend(); test.authority.current.resume();
  expect(test.value().view(test.row())?.state).toBe('unknown');
  await test.render(); await act(async () => test.value().refresh());
  expect(test.value().view(test.row())?.state).toBe('queued');
  test.client.connectionRevision++;
  expect(test.value().view(test.row())?.state).toBe('unknown');
  await test.unmount();
});
it('does not reuse a receipt result when the same local row carries a different pending input', async () => {
  const test = harness();
  const local: WorkspaceMessage = { ...test.row(), id: 'local-submission', source: 'local', runId: 'running-task' };
  test.messages([local]); await test.render(); await act(async () => test.value().refresh());
  expect(test.value().view(test.row())?.state).toBe('queued');
  test.messages([{ ...local, inputReceiptRunId: 'different-receipt', inputPendingId: 'pending-input:different' }]); await test.render();
  expect(test.value().view(test.row())?.state).toBe('unknown');
  expect(test.client.request).toHaveBeenCalledTimes(1); await test.unmount();
});
it('rejects foreign or malformed custody at the raw pending-input boundary', () => {
  const item = payload.pendingInputs.items[0]!;
  for (const patch of [{ sessionKey: 'foreign' }, { sessionId: other }, { role: 'assistant' },
    { idempotencyKey: 42 }, { idempotencyKey: '' }, { __openclaw: { idempotencyKey: 'conflict' } },
    { __openclaw: { sessionKey: 'foreign' } }, { __openclaw: { sessionId: other } }]) {
    const rows = messagesFromPayload({ ...payload, pendingInputs: { items: [{ ...item, message: { ...item.message, ...patch } }] } });
    expect(rows).toEqual([]);
  }
  for (const patch of [{ sessionKey: 'foreign' }, { sessionId: other }, { queued: false }, { acceptedAt: undefined },
    { acceptedAt: null }, { acceptedAt: '1000' }, { runId: 42 }, { runId: ' ' }, { runId: undefined }]) {
    expect(messagesFromPayload({ ...payload, pendingInputs: { items: [{ ...item, ...patch }] } })).toEqual([]);
  }
  expect(messagesFromPayload({ ...payload, pendingInputs: { items: [{ ...item, runId: undefined,
    message: { ...item.message, __openclaw: { runId: 'running-task' } } }] } })).toEqual([]);
});
