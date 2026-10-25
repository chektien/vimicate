// @vitest-environment jsdom
import React, { act, useLayoutEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { WorkspaceMessage } from '../workspace/workspaceTypes';
const probe = vi.hoisted(() => ({
  listeners: new Set<(state: string) => void>(),
  client: null as null | { status: string; connectionRevision: number; onEvent: (event: unknown) => void; onStatus: (status: string) => void },
  census: vi.fn<() => Promise<Record<string, unknown>>>(), registry: vi.fn<() => Promise<Record<string, unknown>>>(),
  cached: null as null | ((key: string) => WorkspaceMessage[]),
  truth: vi.fn<(key: string) => Promise<Record<string, unknown>>>(), patches: vi.fn(), patchGate: null as null | Promise<void>, history: vi.fn<(key: string) => Promise<Record<string, unknown>>>(), rows: [] as Record<string, unknown>[],
}));
vi.mock('react-native', () => ({ AppState: { currentState: 'active', addEventListener: (_: string, listener: (state: string) => void) => {
  probe.listeners.add(listener); return { remove: () => probe.listeners.delete(listener) };
} } }));
vi.mock('expo-secure-store', () => ({ getItemAsync: async () => null, setItemAsync: async () => {}, deleteItemAsync: async () => {} }));
vi.mock('expo-crypto', () => ({ randomUUID: () => 'fixture' }));
vi.mock('../../modules/vimicate-diagnostics', () => ({ latestFatalDiagnostic: () => null, recentViewportDiagnostics: () => [] }));
vi.mock('./deviceIdentity', () => ({ resetLocalDeviceIdentityIfSimulator: async () => {} }));
vi.mock('./sharedPairing', () => ({ loadSharedGatewayProfile: async () => null, saveSharedPairedProfile: async () => {}, reattachSharedPairing: async () => {}, detachSharedPairing: async () => {} }));
vi.mock('../storage/workspaceStore', () => ({
  loadValue: async () => null, saveValue: async () => {}, setWorkspacePersistenceActive: () => {},
  saveTranscriptCache: async () => {}, loadTranscriptCache: async () => null,
  saveHistoryReviewCache: async () => {}, loadHistoryReviewCache: async () => null,
}));
vi.mock('./OpenClawClient', () => ({ OpenClawClient: class {
  status = 'idle'; connectionRevision = 0; onStatus = (_: string) => {}; onEvent = (_: unknown) => {};
  constructor() { probe.client = this; }
  async connect() { this.connectionRevision++; this.status = 'connected'; this.onStatus('connected'); }
  disconnect() { this.connectionRevision++; this.status = 'idle'; this.onStatus('idle'); }
  hasOperatorScope() { return true; }
  listSessions() { return probe.census(); } readRegistry() { return probe.registry(); }
  readSessionRunTruth(key: string) { return probe.truth(key); }
  async request(method: string, params: Record<string, unknown>) {
    if (method === 'question.list') return { questions: [] };
    if (method !== 'sessions.patch') return {};
    probe.patches(params);
    if (probe.patchGate) await probe.patchGate;
    const row = probe.rows.find(row => row.key === params.key)!;
    if ((row.markedUnreadAt ?? null) !== params.expectedMarkedUnreadAt) return { applied: false };
    row.unread = false; delete row.markedUnreadAt; return { applied: true };
  }
  async listCommands() { return { commands: [] }; } async listModels() { return { models: [] }; }
  async listApprovals() { return { approvals: [] }; } async providerUsage() { return {}; }
  async followSession() {} history(key: string) { return probe.history(key); }
  decorateMessages(messages: WorkspaceMessage[]) { return messages; }
} }));
// Observe the real history owner's parked cache without changing its behavior.
vi.mock('./useGatewayHistory', async original => {
  const actual = await original<typeof import('./useGatewayHistory')>();
  return { ...actual, useGatewayHistory: (...args: Parameters<typeof actual.useGatewayHistory>) => {
    const owner = actual.useGatewayHistory(...args); probe.cached = owner.sessionMessages; return owner;
  } };
});
import { useGatewayWorkspace } from './useGatewayWorkspace';
import type { GatewayFrame } from './gatewayEvents';
const now = 1_800_000_000_000;
const generations = { a: '00000000-0000-4000-8000-000000000001', b: '00000000-0000-4000-8000-000000000002' };
let root: Root;
let gateway: ReturnType<typeof useGatewayWorkspace>;
type Commit = { session: string; rows: { id: string; question?: string; state?: string }[] };
let commits: Commit[];
const drain = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };
const prompt = (key: string) => ({ id: `${key}-prompt`, role: 'user', runId: 'run', content: 'Review request', timestamp: now - 100 });
const registry = () => ({ projects: { markdown: ['a', 'b'].map(key => `## ${key}\n- id: ${key}\n- backend: openclaw\n- session: ${key}`).join('\n') }, threads: { json: '{"threads":[]}' } });
const review = (key = 'a', rich = false, later = false): GatewayFrame => ({ type: 'event', event: 'chat', payload: {
  sessionKey: key, sessionId: generations[key as keyof typeof generations], runId: 'run', state: 'delta',
  ...(later ? { timestamp: now + 200 } : {}), message: { role: 'assistant', content: rich ? 'Review '.repeat(2400) : 'Already arrived review' },
} });
const question = (key = 'a', id = 'decision'): GatewayFrame => ({ type: 'event', event: 'question.requested', payload: {
  id, sessionKey: key, runId: 'run', createdAtMs: now + 50, expiresAtMs: now + 90000, status: 'pending',
  questions: [{ questionId: 'pick', header: 'Review', question: 'Choose?', options: [{ label: 'A' }, { label: 'B' }] }],
} });
const emit = async (frame: GatewayFrame) => act(async () => { probe.client!.onEvent(frame); await drain(); });
const advance = async (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); await drain(); });
const ids = () => gateway.messages.map(row => row.id);
const questionID = (key = 'a', id = 'decision') => `question:${key}:${id}`;
const reviewID = 'live-chat-run';
const assertNoMissingReview = () => {
  const questionCommits = commits.filter(commit => commit.session === 'a' && commit.rows.some(row => row.id === questionID()));
  expect(questionCommits.length).toBeGreaterThan(0);
  expect.soft(questionCommits.filter(commit => !commit.rows.some(row => row.id === reviewID))).toEqual([]);
};
beforeEach(async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); vi.useFakeTimers(); vi.setSystemTime(now); commits = [];
  probe.rows = ['a', 'b'].map(key => ({ key, sessionId: generations[key as keyof typeof generations], unread: false, hasActiveRun: false, lastActivityAt: now - 100 }));
  probe.census.mockReset().mockImplementation(async () => ({ sessions: probe.rows.map(row => ({ ...row })) }));
  probe.registry.mockReset().mockImplementation(async () => registry());
  probe.truth.mockReset().mockImplementation(async key => ({ session: probe.rows.find(row => row.key === key) }));
  probe.patches.mockClear(); probe.patchGate = null;
  probe.history.mockReset().mockImplementation(async key => ({ sessionKey: key, sessionId: probe.rows.find(row => row.key === key)?.sessionId, messages: [prompt(key)] }));
  function Component() {
    gateway = useGatewayWorkspace({ restorePersisted: false });
    // No dependency array and no de-duplication. Capture EVERY committed projection,
    // including a possible high-priority question before a transition's live rows.
    useLayoutEffect(() => { commits.push({ session: gateway.messageSessionKey, rows: gateway.messages.map(row => ({ id: row.id,
      ...(row.question ? { question: row.question.status } : {}), ...(row.state ? { state: row.state } : {}) })) }); });
    return null;
  }
  root = createRoot(document.createElement('div'));
  await act(async () => root.render(<Component />));
  await act(async () => { await gateway.connect({ endpoint: 'ws://fixture.invalid', sessionKey: 'a', credentialKind: 'token', credential: 'fixture' }); await drain(); });
  expect(ids()).toEqual(['a-prompt']); commits = [];
});
afterEach(async () => { await act(async () => root.unmount()); vi.useRealTimers(); vi.unstubAllGlobals(); });

