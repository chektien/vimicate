// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { WorkspaceMessage } from '../workspace/workspaceTypes';
const probe = vi.hoisted(() => ({
  listeners: new Set<(state: string) => void>(),
  client: null as null | { status: string; connectionRevision: number; onEvent: (event: unknown) => void; onStatus: (status: string) => void },
  loadSessions: null as null | ReturnType<typeof import('./useGatewaySessionRefresh').useGatewaySessionRefresh>['loadSessions'],
  projectsPublished: vi.fn(), projectsRef: null as null | { current: unknown },
  census: vi.fn<(refreshDetails?: boolean) => Promise<Record<string, unknown>>>(), registry: vi.fn<() => Promise<Record<string, unknown>>>(),
  truth: vi.fn<(key: string) => Promise<Record<string, unknown>>>(), patches: vi.fn(), patchGate: null as null | Promise<void>, history: vi.fn<(key: string) => Promise<Record<string, unknown>>>(), rows: [] as Record<string, unknown>[], revisions: {} as Record<string, number>, requests: [] as string[], healthFails: false, questionScope: false,
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
  hasOperatorScope(scope: string) { return probe.questionScope && scope === 'operator.questions'; }
  listSessions(refreshDetails = false) { return probe.census(refreshDetails); } readRegistry() { return probe.registry(); }
  readSessionRunTruth(key: string) { return probe.truth(key); }
  async request(method: string, params: Record<string, unknown>) {
    probe.requests.push(method);
    if (method === 'health' && probe.healthFails) throw new Error('request timed out');
    if (method !== 'sessions.patch') return {};
    probe.patches(params);
    if (probe.patchGate) await probe.patchGate;
    const row = probe.rows.find(row => row.key === params.key)!;
    if ((row.markedUnreadAt ?? null) !== params.expectedMarkedUnreadAt) return { applied: false };
    row.unread = false; delete row.markedUnreadAt; return { applied: true };
  }
  async listCommands() { return { commands: [] }; } async listModels() { return { models: [] }; }
  async listApprovals() { return { approvals: [] }; } async providerUsage() { return {}; }
  sessionEventRevision(key: string) { return `0:${probe.revisions[key] ?? 0}`; } async followSession() {} history(key: string) { return probe.history(key); }
  decorateMessages(messages: WorkspaceMessage[]) { return messages; }
} }));
vi.mock('./useGatewaySessionRefresh', async importOriginal => {
  const actual = await importOriginal<typeof import('./useGatewaySessionRefresh')>();
  return { useGatewaySessionRefresh: (...args: Parameters<typeof actual.useGatewaySessionRefresh>) => {
    probe.projectsRef = args[0].projectsRef;
    const owner = actual.useGatewaySessionRefresh({ ...args[0], setProjects: value => { probe.projectsPublished(value); args[0].setProjects(value); } }); probe.loadSessions = owner.loadSessions; return owner;
  } };
});
import { useGatewayWorkspace } from './useGatewayWorkspace';
let root: Root;
let gateway: ReturnType<typeof useGatewayWorkspace>;
const snapshot = () => ({ sessions: probe.rows.map(row => ({ ...row })) });
const registry = () => ({ projects: { markdown: probe.rows.map(row => `## ${row.key}\n- id: ${row.key}\n- backend: openclaw\n- session: ${row.key}`).join('\n') }, threads: { json: '{"threads":[]}' } });
const deferred = <T,>() => { let resolve!: (value: T) => void; let reject!: (error: Error) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const drain = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };
const messageBatch = async (key = 'b', catalogChanged = false) => act(async () => {
  probe.client!.onEvent({ type: 'event', event: 'sessions.changed', payload: { sessionKey: key, phase: 'message', catalogChanged } });
  await vi.advanceTimersByTimeAsync(5001);
});
beforeEach(async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); vi.useFakeTimers();
  probe.rows = ['a', 'b'].map(key => ({ key, sessionId: key === 'a' ? '00000000-0000-4000-8000-000000000001' : '00000000-0000-4000-8000-000000000002', unread: false, hasActiveRun: false, lastActivityAt: 100 }));
  probe.census.mockReset().mockImplementation(async () => snapshot()); probe.registry.mockReset().mockImplementation(async () => registry());
  probe.truth.mockReset().mockImplementation(async key => ({ session: probe.rows.find(row => row.key === key) }));
  probe.revisions = {}; probe.requests = []; probe.healthFails = false; probe.questionScope = false; probe.patches.mockClear(); probe.patchGate = null; probe.history.mockReset().mockImplementation(async key => ({ sessionKey: key, sessionId: probe.rows.find(row => row.key === key)?.sessionId, messages: [{ id: `${key}-answer`, role: 'assistant', content: 'Ready' }] }));
  function Component() { gateway = useGatewayWorkspace({ restorePersisted: false }); return null; }
  root = createRoot(document.createElement('div'));
  await act(async () => root.render(<Component />));
  await act(async () => { await gateway.connect({ endpoint: 'ws://fixture.invalid', sessionKey: 'a', credentialKind: 'token', credential: 'fixture' }); });
  probe.census.mockClear(); probe.registry.mockClear(); probe.history.mockClear(); probe.projectsPublished.mockClear();
});
afterEach(async () => { await act(async () => root.unmount()); vi.useRealTimers(); vi.unstubAllGlobals(); });
it('coalesces successive message batches and read acknowledgements into one fresh trailing census', async () => {
  const first = deferred<Record<string, unknown>>(); const trailing = deferred<Record<string, unknown>>();
  probe.census.mockImplementationOnce(() => first.promise).mockImplementationOnce(() => trailing.promise);
  await messageBatch();
  for (let i = 0; i < 5; i++) {
    await act(async () => { gateway.selectProject('a'); await drain(); });
    await messageBatch();
  }
  expect(probe.patches).toHaveBeenCalledTimes(5);
  expect(probe.census).toHaveBeenCalledTimes(1);
  const stale = snapshot(); probe.rows[1]!.unread = true; probe.rows[1]!.markedUnreadAt = 200;
  await act(async () => { first.resolve(stale); await drain(); });
  expect(probe.census).toHaveBeenCalledTimes(2);
  await act(async () => { trailing.resolve(snapshot()); await drain(); });
  expect(probe.census).toHaveBeenCalledTimes(2);
  expect(probe.registry).not.toHaveBeenCalled();
  expect(gateway.projects.find(project => project.sessionKey === 'b')?.unread).toBe(true);
});

