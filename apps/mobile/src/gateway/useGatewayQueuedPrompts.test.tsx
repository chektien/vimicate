// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { HistoryPublicationAuthority } from './historyPublicationAuthority';
import { SessionRunRegistry } from './sessionRunRegistry';
import { QueuedPromptOwner, type QueuedPromptPreparation } from './queuedPromptOwner';
vi.mock('../storage/workspaceStore', () => ({ loadValue: vi.fn(async () => null), saveValue: vi.fn(async () => {}) }));
import { loadValue, saveValue } from '../storage/workspaceStore';
import type { WorkspaceMessage } from '../workspace/workspaceTypes';
import { useGatewayQueuedPrompts } from './useGatewayQueuedPrompts';
const request: QueuedPromptPreparation = { runId: 'followup', originalSubmissionId: 'original', sessionKey: 'route', sessionId: 'generation', predecessorRunId: 'predecessor', createdAt: 100, text: 'Queued text' };
const message = { id: 'row', role: 'user' as const, sessionKey: 'route', idempotencyKey: 'followup', text: 'Queued text' };
const receipt = (state = 'queued') => ({ sessionKey: 'route', sessionId: 'generation', inputReceipts: [state === 'queued' ? { runId: 'followup', state: 'pending', queued: true } : { runId: 'followup', state: 'consumed', consumedByEventId: 'event' }] });
function harness() {
  const root = createRoot(document.createElement('div')); let value!: ReturnType<typeof useGatewayQueuedPrompts>;
  let messages: WorkspaceMessage[] = []; let endpoint = 'ws://fixture'; let sessionId = 'generation'; let status: 'connected' | 'disconnected' = 'connected';
  const authority = { current: new HistoryPublicationAuthority() }; const runRegistry = { current: new SessionRunRegistry() };
  runRegistry.current.registerRun('route', 'predecessor');
  const client = { request: vi.fn(async (_method: string, _params?: Record<string, unknown>): Promise<unknown> => receipt()) };
  function Component() { value = useGatewayQueuedPrompts({ endpoint, status, client, authority, runRegistry, selectedSessionKey: 'route', selectedSessionId: sessionId, messages }); return null; }
  const render = () => act(async () => root.render(<Component />));
  return { root, messages: (next: WorkspaceMessage[]) => { messages = next; }, value: () => value, render, client, authority, runRegistry, endpoint: (next: string) => { endpoint = next; }, generation: (next: string) => { sessionId = next; }, status: (next: typeof status) => { status = next; }, unmount: () => act(async () => root.unmount()) };
}
beforeEach(() => { vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); vi.mocked(loadValue).mockReset().mockResolvedValue(null); vi.mocked(saveValue).mockReset().mockResolvedValue(undefined); });
afterEach(() => { vi.useRealTimers(); });
it('persists prepare before caller network work, disallows duplicates and distinguishes ack from custody', async () => {
  const test = harness(); await test.render(); test.client.request.mockResolvedValue({});
  let release!: () => void; vi.mocked(saveValue).mockImplementationOnce(() => new Promise<void>(resolve => { release = resolve; }));
  let prepared = false; let pending!: Promise<void>;
  await act(async () => { pending = test.value().prepare(request).then(() => { prepared = true; }); });
  expect(prepared).toBe(false); expect(test.client.request).not.toHaveBeenCalled();
  await act(async () => { release(); await pending; }); expect(prepared).toBe(true);
  await act(async () => { await expect(test.value().prepare(request)).rejects.toThrow('already'); });
  await act(async () => { await test.value().accepted('followup', { runId: 'followup', status: 'started' }); });
  expect(test.value().view(message)?.state).toBe('unknown');
  test.client.request.mockResolvedValue(receipt()); await act(async () => { await test.value().refresh(); });
  expect(test.value().view(message)?.state).toBe('queued'); expect(test.value().view(message)?.canRunNow).toBe(true);
  await test.unmount();
});
it('refuses network authorization when persistence fails but never throws after a native ack', async () => {
  const test = harness(); await test.render(); vi.mocked(saveValue).mockRejectedValueOnce(new Error('disk'));
  await act(async () => { await expect(test.value().prepare(request)).rejects.toThrow('disk'); }); expect(test.value().view(message)).toBeUndefined();
  await act(async () => { await test.value().prepare(request); }); vi.mocked(saveValue).mockRejectedValue(new Error('disk'));
  await act(async () => { await expect(test.value().accepted('followup', { runId: 'followup', status: 'started' })).resolves.toBeUndefined(); });
  expect(test.value().storageError).toContain('not saved'); expect(test.value().view(message)?.state).toBe('queued'); await test.unmount();
});
it('restores and reconnects only through read-only receipts, never sends automatically', async () => {
  const saved = new QueuedPromptOwner(); saved.prepare(request); vi.mocked(loadValue).mockResolvedValueOnce(saved.serialize());
  const test = harness(); test.status('disconnected'); await test.render(); expect(test.value().view(message)?.state).toBe('unknown');
  expect(test.client.request).not.toHaveBeenCalled(); test.status('connected'); await test.render();
  expect(test.value().view(message)?.state).toBe('queued'); expect(test.client.request.mock.calls.every(call => call[0] === 'chat.history')).toBe(true); await test.unmount();
});
it('suppresses late generation reads and cancels refresh timers immediately on scene retirement and disposal', async () => {
  vi.useFakeTimers(); const test = harness(); await test.render(); await act(async () => { await test.value().prepare(request); });
  let resolve!: (payload: unknown) => void; test.client.request.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
  let pending!: Promise<void>; await act(async () => { pending = test.value().refresh(); });
  test.generation('new-generation'); await test.render(); await act(async () => { resolve(receipt('consumed')); await pending; });
  expect(test.value().view(message)?.state).toBe('preparing'); expect(test.value().view(message)?.canCancel).toBe(false);
  test.authority.current.suspend(); expect(vi.getTimerCount()).toBe(0); await test.unmount(); expect(vi.getTimerCount()).toBe(0);
});
it('cancels only exact queued custody and run-now stops only the exact predecessor without resending', async () => {
  const test = harness(); await test.render(); await act(async () => { await test.value().prepare(request); await test.value().accepted('followup', { runId: 'followup', status: 'started' }); });
  test.client.request.mockImplementation(async (method, params) => method === 'chat.history' ? receipt() : { ok: true, aborted: true, runIds: [params!.runId] });
  await act(async () => { await test.value().runNow('followup'); });
  expect(test.client.request).toHaveBeenCalledWith('chat.abort', { sessionKey: 'route', runId: 'predecessor' });
  expect(test.runRegistry.current.runFor('route')).toBe('predecessor');
  test.runRegistry.current.registerRun('route', 'successor'); test.client.request.mockClear();
  await act(async () => { await test.value().runNow('followup'); }); expect(test.client.request.mock.calls.some(call => call[0] === 'chat.abort')).toBe(false);
  await act(async () => { await test.value().cancel('followup'); });
  expect(test.client.request).toHaveBeenCalledWith('chat.abort', { sessionKey: 'route', runId: 'followup', discardPendingInput: true });
  expect(test.value().view(message)?.state).toBe('cancelled'); expect(test.client.request.mock.calls.some(call => call[0] === 'chat.send')).toBe(false); await test.unmount();
});
it('never aborts after receipt consumption or generation retirement during preflight', async () => {
  const test = harness(); await test.render(); await act(async () => { await test.value().prepare(request); });
  test.client.request.mockResolvedValue(receipt('consumed')); await act(async () => { await test.value().cancel('followup'); });
  expect(test.value().view(message)?.state).toBe('consumed'); expect(test.client.request.mock.calls.some(call => call[0] === 'chat.abort')).toBe(false); await test.unmount();
});
it('retires a definitely-unsent preparation if selection changes after its durable admission', async () => {
  const test = harness(); await test.render(); let release!: () => void;
  vi.mocked(saveValue).mockImplementationOnce(() => new Promise<void>(resolve => { release = resolve; }));
  let pending!: Promise<void>; await act(async () => { pending = test.value().prepare(request); });
  test.generation('next'); await test.render();
  await act(async () => { release(); await expect(pending).rejects.toThrow('retired'); });
  expect(test.value().view(message)).toBeUndefined(); expect(test.client.request).not.toHaveBeenCalled();
  expect(vi.mocked(saveValue).mock.calls.at(-1)?.[1]).toBe('[]'); await test.unmount();
});
it('returns native acceptance without awaiting a status read and fences a late scene response', async () => {
  const test = harness(); await test.render(); await act(async () => { await test.value().prepare(request); });
  let finish!: (payload: unknown) => void;
  test.client.request.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  await act(async () => { await test.value().accepted('followup', { runId: 'followup', status: 'started' }); });
  expect(test.value().view(message)?.state).toBe('accepted');
  const writes = vi.mocked(saveValue).mock.calls.length; test.authority.current.suspend();
  await act(async () => { finish(receipt('consumed')); });
  expect(test.value().view(message)?.state).toBe('accepted'); expect(vi.mocked(saveValue).mock.calls).toHaveLength(writes); await test.unmount();
});
it('downgrades restored or missing queue custody to unconfirmed until a fresh exact receipt', async () => {
  const saved = new QueuedPromptOwner(); saved.prepare(request); saved.update('followup', 'queued');
  vi.mocked(loadValue).mockResolvedValueOnce(saved.serialize()); const test = harness(); test.client.request.mockResolvedValue({});
  await test.render(); expect(test.value().view(message)?.state).toBe('unknown'); expect(test.value().view(message)?.canCancel).toBe(false);
  test.client.request.mockResolvedValue(receipt()); await act(async () => { await test.value().refresh(); }); expect(test.value().view(message)?.state).toBe('queued');
  test.client.request.mockResolvedValue({}); await act(async () => { await test.value().refresh(); }); expect(test.value().view(message)?.state).toBe('unknown'); await test.unmount();
});
it('fences late hydration when the endpoint changes and never stores it under the successor', async () => {
  const saved = new QueuedPromptOwner(); saved.prepare(request); let finish!: (payload: string) => void;
  vi.mocked(loadValue).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const test = harness(); await test.render(); test.endpoint('ws://successor'); await test.render();
  await act(async () => { finish(saved.serialize()); }); expect(test.value().view(message)).toBeUndefined();
  expect(test.client.request).not.toHaveBeenCalled(); await test.unmount();
});
it('rechecks selection before the cancellation helper sends its named discard', async () => {
  const test = harness(); await test.render(); await act(async () => { await test.value().prepare(request); await test.value().refresh(); });
  let finish!: (payload: unknown) => void;
  test.client.request.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  let pending!: Promise<void>; await act(async () => { pending = test.value().cancel('followup'); });
  test.generation('next'); await test.render(); await act(async () => { finish(receipt()); await pending; });
  expect(test.client.request.mock.calls.some(call => call[0] === 'chat.abort')).toBe(false); await test.unmount();
});
it('keeps run-now acceptance visible until pickup, and lost receipt transport cannot assert current queue custody', async () => {
  const test = harness(); await test.render(); await act(async () => { await test.value().prepare(request); await test.value().refresh(); });
  test.client.request.mockImplementation(async (method, params) => method === 'chat.history' ? receipt() : { ok: true, aborted: true, runIds: [params!.runId] });
  await act(async () => { await test.value().runNow('followup'); });
  expect(test.value().view(message)?.detail).toBe('Stop request accepted. Checking message pickup.');
  test.client.request.mockRejectedValue(new Error('disconnected'));
  await act(async () => { await test.value().refresh(); }); expect(test.value().view(message)?.state).toBe('unknown'); expect(test.value().view(message)?.canCancel).toBe(false);
  await test.unmount();
});

