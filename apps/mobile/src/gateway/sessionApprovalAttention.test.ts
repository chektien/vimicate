import { expect, it, vi } from 'vitest';
import { SessionRunRegistry } from './sessionRunRegistry';
import { SessionHistoryCache } from './sessionHistoryCache';
import { createSessionMessagePublisher } from './sessionMessagePublication';
import { HistoryPublicationAuthority } from './historyPublicationAuthority';
import { SessionHistoryViewCache } from './sessionHistoryView';
import { approvalDecisionAction } from './approvalFinalization';
import { projectGatewayEvent, upsertLiveMessage } from './gatewayEventProjection';
import type { WorkspaceMessage } from '../workspace/workspaceTypes';

const approval = (id: string, resolved = false): WorkspaceMessage => ({
  id: `live-approval-${id}`, role: 'approval', text: id, sessionKey: 'one',
  approval: { id, kind: 'plugin', resolved, allowedDecisions: resolved ? [] : ['allow-once', 'deny'] },
});
function setup(mode: 'latest' | 'older', parked = false) {
  const registry = new SessionRunRegistry(); const latest = new SessionHistoryCache();
  latest.onPublication = (key, rows) => { registry.approvals.observe(key, rows); };
  let visible: WorkspaceMessage[] = []; const queued: (() => void)[] = [];
  const authority = new HistoryPublicationAuthority();
  const context: Parameters<typeof createSessionMessagePublisher>[0] = {
    selectedRef: { current: parked ? 'two' : 'one' }, activeSessionKey: { current: parked ? 'two' : 'one' },
    publicationAuthority: { current: authority }, windowMode: { current: mode },
    historyCache: { current: new SessionHistoryCache() }, latestTailCache: { current: latest },
    historyViewCache: { current: new SessionHistoryViewCache() },
    setMessageState: action => queued.push(() => { visible = typeof action === 'function' ? action(visible) : action; }),
    persistLater: vi.fn(), persistHistoryReview: vi.fn(),
  };
  context.historyViewCache.current.store('one', { windowMode: mode, reviewEntryIntent: null, generation: null, archive: null, cursor: null, historyFailure: null, historyProblem: '' });
  const publish = createSessionMessagePublisher(context);
  return { registry, latest, authority, publish, flush: () => queued.splice(0).forEach(action => action()) };
}

it.each([['latest', false], ['older', false], ['older', true]] as const)('projects modern approval on accepted %s publication with parked=%s', async (mode, parked) => {
  const test = setup(mode, parked); const notify = vi.fn(); const stop = test.latest.subscribe(notify);
  const row = projectGatewayEvent({ event: 'session.approval', payload: { sessionKey: 'one', phase: 'pending', approval: {
    id: 'numbers', status: 'pending', createdAtMs: 1000, expiresAtMs: 2000,
    presentation: { kind: 'plugin', title: 'Allow Numbers?', allowedDecisions: ['allow-once', 'deny'] },
  } } }, 'one')!.message;
  test.publish('one', rows => upsertLiveMessage(rows, row)); test.flush();
  expect(test.registry.presentationPhaseFor('one')).toBe('needs-user');
  expect(test.registry.isBusy('one')).toBe(false); expect(test.registry.runFor('one')).toBe('');
  expect(notify).not.toHaveBeenCalled(); await Promise.resolve(); expect(notify).toHaveBeenCalledOnce(); stop();
});

it('does not observe an approval from a retired queued publication', () => {
  const test = setup('latest'); test.publish('one', [approval('a')]); test.authority.suspend(); test.authority.resume(); test.flush();
  expect(test.registry.presentationPhaseFor('one')).toBeUndefined();
});

it('retains pending identities across tail cropping and resolves only the answered identity', () => {
  const test = setup('older', true);
  test.publish('one', [approval('a'), approval('b')]);
  test.publish('one', rows => [...rows, ...Array.from({ length: 500 }, (_, i): WorkspaceMessage => ({ id: `text-${i}`, role: 'assistant', text: 'text', sessionKey: 'one' }))]);
  expect(test.latest.restore('one')).toHaveLength(480);
  test.publish('one', rows => upsertLiveMessage(rows, approval('a', true)));
  expect(test.registry.presentationPhaseFor('one')).toBe('needs-user');
  test.publish('one', rows => upsertLiveMessage(rows, approval('b', true)));
  expect(test.registry.presentationPhaseFor('one')).toBeUndefined();
  // Terminal rows may also fall out of the presentation window.
  test.publish('one', []); test.publish('one', [approval('a'), approval('b')]);
  expect(test.registry.presentationPhaseFor('one')).toBeUndefined();
});

