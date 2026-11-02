// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { WorkspaceMessage } from '../workspace/workspaceTypes';
const probe = vi.hoisted(() => ({
  storage: new Map<string, string>(), questions: [] as Record<string, unknown>[], resolve: vi.fn<(params: Record<string, unknown>) => Promise<unknown>>(),
  listeners: new Set<(state: string) => void>(),
  client: null as null | { status: string; connectionRevision: number; onEvent: (event: unknown) => void; onStatus: (status: string) => void },
  census: vi.fn<() => Promise<Record<string, unknown>>>(), registry: vi.fn<() => Promise<Record<string, unknown>>>(),
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
  loadValue: async (key: string) => probe.storage.get(key) ?? null, saveValue: async (key: string, value: string) => { probe.storage.set(key, value); }, setWorkspacePersistenceActive: () => {},
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
    if (method === 'question.list') return { questions: probe.questions };
    if (method === 'question.resolve') return probe.resolve(params);
    if (method !== 'sessions.patch') return {};
    probe.patches(params);
    if (probe.patchGate) await probe.patchGate;
    const row = probe.rows.find(row => row.key === params.key)!;
    if ((row.markedUnreadAt ?? null) !== params.expectedMarkedUnreadAt) return { applied: false };
    row.unread = false; delete row.markedUnreadAt; return { applied: true };
  }
  async listCommands() { return { commands: [] }; } async listModels() { return { models: [] }; }
  async listApprovals() { return { approvals: [] }; } async providerUsage() { return {}; }
  sessionEventRevision() { return '0:0'; } async followSession() {} history(key: string) { return probe.history(key); }
  decorateMessages(messages: WorkspaceMessage[]) { return messages; }
} }));
import { useGatewayWorkspace } from './useGatewayWorkspace';
import type { GatewayFrame } from './gatewayEvents';
import { presentWorkspaceProjects } from '../workspace/workspacePresentation';
import { WORKSPACE_ACTIVITY_KEY, WORKSPACE_ATTENTION_KEY } from './gatewayWorkspaceStorageKeys';
const now = 1_800_000_000_000;
const generations = { a: '00000000-0000-4000-8000-000000000001', b: '00000000-0000-4000-8000-000000000002' };
let root: Root;
let gateway: ReturnType<typeof useGatewayWorkspace>;
const drain = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };
const prompt = (key: string) => ({ id: `${key}-prompt`, role: 'user', runId: 'run', content: 'Review request', timestamp: now - 100 });
const registry = () => ({ projects: { markdown: ['a', 'b'].map(key => `## ${key}\n- id: ${key}\n- backend: openclaw\n- session: ${key}`).join('\n') }, threads: { json: '{"threads":[]}' } });
const question = (key = 'a', id = 'decision'): GatewayFrame => ({ type: 'event', event: 'question.requested', payload: {
  id, sessionKey: key, runId: 'run', createdAtMs: now + 50, expiresAtMs: now + 90000, status: 'pending',
  questions: [{ questionId: 'pick', header: 'Review', question: 'Choose?', options: [{ label: 'A' }, { label: 'B' }] }],
} });
const emit = async (frame: GatewayFrame) => act(async () => { probe.client!.onEvent(frame); await drain(); });
const advance = async (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); await drain(); });
async function mount(restorePersisted = false) {
  function Component() { gateway = useGatewayWorkspace({ restorePersisted }); return null; }
  root = createRoot(document.createElement('div'));
  await act(async () => { root.render(<Component />); await drain(); });
  await act(async () => { await gateway.connect({ endpoint: 'ws://fixture.invalid', sessionKey: 'a', credentialKind: 'token', credential: 'fixture' }); await drain(); });
}
beforeEach(async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); vi.useFakeTimers(); vi.setSystemTime(now);
  probe.rows = ['a', 'b'].map(key => ({ key, sessionId: generations[key as keyof typeof generations], unread: false, hasActiveRun: false, lastActivityAt: now - 100 }));
  probe.census.mockReset().mockImplementation(async () => ({ sessions: probe.rows.map(row => ({ ...row })) }));
  probe.registry.mockReset().mockImplementation(async () => registry());
  probe.truth.mockReset().mockImplementation(async key => ({ session: probe.rows.find(row => row.key === key) }));
  probe.patches.mockClear(); probe.patchGate = null;
  probe.history.mockReset().mockImplementation(async key => ({ sessionKey: key, sessionId: probe.rows.find(row => row.key === key)?.sessionId, messages: [prompt(key)] }));
  probe.storage.clear(); probe.questions = []; probe.resolve.mockReset().mockResolvedValue({ status: 'answered', answers: { answers: { pick: ['B'] } } });
  await mount();
});
afterEach(async () => { await act(async () => root.unmount()); vi.useRealTimers(); vi.unstubAllGlobals(); });

