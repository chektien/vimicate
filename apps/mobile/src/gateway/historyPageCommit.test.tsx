// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { OpenClawClient } from './OpenClawClient';
import type { WorkspaceMessage, WorkspaceProject } from '../workspace/workspaceTypes';
vi.mock('../storage/workspaceStore', () => ({
  saveTranscriptCache: async () => {}, loadTranscriptCache: async () => [],
  saveHistoryReviewCache: async () => {}, loadHistoryReviewCache: async () => null,
}));
import { useGatewayHistory } from './useGatewayHistory';

const key = 'agent:fixture:history';
let root: Root;
let node: HTMLDivElement;
let owner: ReturnType<typeof useGatewayHistory>;
const selected = { current: key };
const project: WorkspaceProject = { id: key, sessionKey: key, name: 'History fixture', path: '', branch: '', starred: false, threadCount: 0, state: 'idle' };
const page = (id: string, nextOffset: number) => ({ sessionKey: key, hasMore: id === 'tail', nextOffset, totalMessages: 500,
  messages: [{ id, role: 'user', content: id, timestamp: id === 'tail' ? 500 : 100 }] });
function mount(client: OpenClawClient) {
  function Probe() { owner = useGatewayHistory(client, selected, () => {}, key); return <div>{owner.messages.map(row => row.id).join(',')}</div>; }
  return act(async () => root.render(<Probe />));
}
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  selected.current = key;
  node = document.createElement('div'); document.body.append(node); root = createRoot(node);
});
afterEach(async () => { await act(async () => root.unmount()); node.remove(); vi.unstubAllGlobals(); });

it.each(['refresh', 'submission', 'switch', 'suspend'] as const)('keeps page publication consistent with a queued %s before React drains updates', async (next) => {
  let finishOlder!: (value: ReturnType<typeof page>) => void;
  const history = vi.fn((_key: string, _limit: number, offset: number) => offset === 0
    ? Promise.resolve(page('tail', 80))
    : new Promise<ReturnType<typeof page>>(resolve => { finishOlder = resolve; }));
  const client = { status: 'connected', history, followSession: async () => {}, decorateMessages: (rows: WorkspaceMessage[]) => rows } as unknown as OpenClawClient;
  await mount(client);
  await act(async () => { owner.resetHistory(project, null); await owner.loadHistory(key); });
  expect(owner.messages.map(row => row.id)).toContain('tail');
  await act(async () => {
    const request = owner.loadOlderHistory();
    if (next === 'refresh') await owner.loadHistory(key); // deferred behind older transport
    finishOlder(page('older-page', 160));
    await request;
    if (next === 'submission') owner.preparePromptSubmission(key);
    if (next === 'switch') { selected.current = 'other'; owner.resetHistory({ ...project, sessionKey: 'other' }, null); }
    if (next === 'suspend') owner.suspendHistoryPublication();
  });
  expect(history.mock.calls.map(call => call[2])).toEqual(next === 'refresh' ? [0, 80, 0] : [0, 80]);
  if (['submission', 'switch', 'suspend'].includes(next)) { expect(owner.messages.map(row => row.id)).not.toContain('older-page'); return; }
  expect(owner.messages.map(row => row.id)).toContain('older-page');
  expect(owner.visibleSessionMessages(key).map(row => row.id)).toContain('older-page');
  expect(owner.sessionMessages(key).map(row => row.id)).not.toContain('older-page');
});