it('keeps requests arriving during the successor fresh without concurrent census reads', async () => {
  const first = deferred<Record<string, unknown>>(); const second = deferred<Record<string, unknown>>();
  probe.census.mockImplementationOnce(() => first.promise).mockImplementationOnce(() => second.promise);
  await messageBatch(); await messageBatch();
  await act(async () => { first.resolve(snapshot()); await drain(); });
  expect(probe.census).toHaveBeenCalledTimes(2);
  await messageBatch(); await messageBatch(); expect(probe.census).toHaveBeenCalledTimes(2);
  await act(async () => { second.resolve(snapshot()); await drain(); });
  expect(probe.census).toHaveBeenCalledTimes(3);
});

it('retains strict registry authority when acknowledgements merge and recovers after failure', async () => {
  const first = deferred<Record<string, unknown>>();
  probe.census.mockImplementationOnce(() => first.promise);
  await act(async () => { gateway.selectProject('a'); await drain(); });
  let strict!: Promise<string | void>;
  await act(async () => { strict = gateway.refresh().catch(error => error.message); gateway.selectProject('a'); await drain(); });
  expect(probe.census).toHaveBeenCalledOnce();
  probe.registry.mockRejectedValueOnce(new Error('typed read unavailable'));
  await act(async () => { first.resolve(snapshot()); await drain(); });
  await expect(strict).resolves.toContain('project registry unchanged: typed read unavailable');
  expect(probe.census).toHaveBeenCalledTimes(2); expect(probe.registry).toHaveBeenCalledOnce();
  expect(gateway.projectsReady).toBe(true); expect(gateway.projects).toHaveLength(2);
  await messageBatch(); expect(probe.census).toHaveBeenCalledTimes(3); expect(probe.registry).toHaveBeenCalledOnce();
  await act(async () => { await gateway.refresh(); await drain(); }); expect(probe.registry).toHaveBeenCalledTimes(2);
});

