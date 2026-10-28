// @vitest-environment jsdom
import React, { act, useEffect, useLayoutEffect, useMemo, useRef } from 'react';
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
vi.mock('../../modules/vimicate-diagnostics', () => ({ latestFatalDiagnostic: () => null, recentViewportDiagnostics: () => [], recordViewportDiagnostic: vi.fn() }));
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
  async connect() { this.connectionRevision++; this.status = 'connecting'; this.onStatus('connecting'); await Promise.resolve(); this.status = 'connected'; this.onStatus('connected'); }
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
// Transport/storage are synthetic. React and the production workspace/history and
// display owners are real. This tests every commit, not native paint.
import { useGatewayWorkspace } from './useGatewayWorkspace';
import { useTranscriptDisplayOptions } from '../transcript/useTranscriptDisplayOptions';
import { createTranscriptBuffer, updatedTranscriptBuffer } from '../transcript/transcriptVim';
import { buildVisibleTranscriptRenderRows, retainStableTranscriptRenderRows } from '../transcript/transcriptVisibleRows';
import { retainTranscriptRecyclerTopology } from '../transcript/transcriptRecyclerTopology';
import type { TranscriptRenderRow } from '../transcript/transcriptRenderRows';
const generation = '00000000-0000-4000-8000-000000000001';
const now = 1_800_000_000_000;
const expanded = new Set<string>();
let root: Root;
let gateway: ReturnType<typeof useGatewayWorkspace>;
type Commit = { session: string; messages: WorkspaceMessage[]; display: WorkspaceMessage[];
  buffer: ReturnType<typeof createTranscriptBuffer>; rows: TranscriptRenderRow[]; topology: TranscriptRenderRow[]; loading: boolean; problem: string };
let commits: Commit[];
let mounts: string[];
let unmounts: string[];
const drain = async () => { for (let i = 0; i < 40; i++) await Promise.resolve(); };
function Row({ id }: { id: string }) {
  useEffect(() => { mounts.push(id); return () => { unmounts.push(id); }; }, [id]);
  return <span>{id}</span>;
}
function Probe() {
  gateway = useGatewayWorkspace({ restorePersisted: false });
  const display = useTranscriptDisplayOptions(gateway.messages, gateway.messageSessionKey);
  const previous = useRef({ messages: [] as WorkspaceMessage[], buffer: createTranscriptBuffer([]) });
  const buffer = useMemo(() => {
    const next = updatedTranscriptBuffer(previous.current.messages, previous.current.buffer, display.messages);
    previous.current = { messages: display.messages, buffer: next }; return next;
  }, [display.messages]);
  const retainedRows = useRef<TranscriptRenderRow[]>([]);
  const rows = useMemo(() => retainStableTranscriptRenderRows(retainedRows.current,
    buildVisibleTranscriptRenderRows(display.messages, expanded)), [display.messages]);
  const retainedTopology = useRef<TranscriptRenderRow[]>([]);
  const topology = useMemo(() => retainTranscriptRecyclerTopology(retainedTopology.current, rows), [rows]);
  useLayoutEffect(() => {
    retainedRows.current = rows; retainedTopology.current = topology;
    commits.push({ session: gateway.messageSessionKey, messages: gateway.messages, display: display.messages,
      buffer, rows, topology, loading: gateway.loadingOlder, problem: gateway.historyProblem });
  });
  return <div key={gateway.messageSessionKey}>{rows.map(row => <Row key={row.key} id={row.key} />)}</div>;
}
const payload = () => ({ sessionKey: 'a', sessionId: generation, messages: [...Array.from({ length: 20 }, (_, i) => ({
  id: `message-${i}`, role: i % 2 ? 'assistant' : 'user', timestamp: now - 1000 + i,
  content: i % 2 ? `Unchanged response ${i}` : `Unchanged prompt ${i}`,
})), { role: 'assistant', id: 'read-call', content: [{ type: 'toolCall', id: 'read-1', name: 'skills_read', arguments: { name: 'example-skill' } }] },
{ role: 'toolResult', id: 'read-result', toolCallId: 'read-1', content: 'Read complete.' }] });
beforeEach(async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); vi.useFakeTimers(); vi.setSystemTime(now);
  commits = []; mounts = []; unmounts = []; probe.listeners.clear();
  probe.rows = [{ key: 'a', sessionId: generation, unread: false, hasActiveRun: false, lastActivityAt: now - 100 }];
  probe.census.mockReset().mockImplementation(async () => ({ sessions: structuredClone(probe.rows) }));
  probe.registry.mockReset().mockImplementation(async () => ({ projects: { markdown: '## a\n- id: a\n- backend: openclaw\n- session: a' }, threads: { json: '{"threads":[]}' } }));
  probe.truth.mockReset().mockImplementation(async () => ({ session: structuredClone(probe.rows[0]) }));
  probe.patches.mockClear(); probe.patchGate = null;
  probe.history.mockReset().mockImplementation(async () => payload());
  root = createRoot(document.createElement('div'));
  await act(async () => { root.render(<Probe />); await drain(); });
  await act(async () => { await gateway.connect({ endpoint: 'ws://fixture.invalid', sessionKey: 'a', credentialKind: 'token', credential: 'fixture' }); await drain(); });
  expect(gateway.messages.filter(row => row.role === 'user' || row.role === 'assistant')).toHaveLength(20);
});
afterEach(async () => { await act(async () => root.unmount()); vi.useRealTimers(); vi.unstubAllGlobals(); });
const scene = async (state: string) => act(async () => { for (const listener of [...probe.listeners]) listener(state); await drain(); });

it.each(['census', 'registry', 'truth', 'history'].flatMap(stage => [false, true].map(failed => ({ stage: stage as 'census' | 'registry' | 'truth' | 'history', failed }))))('retains mounted transcript identities across delayed foreground $stage, failed=$failed', async ({ stage, failed }) => {
  const baseline = commits.at(-1)!;
  commits = []; mounts = []; unmounts = [];
  let resolve!: (value: Record<string, unknown>) => void;
  let reject!: (reason: Error) => void;
  const owner = probe[stage];
  const original = owner.getMockImplementation()!;
  const originalPayload = await original('a');
  owner.mockImplementation(() => new Promise((done, fail) => { resolve = done; reject = fail; }));
  const beforeRequests = owner.mock.calls.length;
  await scene('inactive'); await scene('background'); await scene('active');
  expect(owner.mock.calls.length).toBeGreaterThan(beforeRequests);
  expect(resolve).toBeTypeOf('function');
  // Some transport stages produce no React commit at all. Either way the
  // currently mounted transcript must remain authoritative while pending.
  expect(gateway.messages).toBe(baseline.messages);
  await act(async () => { vi.advanceTimersByTime(2000); await drain(); });
  await act(async () => { if (failed) reject(new Error(`fixture ${stage} unavailable`)); else resolve(originalPayload); await drain(); });
  for (const commit of commits) {
    expect(commit.session).toBe('a');
    expect(commit.messages).toBe(baseline.messages);
    expect(commit.display).toBe(baseline.display);
    expect(commit.buffer).toBe(baseline.buffer);
    expect(commit.rows).toBe(baseline.rows);
    expect(commit.topology).toBe(baseline.topology);
    expect(commit.loading).toBe(false);
    expect(commit.problem).toBe(failed && stage === 'history' && commit.problem ? 'fixture history unavailable' : '');
  }
  expect(mounts).toEqual([]); expect(unmounts).toEqual([]);
});