it('retains the reviewed boundary when one transport page exceeds the presentation budget', async () => {
  const time = 1_788_000_000_000;
  const oldRows = Array.from({ length: 6 }, (_, index) => ({ id: `large-page-${index}`, role: 'assistant',
    content: Array.from({ length: 100 }, (_, line) => `page ${index} line ${line}`).join('\n'), timestamp: time + index }));
  const history = vi.fn(async (_key: string, limit: number, offset: number) => offset === 0
    ? { sessionKey: key, hasMore: true, nextOffset: 80, totalMessages: 1000,
      messages: [{ id: 'review-boundary', role: 'user', content: 'the row being read', timestamp: time + 100 }] }
    : { sessionKey: key, hasMore: offset + limit < 86, nextOffset: offset + limit < 86 ? offset + limit : null, totalMessages: 1000,
      messages: oldRows.slice(Math.max(0, 6 - (offset - 80) - limit), 6 - (offset - 80)) });
  const client = { status: 'connected', history, followSession: async () => {}, decorateMessages: (rows: WorkspaceMessage[]) => rows } as unknown as OpenClawClient;
  await mount(client);
  await act(async () => { owner.resetHistory(project, null); await owner.loadHistory(key); });
  await act(async () => { await owner.loadOlderHistory(); });
  expect(owner.messages.map(row => row.id)).toContain('review-boundary');
  expect(owner.messages.some(row => row.id.startsWith('large-page-'))).toBe(true);
  const seen = new Set(owner.messages.map(row => row.id));
  for (let pageIndex = 0; pageIndex < 2; pageIndex += 1) {
    const boundary = owner.messages[0]!.id;
    await act(async () => { await owner.loadOlderHistory(); });
    expect(owner.messages.map(row => row.id)).toContain(boundary);
    owner.messages.forEach(row => seen.add(row.id));
  }
  expect([...seen]).toEqual(expect.arrayContaining(oldRows.map(row => row.id)));
  expect(owner.canLoadOlder).toBe(false);
  expect(history.mock.calls.some(([, limit, offset]) => offset === 80 && limit >= 2)).toBe(true);
});

it.each([[20, 100], [48, 19]])('keeps all %i records reachable when %i-line replies overflow the initial display budget', async (count, lines) => {
  const time = 1_788_000_000_000;
  const raw = Array.from({ length: count }, (_, i) => ({ id: `initial-${i}`, role: i % 2 ? 'assistant' : 'user',
    content: i % 2 ? Array.from({ length: lines }, (_, line) => `response ${i} line ${line}`).join('\n') : `prompt ${i}`,
    timestamp: time + i }));
  const history = vi.fn(async (_key: string, limit: number, offset: number) => {
    const end = Math.max(0, raw.length - offset); const rows = raw.slice(Math.max(0, end - limit), end);
    const next = offset + rows.length;
    return { sessionKey: key, messages: rows, totalMessages: raw.length, offset, hasMore: next < raw.length, nextOffset: next < raw.length ? next : null };
  });
  const client = { status: 'connected', history, followSession: async () => {}, decorateMessages: (rows: WorkspaceMessage[]) => rows } as unknown as OpenClawClient;
  await mount(client);
  await act(async () => { owner.resetHistory(project, null); await owner.loadHistory(key); });
  const seen = new Set(owner.messages.map(row => row.id));
  expect(owner.canLoadOlder).toBe(true);
  for (let attempt = 0; owner.canLoadOlder && attempt < 30; attempt++) {
    await act(async () => { await owner.loadOlderHistory(); });
    owner.messages.forEach(row => seen.add(row.id));
  }
  expect(owner.canLoadOlder).toBe(false);
  expect([...seen].filter(id => id.startsWith('initial-')).sort()).toEqual(raw.map(row => row.id).sort());
  await act(async () => { await owner.restoreLatestHistory(); });
  expect(owner.messages.filter(row => row.role !== 'run').at(-1)?.id).toBe(`initial-${count - 1}`);
  expect(owner.canLoadOlder).toBe(true);
});