it.each([
  { rich: false, later: false, delay: 180 }, { rich: true, later: false, delay: 500 },
  { rich: false, later: true, delay: 180 }, { rich: true, later: true, delay: 500 },
])('publishes already-buffered review atomically with registry question $rich/$later ($delay ms)', async ({ rich, later, delay }) => {
  await emit(review('a', rich, later));
  await advance(100); expect(ids()).toEqual(['a-prompt']);
  await emit(question());
  // This check is intentionally over every commit, not just the eventual vector.
  assertNoMissingReview();
  expect.soft(ids()).toEqual(later ? ['a-prompt', questionID(), reviewID] : ['a-prompt', reviewID, questionID()]);
  const before = commits.length;
  await advance(delay + 1);
  assertNoMissingReview(); expect.soft(commits).toHaveLength(before);
  console.info(JSON.stringify({ rich, later, commits }));
  expect(ids()).toEqual(later ? ['a-prompt', questionID(), reviewID] : ['a-prompt', reviewID, questionID()]);
});

it('characterizes ordinary session.message as refresh-only, not a scheduled buffer row', async () => {
  probe.history.mockImplementation(() => new Promise(() => {}));
  await emit({ type: 'event', event: 'session.message', payload: { sessionKey: 'a', sessionId: generations.a, runId: 'run',
    message: { id: 'review-message', role: 'assistant', runId: 'run', content: 'Review via session.message' } } });
  await advance(100); expect(ids()).toEqual(['a-prompt']);
  await emit(question()); await advance(501);
  expect(ids()).toEqual(['a-prompt', questionID()]);
  expect(commits.some(commit => commit.rows.some(row => row.id === 'review-message'))).toBe(false);
  expect(probe.history).toHaveBeenCalled();
});