const activity = (key = 'a') => gateway.projects.find(project => project.sessionKey === key)?.updatedAt;
const order = () => presentWorkspaceProjects(gateway.projects, 'activity').map(project => project.sessionKey);
const answer = async () => {
  const record = gateway.messages.find(row => row.question)?.question!;
  await act(async () => { gateway.questions.choose(record, 0, 1); });
  return record;
};
const resolved = (status = 'answered', id = 'decision'): GatewayFrame => ({ event: 'question.resolved', payload: {
  id, status, ...(status === 'answered' ? { answers: { answers: { pick: ['B'] } } } : {}),
} });

it('keeps pending-question markers independent of unread and run state through selection and cancellation', async () => {
  const before = gateway.projects.find(project => project.sessionKey === 'b')!;
  await emit(question('b'));
  let current = gateway.projects.find(project => project.sessionKey === 'b')!;
  expect(current.pendingQuestions?.own).toBe(1);
  expect(current.runPhase).toBe(before.runPhase); expect(current.unread).toBe(before.unread);
  await act(async () => { gateway.selectProject('b'); await drain(); });
  current = gateway.projects.find(project => project.sessionKey === 'b')!;
  expect(current.pendingQuestions?.own).toBe(1); expect(current.unread).toBeFalsy();
  await emit(resolved('cancelled'));
  expect(gateway.projects.find(project => project.sessionKey === 'b')?.pendingQuestions).toBeUndefined();
});

it('promotes a confirmed answer in Recent and preserves its clock through stale nonzero census refresh', async () => {
  probe.questions = [question().payload as Record<string, unknown>];
  await emit(question());
  // A newer unrelated thread remains first until this answer is accepted.
  probe.rows[1]!.lastActivityAt = now + 200;
  await act(async () => { await gateway.refresh(); await drain(); });
  expect(order()[0]).toBe('b');
  await advance(500);
  const record = await answer();
  await act(async () => { await gateway.questions.resolve(record); await drain(); });
  expect.soft(activity()).toBe(now + 500); expect.soft(order()[0]).toBe('a');
  await advance(100);
  await act(async () => { await gateway.refresh(); await drain(); });
  expect.soft(activity()).toBe(now + 500); expect.soft(order()[0]).toBe('a');
});

it('uses an accepted request source clock, never receipt time, and isolates offscreen question activity', async () => {
  const ancient = { ...question('b').payload as object, createdAtMs: now - 5000 };
  await advance(1000); await emit({ event: 'question.requested', payload: ancient });
  expect.soft(activity('b')).toBe(now - 100); expect.soft(activity('a')).toBe(now - 100);
  await emit(question('b', 'fresh'));
  expect.soft(activity('b')).toBe(now + 50); expect.soft(activity('a')).toBe(now - 100);
  expect(order()[0]).toBe('b'); expect(gateway.selectedKey).toBe('a');
});

it('ignores hydrated questions, reading, selection, malformed/unowned resolution and duplicate requests', async () => {
  await act(async () => root.unmount());
  probe.questions = [question().payload as Record<string, unknown>];
  await mount();
  expect(gateway.messages.find(row => row.question)?.question?.status).toBe('pending');
  const before = activity();
  await advance(1000);
  await act(async () => { gateway.selectProject('b'); gateway.selectProject('a'); await drain(); });
  await emit(resolved('answered', 'unknown'));
  await emit({ event: 'question.requested', payload: { ...question().payload as object, sessionKey: undefined } });
  await emit({ event: 'question.resolved', payload: { id: 'decision', status: 'answered' } });
  expect(activity()).toBe(before);
  await emit(question()); const accepted = activity();
  expect(accepted).toBe(before);
  await advance(1000); await emit(question());
  expect(activity()).toBe(accepted);
});

it.each(['cancelled', 'expired'])('does not promote a resolved %s question', async status => {
  await emit(question()); const before = activity();
  await advance(1000); await emit(resolved(status));
  expect(activity()).toBe(before);
});

it.each(['rejected', 'malformed', 'unconfirmed'])('does not promote %s local answer attempts', async result => {
  await emit(question()); const before = activity(); const record = await answer();
  probe.resolve.mockImplementation(async () => {
    if (result === 'rejected') throw new Error('fixture rejection');
    if (result === 'malformed') return { status: 'answered' };
    return new Promise(() => {});
  });
  await advance(1000);
  let task!: Promise<void>;
  await act(async () => { task = gateway.questions.resolve(record); await drain(); });
  if (result !== 'unconfirmed') await task;
  expect(activity()).toBe(before);
});