it('does not skip durable acknowledgement for stale unread=false or erase a newer explicit marker', async () => {
  probe.rows[0]!.unread = true; probe.rows[0]!.markedUnreadAt = 300;
  expect(Boolean(gateway.projects.find(project => project.sessionKey === 'a')?.unread)).toBe(false);
  await act(async () => { gateway.selectProject('a'); await drain(); });
  expect(probe.patches).toHaveBeenCalledExactlyOnceWith({ key: 'a', unread: false, expectedSessionId: '00000000-0000-4000-8000-000000000001', expectedMarkedUnreadAt: null });
  expect(probe.rows[0]!.markedUnreadAt).toBe(300);
  expect(gateway.projects.find(project => project.sessionKey === 'a')).toMatchObject({ unread: true, markedUnreadAt: 300 });
  await act(async () => { gateway.selectProject('a'); await drain(); });
  expect(probe.patches).toHaveBeenCalledTimes(2); expect(probe.rows[0]!.unread).toBe(false);
  expect(Boolean(gateway.projects.find(project => project.sessionKey === 'a')?.unread)).toBe(false);
});

it.each(['success', 'failure'] as const)('disposes active and successor refreshes on scene suspension before late %s', async outcome => {
  const old = deferred<Record<string, unknown>>(); probe.census.mockImplementationOnce(() => old.promise);
  await messageBatch(); await messageBatch();
  await act(async () => { for (const listener of probe.listeners) listener('background'); await drain(); });
  const prior = gateway.projects;
  await act(async () => { if (outcome === 'success') old.resolve({ sessions: [] }); else old.reject(new Error('retired census')); await drain(); });
  expect(probe.census).toHaveBeenCalledOnce(); expect(gateway.projects).toBe(prior);
  expect(gateway.detail).not.toBe('retired census');
  await act(async () => { for (const listener of probe.listeners) listener('active'); await drain(); });
  expect(probe.census).toHaveBeenCalledTimes(2); expect(gateway.projectsReady).toBe(true);
});

it.each(['census', 'registry', 'run truth'] as const)('rejects an old connection result after reconnect during %s', async boundary => {
  const old = deferred<Record<string, unknown>>();
  if (boundary === 'census') probe.census.mockImplementationOnce(() => old.promise);
  else if (boundary === 'registry') probe.registry.mockImplementationOnce(() => old.promise);
  else probe.truth.mockImplementationOnce(() => old.promise);
  await messageBatch('b', boundary === 'registry'); await messageBatch();
  await act(async () => {
    probe.client!.connectionRevision++; probe.client!.status = 'disconnected'; probe.client!.onStatus('disconnected');
    await gateway.connect({ endpoint: 'ws://replacement.invalid', sessionKey: 'a', credentialKind: 'token', credential: 'fixture' });
  });
  const reads = probe.census.mock.calls.length; const current = gateway.projects;
  await act(async () => { old.resolve(boundary === 'census' ? { sessions: [] } : boundary === 'registry' ? { version: 1, projects: [] } : { session: { key: 'a', hasActiveRun: true, activeRunId: 'retired-run' } }); await drain(); });
  expect(probe.census).toHaveBeenCalledTimes(reads); expect(gateway.projects).toBe(current); expect(gateway.projects).toHaveLength(2); expect(gateway.sending).toBe(false);
});

it('retires pending refresh work on unmount without a late census, registry read or history read', async () => {
  const old = deferred<Record<string, unknown>>(); probe.census.mockImplementationOnce(() => old.promise);
  await messageBatch(); await messageBatch();
  await act(async () => root.unmount());
  const reads = { census: probe.census.mock.calls.length, registry: probe.registry.mock.calls.length, history: probe.history.mock.calls.length };
  await act(async () => { old.resolve(snapshot()); await drain(); });
  expect(probe.census).toHaveBeenCalledTimes(reads.census); expect(probe.registry).toHaveBeenCalledTimes(reads.registry); expect(probe.history).toHaveBeenCalledTimes(reads.history);
});

