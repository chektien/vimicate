// @vitest-environment jsdom
import React, { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useGatewayHistory } from './useGatewayHistory';
import { SharedNarrationHydration } from './sharedNarrationHydration';
import type { OpenClawClient } from './OpenClawClient';
import type { WorkspaceProject } from '../workspace/workspaceTypes';
vi.mock('../storage/workspaceStore', () => ({ saveTranscriptCache: async () => {}, loadTranscriptCache: async () => [],
  saveHistoryReviewCache: async () => {}, loadHistoryReviewCache: async () => null }));
const sessionKey = 'agent:main:direct:synthetic';
const sessionId = '00000000-0000-4000-b000-000000000126';
const registry = { capabilities: { sharedNarration: 'shared-narration-v1' } };
const project: WorkspaceProject = { id: sessionKey, sessionKey, sessionId, name: 'Synthetic', path: '', branch: 'main',
  starred: false, threadCount: 1, state: 'running' };
const selected = { current: sessionKey };
const page = { contract: 'shared-narration-v1', stableSessionKey: sessionKey, sessionId, snapshotToken: 'A'.repeat(43),
  cursor: 0, totalRecords: 1, hasMore: false, records: [{ runId: 'r', itemId: 'pre', text: 'checking',
    firstSequence: 1, lastSequence: 1, firstTimestampMs: 100, lastTimestampMs: 100, revision: 1 }] };
let root: Root; let node: HTMLDivElement; let owner: ReturnType<typeof useGatewayHistory>;
let detail: string; let setDetail: React.Dispatch<React.SetStateAction<string>>;
beforeEach(() => {
  selected.current = sessionKey;
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  node = document.createElement('div'); document.body.append(node); root = createRoot(node);
});
afterEach(async () => { await act(async () => root.unmount()); node.remove(); vi.unstubAllGlobals(); });
async function mount(sharedNarrationRequest: ReturnType<typeof vi.fn>, extra: Partial<OpenClawClient> = {}) {
  const client = { status: 'connected', sharedNarrationRequest, ...extra } as unknown as OpenClawClient;
  function Probe() {
    [detail, setDetail] = useState('connected');
    owner = useGatewayHistory(client, selected, setDetail, sessionKey);
    return null;
  }
  await act(async () => { root.render(<Probe />); });
  await act(async () => { owner.configureArchive(project, registry); });
}

it('coalesces overlapping live hydrations at the actual mounted history owner', async () => {
  let resolve!: (value: typeof page) => void;
  const request = vi.fn(() => new Promise<typeof page>(done => { resolve = done; }));
  await mount(request);
  let first!: Promise<void>; let second!: Promise<void>;
  await act(async () => { first = owner.refreshSharedNarration(sessionKey); second = owner.refreshSharedNarration(sessionKey); });
  expect(request).toHaveBeenCalledTimes(1);
  await act(async () => { resolve(page); await Promise.all([first, second]); });
  expect(owner.messages.filter(row => row.role === 'narration')).toHaveLength(1);
});

it.each([false, true])('clears only its own recovered warning, preserving a newer unrelated error=%s', async (unrelated) => {
  const request = vi.fn().mockRejectedValueOnce(new Error('permission denied')).mockResolvedValue(page);
  await mount(request);
  await act(async () => { await owner.refreshSharedNarration(sessionKey); });
  expect(detail).toBe('shared narration unavailable: permission denied');
  if (unrelated) await act(async () => { setDetail('send failed'); });
  await act(async () => { await owner.refreshSharedNarration(sessionKey); });
  expect(detail).toBe(unrelated ? 'send failed' : '');
});

it('keeps the last validated supplement on a real failure but reports that failure', async () => {
  const request = vi.fn().mockResolvedValueOnce(page).mockRejectedValue(new Error('permission denied'));
  await mount(request);
  await act(async () => { await owner.refreshSharedNarration(sessionKey); await owner.refreshSharedNarration(sessionKey); });
  expect(owner.messages.filter(row => row.role === 'narration')).toHaveLength(1);
  expect(detail).toBe('shared narration unavailable: permission denied');
});

