import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentWaitResult, OpenClawClient } from './OpenClawClient';
import type { WorkspaceMessage } from '../workspace/workspaceTypes';
import { HistoryPublicationAuthority } from './historyPublicationAuthority';
import { PendingFinalAnswerRegistry } from './pendingFinalAnswerRegistry';
import { SessionRunMonitorOwners } from './sessionRunMonitorOwners';
import { SessionRunRegistry } from './sessionRunRegistry';

const background = vi.hoisted(() => ({ tasks: [] as Promise<unknown>[] }));
vi.mock('react', () => ({ useCallback: (callback: unknown) => callback }));
vi.mock('../async/guardedBackgroundTask', async (original) => ({
  ...await original<object>(),
  launchGuardedBackgroundTask: (run: () => unknown, onFailure: (error: unknown) => void) => {
    background.tasks.push(Promise.resolve(run()).catch(onFailure));
  },
}));
import { retainSilentTerminalRun, sessionRunIdentity, useGatewayRunMonitor } from './useGatewayRunMonitor';

function deferred<T>() {
  let resolve!: (value: T) => void; let reject!: (error: Error) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}
function setup() {
  const wait = deferred<AgentWaitResult>();
  const history = deferred<WorkspaceMessage[] | undefined>();
  const registry = new SessionRunRegistry(); const owners = new SessionRunMonitorOwners();
  const pending = new PendingFinalAnswerRegistry(); const scene = new HistoryPublicationAuthority();
  registry.registerRun('one', 'old-run');
  const dependencies: Parameters<typeof useGatewayRunMonitor>[0] = {
    client: { status: 'connected', waitForRun: vi.fn(() => wait.promise) } as unknown as OpenClawClient,
    selectedRef: { current: 'one' }, runRegistry: { current: registry },
    recoveryTasks: { current: owners }, pendingFinalAnswers: { current: pending },
    silentTerminalRuns: { current: new Set<string>() },
    hasPublishedFinalForRun: vi.fn(() => false),
    loadHistory: vi.fn(() => history.promise), updateSessionMessages: vi.fn(),
    persistPendingFinalAnswers: vi.fn(), persistRuns: vi.fn(), publishSelectedRun: vi.fn(),
    settleVisibleCompletion: vi.fn(), startFinalAnswerRecovery: vi.fn(), setDetail: vi.fn(),
    scenePublicationAuthority: { current: scene },
  };
  const monitor = useGatewayRunMonitor(dependencies);
  monitor.startRunMonitor('old-run', 'one');
  const replace = () => {
    registry.observePhase('one', 'completed', 'old-run');
    registry.beginSubmission('one'); registry.registerRun('one', 'new-run');
    owners.claim('one', 'new-run');
  };
  return { wait, history, registry, owners, pending, scene, dependencies, monitor, replace };
}