it('preserves live run authority against a stale census and reveals terminal canonical history while another census is pending', async () => {
  const old = deferred<Record<string, unknown>>(); const fresh = deferred<Record<string, unknown>>();
  const stale = snapshot(); probe.census.mockImplementationOnce(() => old.promise).mockImplementationOnce(() => fresh.promise);
  await messageBatch();
  probe.rows[0]!.hasActiveRun = true; probe.rows[0]!.activeRunId = 'running';
  await act(async () => {
    probe.client!.onEvent({ type: 'event', event: 'agent', payload: { sessionKey: 'a', runId: 'running', stream: 'lifecycle', data: { phase: 'start' } } }); await drain();
  });
  expect(gateway.sending).toBe(true);
  await messageBatch();
  await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
  await act(async () => { old.resolve(stale); await drain(); });
  expect(gateway.sending).toBe(true); expect(probe.census).toHaveBeenCalledTimes(2);
  probe.rows[0]!.hasActiveRun = false; delete probe.rows[0]!.activeRunId;
  probe.history.mockImplementation(async key => ({ sessionKey: key, sessionId: key === 'a' ? '00000000-0000-4000-8000-000000000001' : '00000000-0000-4000-8000-000000000002', messages: [{ id: 'canonical-final', role: 'assistant', runId: 'running', content: 'Finished authoritatively' }] }));
  await act(async () => {
    probe.client!.onEvent({ type: 'event', event: 'agent', payload: { sessionKey: 'a', runId: 'running', stream: 'lifecycle', data: { phase: 'end' } } });
    await vi.advanceTimersByTimeAsync(121); await drain();
  });
  expect(gateway.messages.some(message => message.text === 'Finished authoritatively')).toBe(true);
  expect(gateway.sending).toBe(false); expect(probe.census).toHaveBeenCalledTimes(2);
  await act(async () => { fresh.resolve(snapshot()); await drain(); });
  expect(probe.census).toHaveBeenCalledTimes(3); expect(gateway.sending).toBe(false);
  expect(gateway.messages.some(message => message.text === 'Finished authoritatively')).toBe(true);
});

it('retains both keyed canonical-history intents when later callers merge behind a census', async () => {
  const old = deferred<Record<string, unknown>>(); probe.census.mockImplementationOnce(() => old.promise);
  await messageBatch();
  // An active run would ordinarily suppress canonical hydration of this tail.
  probe.rows[0]!.hasActiveRun = true; probe.rows[0]!.activeRunId = 'running';
  await act(async () => {
    void probe.loadSessions!(false, '', false, 'a');
    void probe.loadSessions!(true, '', false, 'b');
    await drain();
  });
  await act(async () => { old.resolve(snapshot()); await drain(); });
  expect(probe.census).toHaveBeenCalledTimes(2);
  expect(probe.history.mock.calls.map(call => call[0])).toEqual(['a']);
  expect(gateway.sending).toBe(true);
});

it('never transfers an old-generation forced history request onto a replacement generation', async () => {
  const old = deferred<Record<string, unknown>>(); probe.census.mockImplementationOnce(() => old.promise);
  await messageBatch();
  await act(async () => { void probe.loadSessions!(false, '', false, 'a'); await drain(); });
  probe.rows[0]!.sessionId = '00000000-0000-4000-8000-000000000003'; probe.rows[0]!.hasActiveRun = true; probe.rows[0]!.activeRunId = 'replacement-running';
  // The first result introduces the new generation and legitimately hydrates it.
  // The successor must not re-use the predecessor's forced-refresh authority.
  await act(async () => { old.resolve(snapshot()); await drain(); });
  expect(probe.census).toHaveBeenCalledTimes(2);
  expect(probe.history.mock.calls.map(call => call[0])).toEqual(['a']);
  expect(gateway.projects.find(project => project.sessionKey === 'a')?.sessionId).toBe('00000000-0000-4000-8000-000000000003');
});

it('does not restore a queued mutation selection after the user switches away', async () => {
  const old = deferred<Record<string, unknown>>(); probe.census.mockImplementationOnce(() => old.promise);
  await messageBatch();
  await act(async () => { void probe.loadSessions!(false, 'a'); gateway.selectProject('b'); await drain(); });
  await act(async () => { old.resolve(snapshot()); await drain(); });
  expect(probe.census).toHaveBeenCalledTimes(2); expect(gateway.selectedKey).toBe('b');
});

it('continues the merged successor after a failed census and accepts later normal refreshes', async () => {
  const failed = deferred<Record<string, unknown>>(); probe.census.mockImplementationOnce(() => failed.promise);
  await messageBatch(); await messageBatch();
  await act(async () => { failed.reject(new Error('census unavailable')); await drain(); });
  expect(probe.census).toHaveBeenCalledTimes(2); expect(probe.registry).not.toHaveBeenCalled();
  expect(gateway.projectsReady).toBe(true);
  await messageBatch(); expect(probe.census).toHaveBeenCalledTimes(3);
});