it.each([false, true])('leaves ordinary review scheduled without a question, rich=$rich', async rich => {
  await emit(review('a', rich)); const delay = rich ? 500 : 180;
  await advance(delay - 1); expect(ids()).toEqual(['a-prompt']);
  await advance(1); expect(ids()).toEqual(['a-prompt', reviewID]);
});

it('does not wait for or invent context when the question really arrives first', async () => {
  await emit(question()); expect(ids()).toEqual(['a-prompt', questionID()]);
  await advance(100); await emit(review());
  expect(ids()).toEqual(['a-prompt', questionID()]);
  await advance(179); expect(ids()).toEqual(['a-prompt', questionID()]);
  await advance(1); expect(ids()).toEqual(['a-prompt', reviewID, questionID()]);
  expect(commits.some(commit => commit.rows.some(row => row.id === questionID()) && !commit.rows.some(row => row.id === reviewID))).toBe(true);
});

it('preserves resolved events without scope and rejects stale pending resurrection', async () => {
  await emit(question());
  await emit({ event: 'question.resolved', payload: { id: 'decision', status: 'answered', answers: { answers: { pick: ['B'] } } } });
  await emit(review()); await advance(100);
  await emit(question());
  expect(gateway.messages.find(row => row.question)?.question?.status).toBe('answered');
  expect(ids()).toEqual(['a-prompt', questionID()]);
  await advance(80); expect(ids()).toEqual(['a-prompt', reviewID, questionID()]);
  expect(gateway.messages.find(row => row.question)?.question?.status).toBe('answered');
});

it('does not flush or borrow selected scope for malformed or unscoped requests', async () => {
  await emit(review()); await advance(100);
  await emit({ event: 'question.requested', payload: { ...question().payload as object, sessionKey: undefined } });
  await emit({ event: 'question.requested', payload: { ...question().payload as object, questions: [] } });
  expect(ids()).toEqual(['a-prompt']);
  await advance(80); expect(ids()).toEqual(['a-prompt', reviewID]);
});