it('ignores a failed old-generation hydration after generation replacement', async () => {
  let reject!: (error: Error) => void;
  const request = vi.fn(() => new Promise<typeof page>((_, fail) => { reject = fail; }));
  await mount(request);
  let loading!: Promise<void>;
  await act(async () => { loading = owner.refreshSharedNarration(sessionKey); });
  await act(async () => { owner.configureArchive({ ...project, sessionId: '33333333-3333-4333-8333-333333333333' }, registry); });
  await act(async () => { reject(new Error('old generation failure')); await loading; });
  expect(detail).toBe('connected');
  expect(owner.messages.filter(row => row.role === 'narration')).toHaveLength(0);
});

it('retires pagination on suspension and admits a fresh hydration after resume', async () => {
  let resolve!: (value: typeof page) => void;
  const request = vi.fn().mockImplementationOnce(() => new Promise<typeof page>(done => { resolve = done; }))
    .mockResolvedValue(page);
  await mount(request);
  let loading!: Promise<void>;
  await act(async () => { loading = owner.refreshSharedNarration(sessionKey); });
  await act(async () => { owner.suspendHistoryPublication(); });
  await act(async () => { owner.resumeHistoryPublication(); await owner.refreshSharedNarration(sessionKey); });
  await act(async () => {
    resolve({ ...page, totalRecords: 2, hasMore: true, nextCursor: 1 } as typeof page);
    await loading;
  });
  expect(request).toHaveBeenCalledTimes(2);
  expect(owner.messages.filter(row => row.role === 'narration')).toHaveLength(1);
  expect(detail).toBe('connected');
});

it('retires pagination on unmount rather than continuing detached page requests', async () => {
  let resolve!: (value: typeof page) => void;
  const request = vi.fn(() => new Promise<typeof page>(done => { resolve = done; }));
  await mount(request);
  let loading!: Promise<void>;
  await act(async () => { loading = owner.refreshSharedNarration(sessionKey); });
  await act(async () => { root.unmount(); });
  resolve({ ...page, totalRecords: 2, hasMore: true, nextCursor: 1 } as typeof page);
  await loading;
  expect(request).toHaveBeenCalledTimes(1);
});

it('drops the validated supplement when the concrete generation changes', async () => {
  const request = vi.fn().mockResolvedValueOnce(page).mockRejectedValue(new Error('new generation unavailable'));
  await mount(request);
  await act(async () => { await owner.refreshSharedNarration(sessionKey); });
  await act(async () => {
    owner.configureArchive({ ...project, sessionId: '33333333-3333-4333-8333-333333333333', sessionStartedAtMs: 200_000 }, registry);
    await owner.refreshSharedNarration(sessionKey);
  });
  expect(owner.messages.filter(row => row.role === 'narration')).toHaveLength(0);
  expect(detail).toBe('shared narration unavailable: new generation unavailable');
});

it.each(['live refresh', 'latest history'] as const)('requires a fresh snapshot for a later %s', async (caller) => {
  let resolve!: (value: typeof page) => void;
  const order: string[] = [];
  const newer = { ...page, totalRecords: 2, records: [...page.records, { ...page.records[0]!,
    itemId: 'pre2', text: 'new context', firstSequence: 2, lastSequence: 2, firstTimestampMs: 200, lastTimestampMs: 200 }] };
  const request = vi.fn().mockImplementationOnce(() => {
    order.push('old snapshot');
    return new Promise<typeof page>(done => { resolve = done; });
  }).mockImplementation(async () => { order.push('fresh snapshot'); return newer; });
  await mount(request, { followSession: vi.fn(async () => { order.push('followSession'); }),
    history: vi.fn(async () => ({ messages: [], hasMore: false, totalMessages: 0 })),
    decorateMessages: vi.fn(rows => rows) });
  let first!: Promise<void>; let later!: Promise<unknown>; let burst!: Promise<void>;
  await act(async () => { first = owner.refreshSharedNarration(sessionKey); });
  await act(async () => {
    later = caller === 'live refresh' ? owner.refreshSharedNarration(sessionKey) : owner.loadHistory(sessionKey);
  });
  await act(async () => { burst = owner.refreshSharedNarration(sessionKey); });
  expect(request).toHaveBeenCalledTimes(1);
  await act(async () => { resolve(page); await Promise.all([first, later, burst]); });
  expect(request).toHaveBeenCalledTimes(2);
  expect(order).toEqual(caller === 'latest history'
    ? ['old snapshot', 'followSession', 'fresh snapshot'] : ['old snapshot', 'fresh snapshot']);
  expect(owner.messages.filter(row => row.role === 'narration').map(row => row.text)).toEqual(['checking', 'new context']);
});