it('does not report a successful authoritative reload when its queued refresh is retired by disconnect', async () => {
  const old = deferred<Record<string, unknown>>(); probe.census.mockImplementationOnce(() => old.promise);
  await messageBatch();
  let submitted!: Promise<boolean>;
  await act(async () => { submitted = gateway.submit(':reload-projects'); await drain(); });
  await act(async () => {
    probe.client!.connectionRevision++; probe.client!.status = 'disconnected'; probe.client!.onStatus('disconnected'); await drain();
  });
  await expect(submitted).resolves.toBe(false);
  expect(gateway.messages.some(message => message.text.includes('authoritative registry refreshed'))).toBe(false);
  await act(async () => { old.resolve(snapshot()); await drain(); });
  expect(probe.census).toHaveBeenCalledOnce();
});

it('does not transfer forced history authority across a same-session-ID reset epoch', async () => {
  const old = deferred<Record<string, unknown>>(); const trailing = deferred<Record<string, unknown>>();
  probe.census.mockImplementationOnce(() => old.promise).mockImplementationOnce(() => trailing.promise);
  await messageBatch();
  await act(async () => { void probe.loadSessions!(false, '', false, 'a'); await drain(); });
  probe.rows[0]!.sessionStartedAtMs = 200; probe.rows[0]!.hasActiveRun = true; probe.rows[0]!.activeRunId = 'new-epoch-run';
  probe.history.mockImplementation(async key => ({ sessionKey: key, sessionId: probe.rows.find(row => row.key === key)?.sessionId,
    messages: [{ id: 'epoch-answer', role: 'assistant', content: 'Current epoch', timestamp: '2026-10-23T00:00:00.000Z' }] }));
  await act(async () => { old.resolve(snapshot()); await drain(); });
  expect(probe.census).toHaveBeenCalledTimes(2);
  await act(async () => { trailing.resolve(snapshot()); await drain(); });
  expect(probe.history.mock.calls.map(call => call[0])).toEqual(['a']);
});

it('drops a read acknowledgement continuation from a replaced connection without another census', async () => {
  const gate = deferred<void>(); probe.patchGate = gate.promise;
  await act(async () => { gateway.selectProject('b'); await drain(); });
  expect(probe.patches).toHaveBeenCalledOnce();
  await act(async () => {
    probe.client!.connectionRevision++; probe.client!.status = 'disconnected'; probe.client!.onStatus('disconnected');
    await gateway.connect({ endpoint: 'ws://replacement.invalid', sessionKey: 'b', credentialKind: 'token', credential: 'fixture' }); await drain();
  });
  expect(gateway.selectedKey).toBe('b');
  const reads = probe.census.mock.calls.length;
  await act(async () => { gate.resolve(); await drain(); });
  expect(probe.census).toHaveBeenCalledTimes(reads);
});

it('drops a read acknowledgement continuation after its session generation is replaced', async () => {
  const gate = deferred<void>(); probe.patchGate = gate.promise;
  await act(async () => { gateway.selectProject('b'); await drain(); });
  probe.rows[1]!.sessionId = '00000000-0000-4000-8000-000000000004';
  await act(async () => { await probe.loadSessions!(); await drain(); });
  expect(gateway.projects.find(project => project.sessionKey === 'b')?.sessionId).toBe('00000000-0000-4000-8000-000000000004');
  const reads = probe.census.mock.calls.length;
  await act(async () => { gate.resolve(); await drain(); });
  expect(probe.census).toHaveBeenCalledTimes(reads);
});

// Contract guard. History loading also refuses a deselected key, so this does
// not by itself discriminate the refresh hook's own post-read recheck.
it('does not read the previous selection history when selection changes during the refresh run-truth read', async () => {
  const truth = deferred<Record<string, unknown>>(); probe.truth.mockImplementationOnce(() => truth.promise);
  await act(async () => { void probe.loadSessions!(false, '', false, 'a'); await drain(); });
  expect(probe.truth).toHaveBeenCalledWith('a');
  await act(async () => { gateway.selectProject('b'); await drain(); });
  probe.history.mockClear();
  await act(async () => { truth.resolve({ session: probe.rows[0] }); await drain(); });
  expect(probe.history.mock.calls.map(call => call[0])).not.toContain('a');
});

