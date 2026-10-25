// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { OpenClawClient } from './OpenClawClient';
import type { WorkspaceMessage, WorkspaceProject } from '../workspace/workspaceTypes';
import { parsedHistoryReview, serializedHistoryReview } from './persistentHistoryReview';
import { decorateGatewayMedia } from './gatewayMedia';
import { cachedGatewayImageSource } from '../transcript/gatewayImageSource';
const storage = vi.hoisted(() => ({ review: null as string | null }));
vi.mock('../storage/workspaceStore', () => ({
  saveTranscriptCache: async () => {}, loadTranscriptCache: async () => [],
  saveHistoryReviewCache: async () => {}, loadHistoryReviewCache: async () => storage.review,
}));
import { useGatewayHistory } from './useGatewayHistory';
const key = 'agent:fixture:retained-media';
const generation = { sessionId: '00000000-0000-4000-9000-000000000108', sessionStartedAtMs: 1000 };
const project: WorkspaceProject = { id: key, sessionKey: key, name: 'Fixture', path: '', branch: '', starred: false, threadCount: 0, state: 'idle', ...generation };
let root: Root; let owner: ReturnType<typeof useGatewayHistory>;
beforeEach(() => { vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); root = createRoot(document.createElement('div')); });
afterEach(async () => { await act(async () => root.unmount()); vi.unstubAllGlobals(); });

it('rehydrates archived image authorization before publishing an empty-tail fallback after relaunch', async () => {
  const rows: WorkspaceMessage[] = [{ id: 'archive-image', role: 'assistant', text: '', sessionKey: key, source: 'history',
    attachments: [{ id: 'image', filename: 'retained.png', mimeType: 'image/png', uri: 'https://gateway.example/__openclaw__/assistant-media?source=%2Ftmp%2Fretained.png', headers: { Authorization: 'Bearer expired-fixture' } }] }];
  storage.review = serializedHistoryReview({ generation, archive: { identity: { sessionKey: key, currentSessionId: generation.sessionId, currentSessionStartedAtMs: 1000 }, exhausted: true },
    cursor: null, windowMode: 'older', reviewEntryIntent: 'deliberate', historyFailure: null, historyProblem: '' }, rows);
  expect(storage.review).not.toContain('expired-fixture');
  expect(parsedHistoryReview(storage.review)?.messages).toHaveLength(1);
  const client = { status: 'connected', decorateMessages: (messages: WorkspaceMessage[], session: string) => decorateGatewayMedia(messages, 'wss://gateway.example', 'current-fixture', session) } as unknown as OpenClawClient;
  const selected = { current: key };
  function Probe() { owner = useGatewayHistory(client, selected, () => {}); return <div>{owner.messages.length}</div>; }
  await act(async () => root.render(<Probe />));
  await act(async () => owner.resetHistory(project, { capabilities: { archivedSessionFamily: 'archived-family-v1' } }));
  expect(owner.messages).toHaveLength(1);
  expect(owner.messages[0]?.attachments?.[0]?.headers).toEqual({ Authorization: 'Bearer current-fixture', 'x-openclaw-requester-session-key': key });
});

it('restores a legacy encoded image from the older-view cache and loads it through the scoped Gateway', async () => {
  const raw = '/Library/Mobile%20Documents/notes/phone.png';
  const path = '/Library/Mobile Documents/notes/phone.png';
  const rows: WorkspaceMessage[] = [{ id: 'legacy-answer', role: 'assistant', text: `![phone](${raw})`, sessionKey: key, source: 'history',
    attachments: [{ id: 'legacy-image', filename: 'phone', mimeType: 'image/png',
      uri: `https://gateway.example/dashboard/__openclaw__/assistant-media?source=${encodeURIComponent(raw)}` }] }];
  storage.review = serializedHistoryReview({ generation, archive: { identity: { sessionKey: key, currentSessionId: generation.sessionId, currentSessionStartedAtMs: 1000 }, exhausted: true },
    cursor: null, windowMode: 'older', reviewEntryIntent: 'deliberate', historyFailure: null, historyProblem: '' }, rows);
  const client = { status: 'connected', decorateMessages: (messages: WorkspaceMessage[], session: string) => decorateGatewayMedia(messages, 'wss://gateway.example', 'current-fixture', session) } as unknown as OpenClawClient;
  function Probe() { owner = useGatewayHistory(client, { current: key }, () => {}); return <div>{owner.messages.length}</div>; }
  await act(async () => root.render(<Probe />));
  await act(async () => owner.resetHistory(project, { capabilities: { archivedSessionFamily: 'archived-family-v1' } }));
  const attachment = owner.messages[0]!.attachments![0]!;
  const requests: URL[] = [];
  vi.stubGlobal('fetch', vi.fn(async (input: string) => {
    const url = new URL(input); requests.push(url);
    expect(url.searchParams.get('source')).toBe(path);
    expect(url.searchParams.get('sessionKey')).toBe(key);
    return url.searchParams.get('meta') === '1'
      ? Response.json({ available: true, mediaTicket: 'fixture-ticket' })
      : new Response(new Uint8Array([137, 80, 78, 71]));
  }));
  expect(await cachedGatewayImageSource(attachment)).toEqual({ uri: 'data:image/png;base64,iVBORw==' });
  expect(requests).toHaveLength(2);
  expect(owner.messages[0]?.id).toBe('legacy-answer');
});