it('a definite followup refusal releases its local queue slot instead of retaining phantom custody', async () => {
  const test = harness(); await test.render(); await act(async () => { await test.value().prepare(request); });
  await act(async () => { await test.value().failed('followup', Object.assign(new Error('not dispatched'), { reachedGateway: false })); });
  expect(test.value().view(message)).toBeUndefined();
  await act(async () => { await expect(test.value().prepare(request)).resolves.toBeUndefined(); });
  expect(test.client.request).not.toHaveBeenCalled(); await test.unmount();
});

it('Run now records the exact Stop receipt so the intentional abort is not a failed task', async () => {
  const test = harness(); await test.render();
  await act(async () => { await test.value().prepare(request); await test.value().refresh(); });
  test.client.request.mockImplementation(async (method, params) => method === 'chat.history' ? receipt() : { ok: true, aborted: true, runIds: [params!.runId] });
  await act(async () => { await test.value().runNow('followup'); });
  test.runRegistry.current.observePhase('route', 'failed', 'predecessor');
  expect(test.runRegistry.current.phaseFor('route')).toBe('completed');
  expect(test.value().view(message)?.state).toBe('queued');
  expect(test.client.request.mock.calls.some(call => call[0] === 'chat.send')).toBe(false);
  await test.unmount();
});