describe('run-monitor continuation authority', () => {
  beforeEach(() => { background.tasks = []; });

  it('does not refresh or recover an old run after its replacement owns the thread', async () => {
    const context = setup(); context.replace(); context.history.resolve([]);
    context.wait.resolve({ status: 'completed' }); await background.tasks[0];
    expect(context.dependencies.loadHistory).not.toHaveBeenCalled();
    expect(context.dependencies.startFinalAnswerRecovery).not.toHaveBeenCalled();
    expect(context.pending.entries()).toEqual([]);
    expect(context.registry.runFor('one')).toBe('new-run');
    expect(context.owners.runFor('one')).toBe('new-run');
  });

  it('does not publish an old wait rejection over the replacement run detail', async () => {
    const context = setup(); context.replace();
    context.wait.reject(new Error('socket closed')); await background.tasks[0];
    expect(context.dependencies.setDetail).not.toHaveBeenCalled();
    expect(context.dependencies.publishSelectedRun).not.toHaveBeenCalled();
    expect(context.registry.phaseFor('one')).toBe('accepted');
  });

  it('releases transient silent-terminal coordination when its monitor exits without history settlement', async () => {
    const context = setup();
    context.dependencies.silentTerminalRuns.current.add(sessionRunIdentity('one', 'old-run'));
    context.wait.reject(new Error('socket closed')); await background.tasks[0];
    expect(context.dependencies.silentTerminalRuns.current).toEqual(new Set());
  });

  it('retains silent-terminal coordination only for the exact current monitor', () => {
    const owners = new SessionRunMonitorOwners(); const silent = new Set<string>();
    expect(retainSilentTerminalRun(silent, owners, 'one', 'old-run')).toBe(false);
    owners.claim('one', 'old-run');
    expect(retainSilentTerminalRun(silent, owners, 'one', 'old-run')).toBe(true);
    owners.claim('one', 'new-run');
    expect(retainSilentTerminalRun(silent, owners, 'one', 'new-run')).toBe(true);
    expect(silent).toEqual(new Set([sessionRunIdentity('one', 'new-run')]));
  });

  it('retires old final recovery when a replacement starts during the history await', async () => {
    const context = setup(); context.wait.resolve({ status: 'completed' });
    await vi.waitFor(() => expect(context.dependencies.loadHistory).toHaveBeenCalledOnce());
    context.replace(); context.history.resolve([]); await background.tasks[0];
    expect(context.dependencies.settleVisibleCompletion).not.toHaveBeenCalled();
    expect(context.pending.entries()).toEqual([]);
    expect(context.dependencies.startFinalAnswerRecovery).not.toHaveBeenCalled();
  });

  it('does not publish an old failed wait after its history request loses ownership', async () => {
    const context = setup(); context.wait.resolve({ status: 'failed', error: 'old failure' });
    await vi.waitFor(() => expect(context.dependencies.loadHistory).toHaveBeenCalledOnce());
    context.replace(); vi.mocked(context.dependencies.setDetail).mockClear();
    context.history.reject(new Error('old history unavailable')); await background.tasks[0];
    expect(context.dependencies.updateSessionMessages).not.toHaveBeenCalled();
    expect(context.dependencies.setDetail).not.toHaveBeenCalled();
    expect(context.registry.runFor('one')).toBe('new-run');
  });

  it('does not let a retired same-run ticket regain authority after replacement', async () => {
    const context = setup(); context.owners.clear(); context.owners.claim('one', 'old-run');
    context.history.resolve([]); context.wait.resolve({ status: 'completed' }); await background.tasks[0];
    expect(context.dependencies.loadHistory).not.toHaveBeenCalled();
    expect(context.registry.phaseFor('one')).toBe('accepted');
    expect(context.owners.runFor('one')).toBe('old-run');
  });

  it('preserves a successor submission before that new run can claim a monitor', async () => {
    const context = setup();
    context.registry.observePhase('one', 'completed', 'old-run');
    context.registry.beginSubmission('one');
    context.history.resolve([]); context.wait.resolve({ status: 'completed' }); await background.tasks[0];
    expect(context.registry.phaseFor('one')).toBe('submitting');
    expect(context.dependencies.loadHistory).not.toHaveBeenCalled();
    expect(context.pending.entries()).toEqual([]);
  });

  it('does not admit an old monitor over the replacement owner', async () => {
    const context = setup(); context.replace();
    context.monitor.startRunMonitor('old-run', 'one');
    expect(context.owners.runFor('one')).toBe('new-run');
    expect(context.dependencies.client.waitForRun).toHaveBeenCalledOnce();
    context.wait.resolve({ status: 'completed' }); await background.tasks[0];
  });

  it('settles the current final exactly once and releases its monitor', async () => {
    const context = setup();
    context.monitor.startRunMonitor('old-run', 'one');
    context.history.resolve([{ id: 'final', role: 'assistant', text: 'answer', runId: 'old-run', sessionKey: 'one', source: 'history' }]);
    context.wait.resolve({ status: 'completed' }); await background.tasks[0];
    expect(context.dependencies.client.waitForRun).toHaveBeenCalledOnce();
    expect(context.dependencies.settleVisibleCompletion).toHaveBeenCalledExactlyOnceWith('one', 'old-run');
    expect(context.dependencies.startFinalAnswerRecovery).not.toHaveBeenCalled();
    expect(context.registry.runFor('one')).toBe('');
    expect(context.registry.phaseFor('one')).toBe('completed');
    expect(context.owners.runFor('one')).toBe('');
    expect(context.pending.entries()).toEqual([]);
  });

  it('does not start stale recovery when the published transcript already has the exact final', async () => {
    const context = setup();
    vi.mocked(context.dependencies.hasPublishedFinalForRun).mockReturnValue(true);
    context.history.resolve([]);
    context.wait.resolve({ status: 'completed' }); await background.tasks[0];
    expect(context.dependencies.settleVisibleCompletion).toHaveBeenCalledExactlyOnceWith('one', 'old-run');
    expect(context.dependencies.startFinalAnswerRecovery).not.toHaveBeenCalled();
    expect(context.pending.entries()).toEqual([]);
  });

  it('continues current missing-final recovery after run terminal state clears active ownership', async () => {
    const context = setup(); context.history.resolve([]);
    context.wait.resolve({ status: 'completed' }); await background.tasks[0];
    expect(context.dependencies.settleVisibleCompletion).toHaveBeenCalledExactlyOnceWith('one', 'old-run', true);
    expect(context.dependencies.startFinalAnswerRecovery).toHaveBeenCalledExactlyOnceWith('one', 'old-run');
    expect(context.pending.owns('one', 'old-run')).toBe(true);
    expect(context.registry.isBusy('one')).toBe(false);
    expect(context.owners.runFor('one')).toBe('');
  });

  it('preserves a current definitive failure when history cannot be fetched', async () => {
    const context = setup(); context.wait.resolve({ status: 'failed', error: 'provider denied request' });
    await vi.waitFor(() => expect(context.dependencies.loadHistory).toHaveBeenCalledOnce());
    context.history.reject(new Error('history unavailable')); await background.tasks[0];
    expect(context.registry.phaseFor('one')).toBe('failed');
    expect(context.dependencies.updateSessionMessages).toHaveBeenCalledOnce();
    const [sessionKey, update] = vi.mocked(context.dependencies.updateSessionMessages).mock.calls[0]!;
    const rows = typeof update === 'function' ? update([]) : update;
    expect(sessionKey).toBe('one');
    expect(rows).toEqual([expect.objectContaining({ role: 'error', runId: 'old-run', sessionKey: 'one', text: expect.stringContaining('provider denied request') })]);
    expect(context.owners.runFor('one')).toBe('');
  });

  it('retries a current wait timeout then settles without admitting overlapping monitors', async () => {
    const context = setup();
    vi.mocked(context.dependencies.client.waitForRun).mockResolvedValueOnce({ status: 'completed' });
    context.history.resolve([]); context.wait.resolve({ status: 'timeout', timeoutPhase: 'queue' });
    await background.tasks[0];
    expect(context.dependencies.client.waitForRun).toHaveBeenCalledTimes(2);
    expect(context.dependencies.setDetail).toHaveBeenCalledWith('running: queue');
    expect(context.dependencies.startFinalAnswerRecovery).toHaveBeenCalledExactlyOnceWith('one', 'old-run');
  });

  it('settles the originating run while another thread is selected without overwriting its detail', async () => {
    const context = setup(); context.dependencies.selectedRef.current = 'two';
    context.registry.registerRun('two', 'other-run'); context.history.resolve([]);
    context.wait.resolve({ status: 'completed' }); await background.tasks[0];
    expect(context.dependencies.setDetail).not.toHaveBeenCalled();
    expect(context.dependencies.startFinalAnswerRecovery).toHaveBeenCalledExactlyOnceWith('one', 'old-run');
    expect(context.registry.runFor('two')).toBe('other-run');
    expect(context.registry.phaseFor('two')).toBe('accepted');
  });

  it.each(['completed', 'rejected'] as const)('rejects a %s wait from a retired foreground epoch after resuming', async (outcome) => {
    const context = setup(); context.scene.suspend(); context.scene.resume();
    if (outcome === 'completed') context.wait.resolve({ status: 'completed' });
    else context.wait.reject(new Error('socket closed'));
    await background.tasks[0];
    expect(context.dependencies.loadHistory).not.toHaveBeenCalled();
    expect(context.dependencies.setDetail).not.toHaveBeenCalled();
    expect(context.dependencies.publishSelectedRun).not.toHaveBeenCalled();
    expect(context.registry.phaseFor('one')).toBe('accepted');
    expect(context.owners.runFor('one')).toBe('');
  });

  it('readmits the same active run on resume before its old request has drained', async () => {
    const context = setup(); const resumed = deferred<AgentWaitResult>();
    vi.mocked(context.dependencies.client.waitForRun).mockReturnValue(resumed.promise);
    context.scene.suspend(); context.scene.resume();
    context.monitor.recoverActiveRuns(); context.monitor.recoverActiveRuns();
    const requests = vi.mocked(context.dependencies.client.waitForRun).mock.calls.length;
    context.wait.reject(new Error('old connection closed')); await background.tasks[0];
    const ownerAfterOldDrain = context.owners.runFor('one');
    context.history.resolve([]); resumed.resolve({ status: 'completed' }); await Promise.all(background.tasks);
    expect(requests).toBe(2);
    expect(ownerAfterOldDrain).toBe('old-run');
    expect(context.dependencies.setDetail).not.toHaveBeenCalledWith('run interrupted; waiting to reconnect');
    expect(context.dependencies.startFinalAnswerRecovery).toHaveBeenCalledExactlyOnceWith('one', 'old-run');
    expect(context.owners.runFor('one')).toBe('');
  });

  it('does not publish failure or recovery when backgrounded during the history await', async () => {
    const context = setup(); context.wait.resolve({ status: 'failed', error: 'old failure' });
    await vi.waitFor(() => expect(context.dependencies.loadHistory).toHaveBeenCalledOnce());
    context.scene.suspend(); vi.mocked(context.dependencies.publishSelectedRun).mockClear();
    vi.mocked(context.dependencies.setDetail).mockClear();
    context.history.reject(new Error('socket closed')); await background.tasks[0];
    expect(context.dependencies.updateSessionMessages).not.toHaveBeenCalled();
    expect(context.dependencies.publishSelectedRun).not.toHaveBeenCalled();
    expect(context.dependencies.setDetail).not.toHaveBeenCalled();
    expect(context.owners.runFor('one')).toBe('');
  });

  it('contains a current publication callback failure before releasing its exact ticket', async () => {
    const context = setup();
    vi.mocked(context.dependencies.persistRuns).mockImplementation(() => { throw new Error('run persistence failed'); });
    context.wait.resolve({ status: 'completed' }); await background.tasks[0];
    expect(context.dependencies.setDetail).toHaveBeenLastCalledWith('run persistence failed');
    expect(context.owners.runFor('one')).toBe('');
  });
});