it.each([{ sessionKey: 'a', reason: 'activity-summary' }, { sessionKey: 'b', phase: 'message' }])('does not read registry for routine census %j', async payload => {
  await act(async () => { probe.client!.onEvent({ type: 'event', event: 'sessions.changed', payload }); await vi.advanceTimersByTimeAsync(5001); await drain(); });
  expect(probe.census).toHaveBeenCalledOnce(); expect(probe.registry).not.toHaveBeenCalled();
});
it('retains the project array and avoids setProjects for an identical census', async () => {
  const prior = probe.projectsRef!.current; const presented = gateway.projects;
  await act(async () => { await probe.loadSessions!(); await drain(); });
  expect(probe.projectsPublished).not.toHaveBeenCalled();
  expect(probe.projectsRef!.current).toBe(prior); expect(gateway.projects).toBe(presented);
});
it('retains visible and latest history identity for identical fetched canonical history', async () => {
  const prior = gateway.messages; const latest = gateway.latestMessages;
  await act(async () => { await probe.loadSessions!(false, '', false, 'a'); await drain(); });
  expect(probe.history).toHaveBeenCalledWith('a'); expect(gateway.messages).toBe(prior); expect(gateway.latestMessages).toBe(latest);
});

it('throttles active-run census, skips plain progress history and reconciles terminal registry and history promptly', async () => {
  probe.rows[0]!.hasActiveRun = true; probe.rows[0]!.activeRunId = 'running';
  const event = (event: string, payload: Record<string, unknown>) => probe.client!.onEvent({ type: 'event', event, payload: { sessionKey: 'a', ...payload } });
  await act(async () => { event('agent', { runId: 'running', stream: 'lifecycle', data: { phase: 'start' } }); await drain(); });
  probe.history.mockClear(); probe.census.mockClear(); probe.registry.mockClear();
  await act(async () => {
    event('sessions.changed', { reason: 'activity-summary' });
    for (let i = 0; i < 3; i++) {
      await vi.advanceTimersByTimeAsync(500);
      event('session.message', { message: { role: 'assistant', openclawAsyncDelivery: { itemId: `progress-${i}` } } });
    }
    await drain();
  });
  expect(probe.census).not.toHaveBeenCalled(); expect(probe.history).not.toHaveBeenCalled();
  await act(async () => { await vi.advanceTimersByTimeAsync(3500); await drain(); });
  // Plain progress is shown by its live row; only the run end rereads history.
  // Rail census during a run waits for the five-second window.
  expect(probe.census).toHaveBeenCalledOnce(); expect(probe.history).not.toHaveBeenCalled(); expect(probe.registry).not.toHaveBeenCalled();
  await act(async () => { event('sessions.changed', { reason: 'update' }); await vi.advanceTimersByTimeAsync(500); });
  expect(probe.census).toHaveBeenCalledOnce();
  probe.rows[0]!.hasActiveRun = false; delete probe.rows[0]!.activeRunId;
  await act(async () => { event('agent', { runId: 'running', stream: 'lifecycle', data: { phase: 'end' } }); await vi.advanceTimersByTimeAsync(120); await drain(); });
  expect(probe.census).toHaveBeenCalledTimes(2); expect(probe.registry).toHaveBeenCalledOnce(); expect(probe.history.mock.calls.length).toBeGreaterThanOrEqual(1);
  expect(gateway.sending).toBe(false);
  await act(async () => { await vi.advanceTimersByTimeAsync(2000); await drain(); });
  expect(probe.census).toHaveBeenCalledTimes(2);
});

it('refreshes census details for catalog authority and explicit reload but not ordinary activity', async () => {
  await messageBatch();
  expect(probe.census).toHaveBeenLastCalledWith(false);
  await messageBatch('b', true);
  expect(probe.census).toHaveBeenLastCalledWith(true);
  await act(async () => { await gateway.refresh(); await drain(); });
  expect(probe.census).toHaveBeenLastCalledWith(true);
});

it('bounds census from sustained other-session activity while the selected thread is idle', async () => {
  await act(async () => {
    for (let i = 0; i < 20; i++) {
      probe.client!.onEvent({ type: 'event', event: 'sessions.changed', payload: { sessionKey: 'b', reason: 'activity-summary' } });
      await vi.advanceTimersByTimeAsync(300); await drain();
    }
  });
  expect(probe.census.mock.calls.length).toBeLessThanOrEqual(2);
  expect(probe.registry).not.toHaveBeenCalled();
  await act(async () => { await vi.advanceTimersByTimeAsync(5000); await drain(); });
  expect(probe.census.mock.calls.length).toBeGreaterThanOrEqual(2);
});