it('retires queue custody from exact canonical history after receipt expiry without resending or aborting', async () => {
  const test = harness(); await test.render();
  await act(async () => { await test.value().prepare(request); await test.value().refresh(); });
  const committed: WorkspaceMessage = { ...message, id: 'canonical', idempotencyKey: 'followup:user',
    source: 'history', transcriptSessionId: 'generation', displayPosition: { source: 'native', rawSeq: 42 } };
  test.messages([committed]); await test.render();
  test.client.request.mockResolvedValue({ sessionKey: 'route', sessionId: 'generation', inputReceipts: [], pendingInputs: { items: [] } });
  await act(async () => { await test.value().runNow('followup'); });
  expect(test.value().view(committed)?.state).toBe('consumed');
  expect(test.value().view(committed)?.canRunNow).toBe(false);
  expect(test.client.request.mock.calls.every(call => call[0] === 'chat.history')).toBe(true);
  await test.unmount();
});

it('does not offer or send Run now twice after exact Stop confirmation, including after refresh', async () => {
  const test = harness(); await test.render(); await act(async () => { await test.value().prepare(request); await test.value().refresh(); });
  test.client.request.mockImplementation(async (method, params) => method === 'chat.history' ? receipt() : { ok: true, aborted: true, runIds: [params!.runId] });
  await act(async () => { await test.value().runNow('followup'); });
  expect(test.value().view(message)?.canRunNow).toBe(false);
  expect(test.value().view(message)?.detail).toBe('Stop request accepted. Checking message pickup.');
  await act(async () => { await test.value().refresh(); await test.value().runNow('followup'); });
  expect(test.client.request.mock.calls.filter(call => call[0] === 'chat.abort')).toHaveLength(1);
  test.runRegistry.current.registerRun('route', 'successor'); await test.render();
  expect(test.value().view(message)?.detail).not.toContain('Stopping');
  test.client.request.mockResolvedValue(receipt('consumed')); await act(async () => { await test.value().refresh(); });
  expect(test.value().view(message)?.state).toBe('consumed'); expect(test.value().view(message)?.detail).toBeUndefined();
  expect(test.client.request.mock.calls.some(call => call[0] === 'chat.send')).toBe(false);
  await test.unmount();
});