it('deduplicates an answered event and delayed RPC acknowledgement, replay and stale hydration', async () => {
  probe.questions = [question().payload as Record<string, unknown>]; await emit(question());
  const record = await answer(); let finish!: (value: unknown) => void;
  probe.resolve.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  let task!: Promise<void>;
  await act(async () => { task = gateway.questions.resolve(record); });
  await advance(500); await emit(resolved()); expect.soft(activity()).toBe(now + 500);
  await advance(500);
  await act(async () => { finish(resolved().payload); await task; });
  await emit(resolved()); await emit(question());
  expect.soft(activity()).toBe(now + 500);
  // A newer completion still advances through the existing attention path.
  await emit({ event: 'chat', payload: { sessionKey: 'a', runId: 'resumed', state: 'final', timestamp: now + 1000,
    message: { role: 'assistant', content: 'Synthetic resumed result' } } });
  expect(activity()).toBe(now + 1000);
});

it('restores confirmed recency and deduplication across remount before replaying historical answers', async () => {
  await emit(question()); const record = await answer(); await advance(500);
  await act(async () => { await gateway.questions.resolve(record); });
  const activitySnapshot = probe.storage.get(WORKSPACE_ACTIVITY_KEY);
  const attentionSnapshot = probe.storage.get(WORKSPACE_ATTENTION_KEY);
  expect.soft(activitySnapshot).toBeDefined(); expect.soft(attentionSnapshot).toBeDefined();
  await act(async () => root.unmount()); await advance(1000);
  probe.questions = [question().payload as Record<string, unknown>];
  await mount(true);
  expect.soft(activity()).toBe(now + 500);
  await emit(resolved()); await emit(question());
  expect.soft(activity()).toBe(now + 500);
});

it.each(['background', 'inactive', 'reconnect', 'unmount'])('rejects a local confirmation after %s retires its authority', async retired => {
  await emit(question()); const before = activity(); const record = await answer();
  let finish!: (value: unknown) => void;
  probe.resolve.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  let task!: Promise<void>;
  await act(async () => { task = gateway.questions.resolve(record); });
  if (retired === 'unmount') await act(async () => root.unmount());
  else if (retired === 'reconnect') probe.client!.connectionRevision++;
  else await act(async () => { for (const listener of probe.listeners) listener(retired); await drain(); });
  const snapshot = probe.storage.get(WORKSPACE_ACTIVITY_KEY);
  await advance(1000);
  await act(async () => { finish(resolved().payload); await task; });
  expect(activity()).toBe(before); expect(probe.storage.get(WORKSPACE_ACTIVITY_KEY)).toBe(snapshot);
});

it('does not borrow a conflicting question identity or resolved event payload session from the selection', async () => {
  await emit(question()); const record = await answer(); const beforeB = activity('b');
  let finish!: (value: unknown) => void;
  probe.resolve.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  let task!: Promise<void>;
  await act(async () => { task = gateway.questions.resolve(record); });
  await emit(question('b'));
  expect(activity('b')).toBe(beforeB);
  await act(async () => { gateway.selectProject('b'); await drain(); });
  await advance(500); await emit(resolved());
  expect(activity('a')).toBe(now + 500); expect(activity('b')).toBe(beforeB);
  await act(async () => { finish(resolved().payload); await task; });
});

it('does not turn an already answered list snapshot into fresh activity on resolved replay', async () => {
  await act(async () => root.unmount());
  probe.questions = [{ ...question().payload as object, ...resolved().payload as object }];
  await advance(1000); await mount();
  const before = activity();
  expect(gateway.messages.find(row => row.question)?.question?.status).toBe('answered');
  await emit(resolved()); expect(activity()).toBe(before);
});

it('keeps duplicate answered replay inert after reconnecting the mounted owner', async () => {
  probe.questions = [question().payload as Record<string, unknown>];
  await emit(question()); const record = await answer(); await advance(500);
  await act(async () => { await gateway.questions.resolve(record); });
  await advance(1000);
  await act(async () => {
    probe.client!.status = 'disconnected'; probe.client!.onStatus('disconnected'); await drain();
  });
  await act(async () => {
    await gateway.connect({ endpoint: 'ws://fixture.invalid', sessionKey: 'a', credentialKind: 'token', credential: 'fixture' }); await drain();
  });
  await emit(resolved()); await emit(question()); expect(activity()).toBe(now + 500);
});