it('publishes only the requested session and leaves the other session buffer on its original timer', async () => {
  await emit(review('b')); await emit(review('a')); await advance(100);
  await emit(question('a')); assertNoMissingReview();
  expect(probe.cached!('b').some(row => row.id === reviewID)).toBe(false);
  await advance(79); expect(probe.cached!('b').some(row => row.id === reviewID)).toBe(false);
  await advance(1); expect(probe.cached!('b').some(row => row.id === reviewID)).toBe(true);
});

it('keeps an offscreen session question and review together when selected', async () => {
  await emit(review('b')); await advance(100); await emit(question('b'));
  expect(ids()).toEqual(['a-prompt']);
  await act(async () => { gateway.selectProject('b'); await drain(); });
  expect(ids()).toEqual(['b-prompt', reviewID, questionID('b')]);
});

it.each(['background', 'inactive'])('does not publish retired buffers or late events after scene %s', async state => {
  await emit(review()); await advance(100);
  await act(async () => { for (const listener of probe.listeners) listener(state); await drain(); });
  const before = commits.length;
  await emit(question()); await advance(501);
  expect(ids()).toEqual(['a-prompt']); expect(commits).toHaveLength(before);
});

it('retires all live clocks and events on unmount', async () => {
  await emit(review()); await advance(100); const lateEvent = probe.client!.onEvent;
  await act(async () => root.unmount()); const before = commits.length;
  await act(async () => { lateEvent(question()); await vi.advanceTimersByTimeAsync(501); await drain(); });
  expect(commits).toHaveLength(before);
});

it('keeps urgent inline session.message publication immediate with prior buffered rows', async () => {
  await emit(review()); await advance(100);
  await emit({ event: 'session.message', payload: { sessionKey: 'a', sessionId: generations.a, runId: 'run', message: {
    id: 'inline', role: 'assistant', runId: 'run', content: 'Choose?', openclawAsyncDelivery: { itemId: 'inline-item', questions: [{ title: 'Choose?', options: ['A', 'B'] }] },
  } } });
  expect(ids()).toEqual(['a-prompt', reviewID, 'inline']);
  expect(commits.filter(commit => commit.rows.some(row => row.id === 'inline')).every(commit => commit.rows.some(row => row.id === reviewID))).toBe(true);
  const before = commits.length;
  // A session.message also requests canonical refresh. Hold it so this checks
  // only cancellation of the old buffer clock, not a canonical replacement.
  probe.history.mockImplementation(() => new Promise(() => {}));
  await advance(81); expect(commits).toHaveLength(before);
});

it('cannot republish a drained review after the concrete generation changes', async () => {
  await emit(review()); await advance(100); await emit(question());
  probe.rows[0]!.sessionId = '00000000-0000-4000-8000-000000000003';
  probe.rows[0]!.sessionStartedAtMs = now + 100;
  probe.history.mockImplementation(async key => ({ sessionKey: key, sessionId: probe.rows.find(row => row.key === key)?.sessionId,
    messages: [{ ...prompt(key), id: 'replacement-prompt', runId: 'new-run', timestamp: now + 200 }] }));
  await act(async () => { await gateway.refresh(); await drain(); });
  expect(ids()).not.toContain(reviewID);
  await advance(501); expect(ids()).not.toContain(reviewID);
});

it('cannot republish a drained review after forgetting and connecting again', async () => {
  await emit(review()); await advance(100); await emit(question());
  const connection = probe.client!.connectionRevision;
  await act(async () => { await gateway.forget(); await gateway.connect({ endpoint: 'ws://fixture.invalid', sessionKey: 'a', credentialKind: 'token', credential: 'fixture' }); await drain(); });
  expect(probe.client!.connectionRevision).toBeGreaterThan(connection);
  const afterConnect = ids();
  expect(afterConnect).not.toContain(questionID());
  await advance(501); expect(ids()).toEqual(afterConnect);
});