it('does not let another session’s run end promote pending routine census', async () => {
  probe.rows[1]!.hasActiveRun = true; probe.rows[1]!.activeRunId = 'other-run';
  await act(async () => { await probe.loadSessions!(); await drain(); });
  probe.rows[1]!.hasActiveRun = false; delete probe.rows[1]!.activeRunId;
  probe.census.mockClear(); probe.registry.mockClear();
  await act(async () => {
    probe.client!.onEvent({ type: 'event', event: 'sessions.changed', payload: { sessionKey: 'b', reason: 'activity-summary' } });
    probe.client!.onEvent({ type: 'event', event: 'agent', payload: { sessionKey: 'b', runId: 'other-run', stream: 'lifecycle', data: { phase: 'end' } } });
    await vi.advanceTimersByTimeAsync(500); await drain();
  });
  expect(probe.census).not.toHaveBeenCalled();
  await act(async () => { await vi.advanceTimersByTimeAsync(4600); await drain(); });
  expect(probe.census).toHaveBeenCalledOnce();
});

it('reuses an unchanged thread on re-entry and rereads it after any event or activity change', async () => {
  const visit = async (key: string) => act(async () => { gateway.selectProject(key); await drain(); await vi.advanceTimersByTimeAsync(10); await drain(); });
  await visit('b'); await visit('a'); probe.history.mockClear();
  await visit('b'); await visit('a');
  expect(probe.history).not.toHaveBeenCalled();
  probe.revisions.b = 1; await visit('b');
  expect(probe.history.mock.calls.map(call => call[0])).toEqual(['b']);
  await visit('a'); probe.history.mockClear();
  probe.rows[1]!.lastActivityAt = 500;
  await act(async () => { await probe.loadSessions!(); await drain(); });
  probe.history.mockClear(); await visit('b');
  expect(probe.history.mock.calls.map(call => call[0])).toEqual(['b']);
});

it('does not reread unchanged idle selected history on routine census', async () => {
  await act(async () => { await probe.loadSessions!(); await drain(); });
  probe.history.mockClear();
  for (let i = 0; i < 3; i++) await act(async () => { await probe.loadSessions!(); await drain(); });
  expect(probe.history).not.toHaveBeenCalled();
  probe.revisions.a = 1;
  await act(async () => { await probe.loadSessions!(); await drain(); });
  expect(probe.history.mock.calls.map(call => call[0])).toEqual(['a']);
});

it('keeps the socket through a transient inactive scene and catches up without reconnecting', async () => {
  const scene = async (state: string) => act(async () => { for (const listener of [...probe.listeners]) listener(state); await drain(); });
  const revision = probe.client!.connectionRevision; probe.questionScope = true;
  await scene('inactive'); await scene('active');
  await act(async () => { await vi.advanceTimersByTimeAsync(10); await drain(); });
  expect(probe.client!.connectionRevision).toBe(revision);
  expect(probe.client!.status).toBe('connected');
  // Liveness proven, then dropped catalog and question state is rehydrated.
  expect(probe.requests).toEqual(expect.arrayContaining(['health', 'question.list']));
  expect(probe.registry).toHaveBeenCalledOnce();
  // Selected transcript is still reused. Only the offscreen question-discovery
  // snapshot is revalidated after the scene missed events.
  expect(probe.history.mock.calls.map(call => call[0])).toEqual(['b']);
  probe.census.mockClear();
  await scene('inactive'); await scene('background');
  expect(probe.client!.status).toBe('idle');
  await scene('active');
  expect(probe.client!.connectionRevision).toBeGreaterThan(revision);
  expect(probe.registry).toHaveBeenCalled();
});

it('reconnects when the socket kept through an inactive scene is silently dead', async () => {
  const scene = async (state: string) => act(async () => { for (const listener of [...probe.listeners]) listener(state); await drain(); });
  const revision = probe.client!.connectionRevision;
  probe.healthFails = true;
  await scene('inactive'); await scene('active');
  await act(async () => { await vi.advanceTimersByTimeAsync(10); await drain(); });
  expect(probe.client!.connectionRevision).toBeGreaterThan(revision);
  expect(probe.client!.status).toBe('connected');
});