it('clears restored Stop progress before reconnecting and resolves pickup without a local transcript tail', async () => {
  vi.useFakeTimers();
  const saved = new QueuedPromptOwner(); saved.prepare(request);
  saved.update('followup', 'queued', 'Stopping the current task. Your message remains queued.');
  vi.mocked(loadValue).mockResolvedValueOnce(saved.serialize());
  const test = harness(); test.status('disconnected'); await test.render();
  expect(test.value().view(message)?.detail).toBeUndefined(); expect(test.client.request).not.toHaveBeenCalled();
  test.client.request.mockImplementation(async (_method, params) => ({ sessionKey: 'route', sessionId: 'generation', inputReceipts: [],
    messages: params?.limit === 64 ? [{ role: 'user', idempotencyKey: 'followup:user',
      __openclaw: { id: 'canonical', transcriptPosition: { source: 'sqlite', rawSeq: 42 } } }] : [], pendingInputs: { items: [] } }));
  test.status('connected'); await test.render();
  expect(test.value().view(message)?.state).toBe('consumed'); expect(test.value().view(message)?.detail).toBeUndefined();
  expect(test.client.request.mock.calls.every(call => call[0] === 'chat.history')).toBe(true);
  const calls = test.client.request.mock.calls.length;
  await act(async () => { await vi.advanceTimersByTimeAsync(5000); }); expect(test.client.request.mock.calls).toHaveLength(calls);
  await test.unmount(); expect(vi.getTimerCount()).toBe(0);
});

