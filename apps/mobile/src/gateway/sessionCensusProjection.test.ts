import { expect, it } from 'vitest';
import { SessionCensus } from './sessionCensus';
import { sessionEntriesFromPayload, projectsFromPayload } from '../workspace/workspaceTypes';
import { reconcileRegistryPayload } from '../workspace/registryProjection';
import { acceptSessionCensusAttention, WorkspaceAttentionLedger } from '../workspace/workspaceAttention';
import { WorkspaceActivityLedger } from '../workspace/workspaceActivityLedger';
import { projectsWithRunPhases } from '../workspace/runProjectPresentation';
import { projectsWithPendingQuestions } from '../questions/pendingQuestionPresentation';
import { SessionRunRegistry } from './sessionRunRegistry';
import { applySessionRegistryCensus, captureSessionCensusRequests } from './sessionRegistryLifecycle';
import { sessionFailureNotices } from './sessionFailureNotice';

const root = 'agent:main:direct:vimicate-ios:project:notes';
const thread = `${root}:thread:one`;
const detailFields = ['contextWindows', 'contextWindowDefault', 'thinkingLevels', 'thinkingOptions', 'thinkingDefault', 'toolOverrides', 'providerReview', 'nativeRuntimeConsent', 'contextBudgetStatus', 'agentRuntime', 'pluginExtensions'];
const baseline = { defaults: { modelProvider: 'openai', model: 'default', agentRuntime: { id: 'codex' }, thinkingDefault: 'medium', contextTokens: 1000 }, sessions: [
  { key: root, sessionId: '00000000-0000-4000-8000-000000000001', kind: 'direct', pinned: true, group: 'home', lastInteractionAt: 100, agentRuntime: { id: 'native' }, cwd: '~/notes', branch: 'main', hasActiveRun: false },
  { key: thread, sessionId: '00000000-0000-4000-8000-000000000002', kind: 'direct', parentSessionKey: root, label: 'Backend label', unread: true, markedUnreadAt: 90, lastActivityAt: 100, sessionStartedAt: 10,
    agentRuntime: { id: 'claude-cli' }, modelProvider: 'anthropic', model: 'selected', thinkingLevel: 'high', effectiveFastMode: true,
    totalTokens: 123, contextTokens: 2000, estimatedCostUsd: 0.04, hasActiveRun: true, activeRunIds: ['run'], status: 'running' },
] };
const current = () => ({ ...baseline, sessions: baseline.sessions.map(row => row.key === thread ? { ...row, lastActivityAt: 300, hasActiveRun: false, activeRunIds: [], status: 'failed', lastRunId: 'run', lastRunError: 'Failure fixture', endedAt: 300 } : row) });
const registry = { projects: { markdown: `## notes\n- id: notes\n- group: home\n- repo: ~/notes\n- backend: openclaw\n- session: ${root}` }, threads: { json: JSON.stringify({ threads: [{ threadID: 'one', label: 'Registry label', parentProjectID: 'notes', state: 'active', currentBinding: { stableSessionKey: thread } }] }) } };
const compact = (payload: ReturnType<typeof current>): { defaults: typeof baseline.defaults; sessions: Record<string, unknown>[] } => ({ ...payload, sessions: payload.sessions.map(row => ({ ...Object.fromEntries(Object.entries(row).filter(([key]) => !detailFields.includes(key))), rowMode: 'compact' })) });

function consume(payload: Record<string, unknown>) {
  const runs = new SessionRunRegistry(); runs.registerRun(thread, 'run');
  const active: string[] = [];
  applySessionRegistryCensus(runs, payload, captureSessionCensusRequests(runs), (key, run) => active.push(`${key}/${run}`));
  const attention = new WorkspaceAttentionLedger(); const notices: unknown[] = [];
  acceptSessionCensusAttention(attention, baseline, root, () => {});
  acceptSessionCensusAttention(attention, payload, root, (key, at, unread) => notices.push({ key, at, unread }));
  const activity = new WorkspaceActivityLedger();
  activity.reconcile(sessionEntriesFromPayload(baseline, 'explicit'), 'server');
  activity.reconcile(sessionEntriesFromPayload(payload, 'explicit'), 'server');
  activity.reconcile(sessionEntriesFromPayload(payload), 'compatibility');
  const entries = sessionEntriesFromPayload(payload);
  const projected = reconcileRegistryPayload(projectsFromPayload(payload), registry, entries);
  const projects = projectsWithPendingQuestions(projectsWithRunPhases(activity.reconcile(projected, 'presentation'), runs), new Map([[thread, 2]]));
  return { entries, projects, notices, active, unread: attention.isUnread(thread), failures: sessionFailureNotices(payload, projects) };
}

it('compact census retains every projected project, activity, lifecycle, question and failure fact', async () => {
  const owner = new SessionCensus(); await owner.read(async () => baseline);
  const merged = await owner.read(async () => compact(current()));
  const result = consume(merged);
  expect(result).toEqual(consume(current()));
  expect(result.entries[1]).toMatchObject({ name: 'Backend label', backendLabel: 'Backend label', agentRuntime: 'claude-cli', modelProvider: 'anthropic', model: 'selected', thinkingLevel: 'high', fastMode: true, totalTokens: 123, contextTokens: 2000, estimatedCostUsd: 0.04, sessionStartedAtMs: 10, unread: true, markedUnreadAt: 90 });
  expect(result.projects[1]).toMatchObject({ name: 'Backend label', kind: 'thread', rootSessionKey: root, parentSessionKey: root, path: '~/notes', group: 'home', runPhase: 'failed', state: 'error', updatedAt: 300, pendingQuestions: { own: 2, total: 2, threads: 0 } });
  expect(result.projects[0]).toMatchObject({ agentRuntime: 'native', branch: 'main', starred: true, threadCount: 2, pendingQuestions: { own: 0, total: 2, threads: 1 } });
  expect(result.unread).toBe(true); expect(result.notices).toHaveLength(1);
  expect(result.failures[0]).toMatchObject({ runId: 'run', timestamp: '300', text: expect.stringContaining('Failure fixture') });
});

it('compact census continues to name the exact active run and clear retired error receipts', async () => {
  const owner = new SessionCensus(); await owner.read(async () => current());
  const result = consume(await owner.read(async () => compact({ ...baseline, sessions: baseline.sessions.map(row => ({ ...row })) })));
  expect(result.active).toEqual([`${thread}/run`]);
  expect(result.projects[1]).toMatchObject({ runPhase: 'running', state: 'running' });
  expect(result.failures).toEqual([]);
});

it('compact explicit null details win over cached facts', async () => {
  const owner = new SessionCensus(); await owner.read(async () => baseline);
  const payload = compact(current()); payload.sessions[1]!.agentRuntime = null;
  const result = sessionEntriesFromPayload(await owner.read(async () => payload));
  expect(result[1]?.agentRuntime).toBe('codex');
});

it('failed detail hydration does not publish an unknown runtime or erase accepted authority', async () => {
  const owner = new SessionCensus(); await owner.read(async () => baseline);
  const changed = compact(current()); changed.sessions[1]!.sessionId = 'new';
  let calls = 0;
  await expect(owner.read(async () => { if (calls++) throw new Error('full unavailable'); return changed; })).rejects.toThrow('full unavailable');
  expect(sessionEntriesFromPayload(await owner.read(async () => compact(current())))[1]?.agentRuntime).toBe('claude-cli');
});

it('a purported full hydration cannot acquire authority from compact-only rows', async () => {
  await expect(new SessionCensus().read(async () => compact(current()))).rejects.toThrow(/session census/);
});