it('returns a publication receipt that remains pending until the queued older page commits', async () => {
  const history = vi.fn(async (_key: string, _limit: number, offset: number) => page(offset ? 'older' : 'tail', offset + 80));
  const client = { status: 'connected', history, followSession: async () => {}, decorateMessages: (rows: WorkspaceMessage[]) => rows } as unknown as OpenClawClient;
  await mount(client);
  await act(async () => { owner.resetHistory(project, null); await owner.loadHistory(key); });
  let receipt!: NonNullable<Awaited<ReturnType<typeof owner.loadOlderHistory>>>;
  let settled = false;
  await act(async () => {
    receipt = (await owner.loadOlderHistory())!;
    void receipt.publication.then(() => { settled = true; });
    await Promise.resolve();
    expect(settled).toBe(false);
  });
  expect(owner.messages.map(row => row.id)).toContain('older');
  await expect(receipt.publication).resolves.toEqual({ committed: true, published: true, addedMessageCount: 1, addedVisibleRowCount: 1 });
});

it('loads toward eighty new rendered rows through collapsed tool-heavy current pages without skipping offsets', async () => {
  const raw = Array.from({ length: 801 }, (_, index) => ({
    id: `history-${index}`, role: index % 10 === 0 ? 'assistant' : 'tool',
    content: `entry ${index}`, timestamp: 1_800_000_000_000 + index,
  }));
  const history = vi.fn(async (_key: string, limit: number, offset: number) => {
    const end = raw.length - offset;
    const messages = raw.slice(Math.max(0, end - limit), end);
    const next = offset + messages.length;
    return { sessionKey: key, messages, totalMessages: raw.length,
      hasMore: next < raw.length, nextOffset: next < raw.length ? next : null };
  });
  const client = { status: 'connected', history, followSession: async () => {}, decorateMessages: (rows: WorkspaceMessage[]) => rows } as unknown as OpenClawClient;
  await mount(client);
  await act(async () => { owner.resetHistory(project, null); await owner.loadHistory(key); });
  const initial = owner.messages.map(row => row.id);
  await act(async () => { await owner.loadOlderHistory(); });
  expect(history.mock.calls.filter(([, , offset]) => offset > 0).length).toBeGreaterThan(1);
  expect(owner.messages.length).toBeGreaterThan(initial.length + 80);
  expect(new Set(owner.messages.map(row => row.id)).size).toBe(owner.messages.length);
  const offsets = history.mock.calls.map(([, limit, offset]) => ({ limit, offset })).filter(call => call.offset > 0);
  expect(offsets[0]?.offset).toBe(80);
  for (let index = 1; index < offsets.length; index++) expect(offsets[index]!.offset).toBe(offsets[index - 1]!.offset + offsets[index - 1]!.limit);
});

it('publishes an accepted partial batch and resumes from its exact cursor after a later page fails', async () => {
  let fail = true;
  const history = vi.fn(async (_key: string, _limit: number, offset: number) => {
    if (!offset) return page('tail', 80);
    if (offset === 80) return { sessionKey: key, messages: [{ id: 'older-one', role: 'assistant', content: 'one' }],
      hasMore: true, nextOffset: 81, totalMessages: 100 };
    if (fail) throw new Error('temporary page failure');
    return { sessionKey: key, messages: [{ id: 'older-two', role: 'assistant', content: 'two' }],
      hasMore: false, nextOffset: null, totalMessages: 100 };
  });
  const client = { status: 'connected', history, followSession: async () => {}, decorateMessages: (rows: WorkspaceMessage[]) => rows } as unknown as OpenClawClient;
  await mount(client);
  await act(async () => { owner.resetHistory(project, null); await owner.loadHistory(key); await owner.loadOlderHistory(); });
  expect(owner.messages.map(row => row.id)).toContain('older-one');
  expect(owner.historyProblem).toBe('temporary page failure');
  fail = false;
  await act(async () => { await owner.retryHistory(); });
  expect(owner.messages.slice(0, 2).map(row => row.id)).toEqual(['older-two', 'older-one']);
  expect(owner.messages.filter(row => row.id === 'older-one')).toHaveLength(1);
  expect(history.mock.calls.map(call => call[2])).toEqual([0, 80, 81, 81]);
  expect(owner.canLoadOlder).toBe(false);
});
