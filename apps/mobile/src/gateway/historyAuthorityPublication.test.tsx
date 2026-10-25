// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { OpenClawClient } from './OpenClawClient';
import type { WorkspaceMessage } from '../workspace/workspaceTypes';
import type { LatestHistoryActionsContext } from './latestHistoryLoading';

vi.mock('../storage/workspaceStore', () => ({ saveTranscriptCache: async () => {}, loadTranscriptCache: async () => [],
  saveHistoryReviewCache: async () => {}, loadHistoryReviewCache: async () => null }));
let publish: LatestHistoryActionsContext['setHistoryMessages'];
// Capture the real hook boundary supplied to the transport owner; preserve
// its real implementation and avoid a production test API.
vi.mock('./latestHistoryLoading', async (original) => {
  const module = await original<typeof import('./latestHistoryLoading')>();
  return { ...module, createLatestHistoryActions(context: LatestHistoryActionsContext) {
    publish = context.setHistoryMessages;
    return module.createLatestHistoryActions(context);
  } };
});
import { useGatewayHistory } from './useGatewayHistory';
let root: Root; let node: HTMLDivElement; let owner: ReturnType<typeof useGatewayHistory>;
const selected = { current: 's' };
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  node = document.createElement('div'); document.body.append(node); root = createRoot(node);
});
afterEach(async () => { await act(async () => root.unmount()); node.remove(); vi.unstubAllGlobals(); });

it.each(['chatCumulativeText', 'claudeNativeFullText', 'terminalReplyText'] as const)(
  'keeps newer %s through history publication and its session caches', async (field) => {
    const client = { status: 'connected' } as OpenClawClient;
    function Probe() { owner = useGatewayHistory(client, selected, () => {}, 's'); return <div />; }
    await act(async () => { root.render(<Probe />); });
    const before: WorkspaceMessage = { id: field === 'terminalReplyText' ? 'live-run-r' : 'live-chat-r',
      role: field === 'terminalReplyText' ? 'run' : 'assistant', source: 'live', state: 'complete',
      sessionKey: 's', runId: 'r', text: 'answer', [field]: 'first\n\nanswer' };
    const after = { ...before, [field]: 'second\n\nanswer' };
    await act(async () => { publish('s', [before], 'latest', () => true); });
    await act(async () => { publish('s', [after], 'latest', () => true); });
    expect(owner.messages[0]?.[field]).toBe(after[field]);
    expect(owner.latestMessages[0]?.[field]).toBe(after[field]);
    expect(owner.sessionMessages('s')[0]?.[field]).toBe(after[field]);
    const unchanged = owner.messages;
    await act(async () => { publish('s', [{ ...after }], 'latest', () => true); });
    expect(owner.messages).toBe(unchanged);
  },
);