it('cannot let an old-generation response replace a newer validated supplement', async () => {
  let resolve!: (value: typeof page) => void;
  const replacement = { ...page, sessionId: '33333333-3333-4333-8333-333333333333',
    records: page.records.map(record => ({ ...record, text: 'replacement', firstTimestampMs: 300_000, lastTimestampMs: 300_000 })) };
  const request = vi.fn().mockImplementationOnce(() => new Promise<typeof page>(done => { resolve = done; }))
    .mockResolvedValueOnce(replacement).mockRejectedValue(new Error('permission denied'));
  await mount(request);
  let old!: Promise<void>;
  await act(async () => { old = owner.refreshSharedNarration(sessionKey); });
  await act(async () => {
    owner.configureArchive({ ...project, sessionId: replacement.sessionId, sessionStartedAtMs: 200_000 }, registry);
    await owner.refreshSharedNarration(sessionKey);
    resolve(page); await old;
    await owner.refreshSharedNarration(sessionKey);
  });
  expect(owner.messages.filter(row => row.role === 'narration').map(row => row.text)).toEqual(['replacement']);
  expect(detail).toBe('shared narration unavailable: permission denied');
});

it.each(['suspend', 'generation', 'unmount'] as const)('retires a queued trailing read on %s', async (retirement) => {
  let resolve!: (value: typeof page) => void;
  const request = vi.fn(() => new Promise<typeof page>(done => { resolve = done; }));
  await mount(request);
  let first!: Promise<void>; let trailing!: Promise<void>;
  await act(async () => { first = owner.refreshSharedNarration(sessionKey); });
  await act(async () => { trailing = owner.refreshSharedNarration(sessionKey); });
  await act(async () => {
    if (retirement === 'suspend') owner.suspendHistoryPublication();
    else if (retirement === 'unmount') root.unmount();
    else owner.configureArchive({ ...project, sessionId: '33333333-3333-4333-8333-333333333333' }, registry);
    resolve(page); await Promise.all([first, trailing]);
  });
  expect(request).toHaveBeenCalledTimes(1);
  expect(detail).toBe('connected');
});

it('runs the requested trailing read even when the earlier snapshot fails', async () => {
  let reject!: (error: Error) => void;
  const request = vi.fn().mockImplementationOnce(() => new Promise<typeof page>((_, fail) => { reject = fail; }))
    .mockResolvedValue(page);
  await mount(request);
  let first!: Promise<void>; let trailing!: Promise<void>;
  await act(async () => { first = owner.refreshSharedNarration(sessionKey); });
  await act(async () => { trailing = owner.refreshSharedNarration(sessionKey); });
  await act(async () => { reject(new Error('temporary failure')); await Promise.all([first, trailing]); });
  expect(request).toHaveBeenCalledTimes(2);
  expect(owner.messages.filter(row => row.role === 'narration').map(row => row.text)).toEqual(['checking']);
  expect(detail).toBe('');
});

it('owns retirement between a failed snapshot settling and its trailing read starting', async () => {
  const hydration = new SharedNarrationHydration();
  const state = { sessionKey, sessionId }; hydration.configure(state);
  let reject!: (error: Error) => void;
  const sharedNarrationRequest = vi.fn().mockImplementationOnce(() => new Promise<typeof page>((_, fail) => { reject = fail; }))
    .mockResolvedValue(page);
  const transport = { sharedNarrationRequest };
  // The first consumer retires this owner while handling its failed result.
  const first = hydration.hydrate(transport, state, () => true, () => hydration.retire());
  await Promise.resolve();
  const trailing = hydration.hydrate(transport, state, () => true, () => {});
  reject(new Error('failure')); await Promise.all([first, trailing]);
  expect(sharedNarrationRequest).toHaveBeenCalledTimes(1);
});

it('retires same-turn reads before snapshot admission and permits a fresh resume', async () => {
  const request = vi.fn().mockResolvedValue(page);
  await mount(request);
  await act(async () => {
    const loading = owner.refreshSharedNarration(sessionKey);
    owner.suspendHistoryPublication(); await loading;
  });
  expect(request).not.toHaveBeenCalled();
  await act(async () => { owner.resumeHistoryPublication(); await owner.refreshSharedNarration(sessionKey); });
  expect(request).toHaveBeenCalledTimes(1);
  expect(owner.messages.filter(row => row.role === 'narration')).toHaveLength(1);
});