it('keeps a cancellation refusal visible across queued receipt refreshes without stopping the predecessor', async () => {
  const test = harness(); await test.render();
  await act(async () => { await test.value().prepare(request); await test.value().accepted('followup', { runId: 'followup', status: 'started' }); });
  test.client.request.mockImplementation(async method => {
    if (method === 'chat.history') return receipt();
    throw Object.assign(new Error('Error: Queued input is already starting; refresh before removing it.'), { gatewayCode: 'UNAVAILABLE' });
  });
  await act(async () => { await test.value().cancel('followup'); });
  expect(test.value().view(message)?.state).toBe('queued');
  expect(test.value().view(message)?.detail).toContain('Cancel was refused');
  expect(test.value().view(message)?.detail).toContain('already starting');
  await act(async () => { await test.value().refresh(); });
  expect(test.value().view(message)?.detail).toContain('Cancel was refused');
  expect(test.client.request.mock.calls.filter(call => call[0] === 'chat.abort')).toEqual([
    ['chat.abort', { sessionKey: 'route', runId: 'followup', discardPendingInput: true }],
  ]);
  expect(test.runRegistry.current.runFor('route')).toBe('predecessor');
  test.client.request.mockResolvedValue(receipt('consumed'));
  await act(async () => { await test.value().refresh(); });
  expect(test.value().view(message)?.state).toBe('consumed'); expect(test.value().view(message)?.detail).toBeUndefined();
  await test.unmount();
});
it('does not hide a lost cancellation acknowledgement behind a fresh queued receipt', async () => {
  const test = harness(); await test.render();
  await act(async () => { await test.value().prepare(request); await test.value().accepted('followup', { runId: 'followup', status: 'started' }); });
  test.client.request.mockImplementation(async method => { if (method === 'chat.history') return receipt(); throw new Error('timeout'); });
  await act(async () => { await test.value().cancel('followup'); });
  expect(test.value().view(message)?.detail).toContain('Cancellation could not be confirmed');
  expect(test.value().view(message)?.state).not.toBe('cancelled');
  expect(test.client.request.mock.calls.filter(call => call[0] === 'chat.abort')).toHaveLength(1);
  await test.unmount();
});
it('keeps cancellation failure visible when an older refresh finishes after the action', async () => {
  const test = harness(); await test.render();
  await act(async () => { await test.value().prepare(request); await test.value().accepted('followup', { runId: 'followup', status: 'started' }); });
  let finish!: (value: unknown) => void;
  test.client.request.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  let refreshing!: Promise<void>; await act(async () => { refreshing = test.value().refresh(); });
  test.client.request.mockImplementation(async method => { if (method === 'chat.history') return receipt(); throw new Error('timeout'); });
  await act(async () => { await test.value().cancel('followup'); });
  await act(async () => { finish(receipt()); await refreshing; });
  expect(test.value().view(message)?.detail).toContain('Cancellation could not be confirmed');
  await test.unmount();
});
it('does not cover a failed cancellation with an earlier accepted Stop status', async () => {
  const test = harness(); await test.render();
  await act(async () => { await test.value().prepare(request); await test.value().accepted('followup', { runId: 'followup', status: 'started' }); });
  test.client.request.mockImplementation(async (method, params) => method === 'chat.history' ? receipt() : { ok: true, aborted: true, runIds: [params!.runId] });
  await act(async () => { await test.value().runNow('followup'); });
  test.client.request.mockImplementation(async method => { if (method === 'chat.history') return receipt(); throw new Error('timeout'); });
  await act(async () => { await test.value().cancel('followup'); });
  expect(test.value().view(message)?.detail).toContain('Cancellation could not be confirmed');
  expect(test.value().view(message)?.canRunNow).toBe(false);
  await test.unmount();
});