it('does not invent current time for a remote untimestamped answer after stale pending hydration', async () => {
  await act(async () => root.unmount());
  probe.questions = [question().payload as Record<string, unknown>];
  await mount(); const before = activity();
  await advance(1000); await emit(resolved());
  expect(gateway.messages.find(row => row.question)?.question?.status).toBe('answered');
  expect(activity()).toBe(before);
});

it('does not admit old-answer event receipt time after background and foreground retire its scene ticket', async () => {
  await emit(question()); const before = activity(); const record = await answer();
  let finish!: (value: unknown) => void;
  probe.resolve.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  let task!: Promise<void>;
  await act(async () => { task = gateway.questions.resolve(record); });
  await act(async () => { for (const listener of probe.listeners) listener('inactive'); await drain(); });
  await advance(500);
  await act(async () => { for (const listener of probe.listeners) listener('active'); await drain(); });
  await emit(resolved());
  await act(async () => { finish(resolved().payload); await task; });
  expect(activity()).toBe(before);
});

it.each(['cancelled', 'answered'])('does not treat a local dismissal and its %s confirmation as answer activity', async status => {
  await emit(question()); const before = activity();
  const record = gateway.messages.find(row => row.question)?.question!;
  let finish!: (value: unknown) => void;
  probe.resolve.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  let task!: Promise<void>;
  await act(async () => { task = gateway.questions.resolve(record, true); });
  await advance(500); await emit(resolved(status));
  await act(async () => { finish(resolved(status).payload); await task; });
  expect(activity()).toBe(before);
});


it.each(['cancelled', 'expired', 'answered'])('keeps offscreen question-only %s recency without durable unread across remount', async status => {
  await emit(question('b'));
  expect(activity('b')).toBe(now + 50); expect(order()[0]).toBe('b');
  expect(JSON.parse(probe.storage.get(WORKSPACE_ATTENTION_KEY)!).unreadSessions).not.toContain('b');
  await advance(1000); await emit(resolved(status));
  expect(gateway.projects.find(project => project.sessionKey === 'b')?.unread).toBeFalsy();
  await act(async () => root.unmount()); await mount(true);
  expect(activity('b')).toBe(now + 50); expect(order()[0]).toBe('b');
  expect(gateway.projects.find(project => project.sessionKey === 'b')?.unread).toBeFalsy();
  await emit(question('b')); await emit(resolved(status));
  expect(activity('b')).toBe(now + 50);
  expect(gateway.projects.find(project => project.sessionKey === 'b')?.unread).toBeFalsy();
});

it('preserves genuine offscreen output unread through question activity, resolution and remount', async () => {
  await emit({ event: 'chat', payload: { sessionKey: 'b', runId: 'completed-output', state: 'final', timestamp: now + 20,
    message: { role: 'assistant', content: 'Genuine completed output' } } });
  await emit(question('b')); await emit(resolved('cancelled'));
  expect(gateway.projects.find(project => project.sessionKey === 'b')?.unread).toBe(true);
  await act(async () => root.unmount()); await mount(true);
  expect(gateway.projects.find(project => project.sessionKey === 'b')?.unread).toBe(true);
});


it('expires an offscreen question locally without retaining a durable unread dot', async () => {
  await emit(question('b'));
  await advance(91000);
  expect(gateway.projects.find(project => project.sessionKey === 'b')?.pendingQuestions).toBeUndefined();
  expect(gateway.projects.find(project => project.sessionKey === 'b')?.unread).toBeFalsy();
  expect(activity('b')).toBe(now + 50);
  await act(async () => root.unmount()); await mount(true);
  expect(gateway.projects.find(project => project.sessionKey === 'b')?.unread).toBeFalsy();
  expect(activity('b')).toBe(now + 50);
});


it('drops an inherited legacy fallback maximum when a real question supplies fresh activity', async () => {
  await act(async () => root.unmount());
  probe.storage.set(WORKSPACE_ACTIVITY_KEY, JSON.stringify([['b', now + 50000]]));
  delete probe.rows[1]!.lastActivityAt;
  await mount(true);
  expect(activity('b')).toBe(now + 50000);
  await emit(question('b'));
  expect(activity('b')).toBe(now + 50);
  await act(async () => root.unmount()); await mount(true);
  expect(activity('b')).toBe(now + 50);
});