it('preserves underlying run state and busy authority on approval resolution', () => {
  const registry = new SessionRunRegistry(); registry.registerRun('one', 'run'); registry.observePhase('one', 'running', 'run');
  registry.approvals.observe('one', [approval('a'), approval('b')]);
  registry.approvals.observe('one', approvalDecisionAction(approval('a'), 'allow-once')([approval('a')]));
  expect(registry.presentationPhaseFor('one')).toBe('needs-user');
  registry.approvals.observe('one', [approval('b', true)]);
  expect(registry.presentationPhaseFor('one')).toBe('running'); expect(registry.isBusy('one')).toBe(true); expect(registry.runFor('one')).toBe('run');
});

it('reconciles list absence only for captured candidates, including rows no longer visible', () => {
  const registry = new SessionRunRegistry(); registry.approvals.observe('one', [approval('old')]);
  const candidates = registry.approvals.pendingIds('one'); registry.approvals.observe('one', [approval('new')]);
  registry.approvals.resolveAbsent('one', candidates, []);
  expect(registry.presentationPhaseFor('one')).toBe('needs-user'); expect(registry.approvals.pendingIds('one')).toEqual(['new']);
  registry.approvals.resolveAbsent('one', ['new'], []); registry.approvals.observe('one', [approval('old')]);
  expect(registry.presentationPhaseFor('one')).toBeUndefined();
});

it('bounds identities without forgetting a terminal and falsely clearing overflow attention', () => {
  const registry = new SessionRunRegistry();
  registry.approvals.observe('one', Array.from({ length: 1100 }, (_, i) => approval(`old-${i}`, true)));
  registry.approvals.observe('one', [approval('old-0')]); expect(registry.presentationPhaseFor('one')).toBeUndefined();
  registry.approvals.observe('one', [approval('overflow')]); expect(registry.presentationPhaseFor('one')).toBe('needs-user');
  expect(registry.approvals.pendingIds('one')).toHaveLength(0);
  registry.approvals.resolveAbsent('one', [], []); expect(registry.presentationPhaseFor('one')).toBe('needs-user');
  registry.clear(); expect(registry.presentationPhaseFor('one')).toBeUndefined();
});

it('ignores foreign rows and disposes attention with registry restoration', () => {
  const registry = new SessionRunRegistry(); registry.approvals.observe('two', [approval('a')]);
  expect(registry.presentationPhaseFor('two')).toBeUndefined(); registry.approvals.observe('one', [approval('a')]);
  registry.restore(null); expect(registry.presentationPhaseFor('one')).toBeUndefined();
});

it('releases a legacy approval phase when modern terminal or list evidence resolves every known approval', () => {
  const registry = new SessionRunRegistry(); registry.registerRun('one', 'run');
  registry.observePhase('one', 'needs-user', 'run'); registry.approvals.observe('one', [approval('a'), approval('b')]);
  registry.approvals.observe('one', [approval('a', true)]); expect(registry.presentationPhaseFor('one')).toBe('needs-user');
  registry.approvals.resolveAbsent('one', ['b'], []);
  expect(registry.presentationPhaseFor('one')).toBe('running'); expect(registry.runFor('one')).toBe('run');
});

it('keeps operational run truth separate from approval presentation', () => {
  const registry = new SessionRunRegistry(); registry.registerRun('one', 'run');
  registry.approvals.observe('one', [approval('a')]);
  expect(registry.phaseFor('one')).toBe('accepted');
  expect(registry.presentationPhaseFor('one')).toBe('needs-user');
  registry.observePhase('one', 'completed', 'run');
  expect(registry.phaseFor('one')).toBe('completed');
  expect(registry.isBusy('one')).toBe(false);
});

it('does not restore approval phase from a delayed legacy request after its terminal identity', async () => {
  const { runLifecycleSignalForGatewayFrame, ownedRunLifecycleSignal } = await import('./runLifecycleProjection');
  const { applySessionRegistryLifecycleSignal } = await import('./sessionRegistryLifecycle');
  const test = setup('older', true); test.registry.registerRun('one', 'run');
  const terminal = { event: 'exec.approval.resolved', payload: { sessionKey: 'one', runId: 'run', id: 'late', decision: 'allow-once' } };
  test.publish('one', rows => upsertLiveMessage(rows, projectGatewayEvent(terminal, 'one')!.message));
  const request = { event: 'exec.approval.requested', payload: { sessionKey: 'one', runId: 'run', id: 'late', request: { sessionKey: 'one', command: 'pwd' } } };
  const raw = runLifecycleSignalForGatewayFrame(request);
  if (raw) test.registry.observePhase(raw.sessionKey, raw.phase, raw.runId, raw);
  test.publish('one', rows => upsertLiveMessage(rows, projectGatewayEvent(request, 'one')!.message));
  expect(test.registry.presentationPhaseFor('one')).not.toBe('needs-user');
  expect(ownedRunLifecycleSignal({ sessionKey: 'one', runId: 'run', phase: 'running' }, test.registry)).not.toBeNull();
  expect(applySessionRegistryLifecycleSignal(test.registry, { sessionKey: 'one', runId: 'run', phase: 'running' })).toBe(true);
});