it('literal interrupt stops one exact predecessor for multiple confirmed queued messages without replay', async () => {
  const test = harness(); await test.render();
  await act(async () => { await test.value().prepare(request); await test.value().refresh();
    await test.value().prepare({ ...request, runId: 'followup-two', originalSubmissionId: 'original-two', createdAt: 101 }); });
  test.client.request.mockImplementation(async (method, params) => method === 'chat.history'
    ? { sessionKey: 'route', sessionId: 'generation', inputReceipts: [{ runId: (params!.inputRunIds as string[])[0], state: 'pending', queued: true }] }
    : { ok: true, aborted: true, runIds: [params!.runId] });
  await act(async () => { await test.value().refresh(); });
  let result!: { accepted: boolean; detail: string };
  await act(async () => { result = await test.value().interruptQueued({ sessionKey: 'route', sessionId: 'generation', predecessorRunId: 'predecessor' }); });
  expect(result.accepted).toBe(true); expect(result.detail).toContain('in order');
  await act(async () => { await test.value().interruptQueued({ sessionKey: 'route', sessionId: 'generation', predecessorRunId: 'predecessor' }); });
  expect(test.client.request.mock.calls.filter(call => call[0] === 'chat.abort')).toEqual([
    ['chat.abort', { sessionKey: 'route', runId: 'predecessor' }],
  ]);
  expect(test.client.request.mock.calls.some(call => call[0] === 'chat.send')).toBe(false); await test.unmount();
});
it.each(['successor', 'generation', 'foreign', 'unconfirmed', 'consumed'] as const)('literal interrupt fails closed for %s queued context', async change => {
  const test = harness(); await test.render();
  await act(async () => { await test.value().prepare(request); await test.value().refresh(); });
  if (change === 'successor') test.runRegistry.current.registerRun('route', 'successor');
  if (change === 'generation') { test.generation('new'); await test.render(); }
  if (change === 'unconfirmed') test.client.request.mockResolvedValue({});
  if (change === 'consumed') test.client.request.mockResolvedValue(receipt('consumed'));
  let result!: { accepted: boolean; detail: string };
  await act(async () => { result = await test.value().interruptQueued({ sessionKey: change === 'foreign' ? 'other' : 'route', sessionId: 'generation', predecessorRunId: 'predecessor' }); });
  expect(result.accepted).toBe(false);
  expect(test.client.request.mock.calls.some(call => call[0] === 'chat.abort')).toBe(false);
  await test.unmount();
});
it('literal interrupt confirms fresh custody for an accepted message before its first status read returns', async () => {
  const test = harness(); await test.render();
  // The first custody read after acceptance is still in flight when the user
  // replies "interrupt" straight after the accepted notice.
  let releaseFirstRead!: (value: unknown) => void;
  test.client.request.mockImplementationOnce(() => new Promise(resolve => { releaseFirstRead = resolve; }));
  await act(async () => { await test.value().prepare(request); await test.value().accepted('followup', { runId: 'followup', status: 'started' }); });
  expect(test.value().view(message)?.state).toBe('accepted');
  test.client.request.mockImplementation(async (method, params) => method === 'chat.history' ? receipt() : { ok: true, aborted: true, runIds: [params!.runId] });
  let result!: { accepted: boolean; detail: string };
  await act(async () => { result = await test.value().interruptQueued({ sessionKey: 'route', sessionId: 'generation', predecessorRunId: 'predecessor' }); });
  expect(result.accepted).toBe(true);
  expect(test.client.request.mock.calls.filter(call => call[0] === 'chat.abort')).toEqual([['chat.abort', { sessionKey: 'route', runId: 'predecessor' }]]);
  await act(async () => { releaseFirstRead(receipt()); });
  expect(test.client.request.mock.calls.some(call => call[0] === 'chat.send')).toBe(false); await test.unmount();
});
it('literal interrupt keeps an accepted message unconfirmed and stops nothing while custody is not yet visible', async () => {
  const test = harness(); await test.render();
  test.client.request.mockImplementationOnce(() => new Promise(() => {}));
  await act(async () => { await test.value().prepare(request); await test.value().accepted('followup', { runId: 'followup', status: 'started' }); });
  test.client.request.mockResolvedValue({ sessionKey: 'route', sessionId: 'generation', inputReceipts: [] });
  let result!: { accepted: boolean; detail: string };
  await act(async () => { result = await test.value().interruptQueued({ sessionKey: 'route', sessionId: 'generation', predecessorRunId: 'predecessor' }); });
  expect(result.accepted).toBe(false); expect(result.detail).toContain('still being confirmed');
  expect(test.client.request.mock.calls.some(call => call[0] === 'chat.abort' || call[0] === 'chat.send')).toBe(false); await test.unmount();
});
