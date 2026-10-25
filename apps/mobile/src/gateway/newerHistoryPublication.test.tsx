// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { OpenClawClient } from './OpenClawClient';
import type { WorkspaceMessage, WorkspaceProject } from '../workspace/workspaceTypes';
vi.mock('../storage/workspaceStore', () => ({ saveTranscriptCache: async () => {}, loadTranscriptCache: async () => [],
  saveHistoryReviewCache: async () => {}, loadHistoryReviewCache: async () => null }));
import { useGatewayHistory } from './useGatewayHistory';
let root: Root; let node: HTMLDivElement; let owner: ReturnType<typeof useGatewayHistory>;
const key = 'thread'; const selected = { current: key };
const project: WorkspaceProject = { id: key, sessionKey: key, name: '', path: '', branch: '', starred: false, threadCount: 0, state: 'idle' };
beforeEach(() => { vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); selected.current = key;
  node = document.createElement('div'); document.body.append(node); root = createRoot(node); });
afterEach(async () => { await act(async () => root.unmount()); node.remove(); vi.unstubAllGlobals(); });
it.each(['switch', 'suspend', 'submission'] as const)('retires a newer raw interval before %s can receive it', async (action) => {
  let release!: () => void; let delayed = false;
  const rows = Array.from({ length: 400 }, (_, index) => ({ id: `r${index}`, role: 'user', content: `${index}`, timestamp: 1800000000000 + index }));
  const client = { status: 'connected', followSession: async () => {}, decorateMessages: (messages: WorkspaceMessage[]) => messages,
    history: async (_key: string, limit: number, offset: number) => {
      if (delayed) { delayed = false; await new Promise<void>(resolve => { release = resolve; }); }
      return { sessionKey: key, totalMessages: rows.length, hasMore: offset + limit < rows.length,
        nextOffset: offset + limit < rows.length ? offset + limit : null,
        messages: rows.slice(Math.max(0, rows.length - offset - limit), rows.length - offset) };
    } } as unknown as OpenClawClient;
  function Probe() { owner = useGatewayHistory(client, selected, () => {}, key); return <div />; }
  await act(async () => { root.render(<Probe />); });
  await act(async () => { owner.resetHistory(project, null); await owner.loadHistory(key); });
  await act(async () => { await owner.loadOlderHistory(); });
  const before = owner.messages.map(row => row.id); const hiddenTail = owner.latestMessages.map(row => row.id);
  delayed = true;
  await act(async () => {
    const pending = owner.loadNewerHistory();
    if (action === 'switch') { selected.current = 'other'; owner.resetHistory({ ...project, id: 'other', sessionKey: 'other' }, null); }
    if (action === 'suspend') owner.suspendHistoryPublication();
    if (action === 'submission') owner.preparePromptSubmission(key);
    release(); await pending;
  });
  expect(owner.messages.map(row => row.id)).toEqual(action === 'switch' ? [] : action === 'submission' ? hiddenTail : before);
});