it.each([{ legacy: false, source: 'binding' }, { legacy: true, source: 'binding' }, { legacy: false, source: 'firstSeen' }, { legacy: true, source: 'firstSeen' }])('never promotes registry $source metadata to activity through refresh (legacy ledger $legacy)', async ({ legacy, source }) => {
  await act(async () => root.unmount());
  if (legacy) probe.storage.set(WORKSPACE_ACTIVITY_KEY, JSON.stringify([['b', now + 900]]));
  probe.rows = probe.rows.filter(row => row.key === 'a');
  probe.registry.mockImplementation(async () => ({
    projects: { markdown: '## a\n- id: a\n- backend: openclaw\n- session: a' },
    threads: { json: JSON.stringify({ threads: [{ threadID: 'b-thread', parentProjectID: 'a', label: 'b', state: 'active',
      ...(source === 'firstSeen' ? { firstSeenAtSeconds: (now + 800) / 1000 } : {}),
      currentBinding: { stableSessionKey: 'b', ...(source === 'binding' ? { lastSeenAtSeconds: (now + 800) / 1000 } : {}) }, bindings: [] }] }) },
  }));
  await mount(true);
  expect(gateway.projects.find(project => project.sessionKey === 'b')?.kind).toBe('thread');
  await emit(question('b'));
  expect.soft(activity('b')).toBe(now + 50);
  probe.rows.push({ key: 'b', sessionId: generations.b, unread: false, hasActiveRun: false, lastActivityAt: now - 100 });
  await act(async () => { await gateway.refresh(); await drain(); });
  expect.soft(activity('b')).toBe(now + 50);
  await act(async () => root.unmount()); await mount(true);
  expect(activity('b')).toBe(now + 50);
});


it.each(['row', 'metadata'])('replaces %s metadata clocks with explicit activity and survives stale or absent activity after restart', async location => {
  await act(async () => root.unmount());
  const row = probe.rows[1]!; delete row.lastActivityAt;
  if (location === 'row') row.updatedAt = now + 900;
  else row.metadata = { updatedAt: now + 900 };
  await mount(true); expect.soft(activity('b')).toBe(now + 900);
  if (location === 'row') row.lastActivityAt = now + 500;
  else row.metadata = { updatedAt: now + 900, lastInteractionAt: now + 500 };
  await act(async () => { await gateway.refresh(); await drain(); });
  expect.soft(activity('b')).toBe(now + 500);
  if (location === 'row') row.lastActivityAt = now + 400;
  else row.metadata = { updatedAt: now + 900, lastInteractionAt: now + 400 };
  await act(async () => { await gateway.refresh(); await drain(); });
  expect.soft(activity('b')).toBe(now + 500);
  if (location === 'row') { delete row.lastActivityAt; row.updatedAt = now + 1000; }
  else row.metadata = { updatedAt: now + 1000 };
  await act(async () => { await gateway.refresh(); await drain(); });
  expect.soft(activity('b')).toBe(now + 500);
  await emit(question('a', 'save-proven-clock'));
  await act(async () => root.unmount()); await mount(true);
  expect(activity('b')).toBe(now + 500);
});

it('replaces raw metadata with accepted local activity even when the local clock is older', async () => {
  await act(async () => root.unmount());
  const row = probe.rows[1]!; delete row.lastActivityAt; row.updatedAt = now + 900;
  await mount(true); expect(activity('b')).toBe(now + 900);
  await emit(question('b')); expect.soft(activity('b')).toBe(now + 50);
  await act(async () => { await gateway.refresh(); await drain(); });
  expect.soft(activity('b')).toBe(now + 50);
  await act(async () => root.unmount()); await mount(true);
  expect(activity('b')).toBe(now + 50);
});

it('keeps metadata-only server-first compatibility while no proven activity exists', async () => {
  await act(async () => root.unmount());
  const row = probe.rows[1]!; delete row.lastActivityAt; row.updatedAt = now + 900;
  await mount(true); expect(activity('b')).toBe(now + 900);
  row.updatedAt = now + 1000;
  await act(async () => { await gateway.refresh(); await drain(); });
  expect(activity('b')).toBe(now + 1000);
  await emit(question('a', 'save-compatibility-clock')); delete row.updatedAt;
  await act(async () => root.unmount()); await mount(true);
  expect(activity('b')).toBe(now + 1000);
});

it('treats explicit zero as authoritative absence rather than promoting a metadata fallback', async () => {
  await act(async () => root.unmount());
  const row = probe.rows[1]!; row.lastActivityAt = 0; row.updatedAt = now + 900;
  await mount(true); expect.soft(activity('b')).toBeUndefined();
  delete row.lastActivityAt; row.updatedAt = now + 1000;
  await act(async () => { await gateway.refresh(); await drain(); });
  expect.soft(activity('b')).toBeUndefined();
  await emit(question('a', 'save-zero-clock'));
  await act(async () => root.unmount()); await mount(true);
  expect(activity('b')).toBeUndefined();
  await emit(question('b')); expect(activity('b')).toBe(now + 50);
});
