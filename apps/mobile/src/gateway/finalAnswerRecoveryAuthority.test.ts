import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { OpenClawClient } from './OpenClawClient';
import type { WorkspaceMessage } from '../workspace/workspaceTypes';
import { HistoryPublicationAuthority } from './historyPublicationAuthority';
import { FINAL_ANSWER_RECOVERY_DELAYS_MS, PendingFinalAnswerRegistry } from './pendingFinalAnswerRegistry';
import { SessionRunMonitorOwners } from './sessionRunMonitorOwners';
import { SessionRunRegistry } from './sessionRunRegistry';
import { applySessionRegistryLifecycleSignal, sessionRegistryLifecycleSignals } from './sessionRegistryLifecycle';
import { messagesFromPayload } from '../workspace/historyMessageProjection';
// @ts-expect-error Vitest's Node runtime provides this test-only module.
import { createRequire } from 'node:module';

// Exercise the same AbortController implementation installed by RN setUpXHR.
const require = createRequire(import.meta.url);
const nativeRequire = createRequire(require.resolve('react-native/package.json'));
const NativeAbortController = nativeRequire('abort-controller').AbortController as typeof AbortController;

const background = vi.hoisted(() => ({ tasks: [] as Promise<unknown>[] }));
vi.mock('react', () => ({ useCallback: (callback: unknown) => callback }));
vi.mock('../async/guardedBackgroundTask', async (original) => ({
  ...await original<object>(),
  launchGuardedBackgroundTask: (run: () => unknown, onFailure?: (error: unknown) => void) => {
    background.tasks.push(Promise.resolve(run()).catch(error => onFailure?.(error)));
  },
}));
import { useGatewayFinalAnswerRecovery } from './useGatewayFinalAnswerRecovery';

function deferred<T>() {
  let resolve!: (value: T) => void; let reject!: (error: Error) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}
const final = (runId: string): WorkspaceMessage => ({ id: `final-${runId}`, role: 'assistant', text: `answer ${runId}`, runId, source: 'history', sessionKey: 'one' });
function setup(runIds = ['r1']) {
  const history = deferred<WorkspaceMessage[]>();
  const pending = new PendingFinalAnswerRegistry(); const owners = new SessionRunMonitorOwners();
  const scene = new HistoryPublicationAuthority(); const registry = new SessionRunRegistry();
  for (const id of runIds) pending.register('one', id);
  const dependencies: Parameters<typeof useGatewayFinalAnswerRecovery>[0] = {
    client: { status: 'connected' } as OpenClawClient,
    selectedRef: { current: 'one' }, runRegistry: { current: registry },
    pendingFinalAnswers: { current: pending }, recoveryTasks: { current: owners },
    scenePublicationAuthority: { current: scene },
    hasPublishedFinalForRun: vi.fn(() => false),
    loadHistory: vi.fn(() => history.promise), updateSessionMessages: vi.fn(),
    persistPendingFinalAnswers: vi.fn(), persistRuns: vi.fn(), publishSelectedRun: vi.fn(), setDetail: vi.fn(),
  };
  const controller = useGatewayFinalAnswerRecovery(dependencies);
  return { history, pending, owners, scene, registry, dependencies, controller };
}

describe('pending-final recovery task authority', () => {
  beforeEach(() => { vi.stubGlobal('AbortController', NativeAbortController); vi.useFakeTimers(); background.tasks = []; });
  afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); });

  it('recovers an answer after an overnight absence instead of expiring the durable obligation', async () => {
    const context = setup([]);
    context.pending.register('one', 'overnight', Date.now() - 24 * 60 * 60_000);
    context.controller.recoverPendingFinalAnswers();
    context.history.resolve([final('overnight')]);
    await vi.advanceTimersByTimeAsync(250); await Promise.all(background.tasks);
    expect(context.dependencies.updateSessionMessages).toHaveBeenCalledOnce();
    expect(context.pending.entries()).toEqual([]);
  });

  it('uses one session poll and timer for a backlog without discarding any run', async () => {
    const runs = Array.from({ length: 40 }, (_, index) => `run-${index}`);
    const context = setup(runs);
    context.controller.recoverPendingFinalAnswers();
    const timers = vi.getTimerCount();
    await vi.advanceTimersByTimeAsync(250);
    context.history.resolve(runs.map(final)); await Promise.all(background.tasks);
    expect(timers).toBe(1);
    expect(context.dependencies.loadHistory).toHaveBeenCalledOnce();
    expect(context.dependencies.updateSessionMessages).toHaveBeenCalledTimes(runs.length);
    expect(context.pending.entries()).toEqual([]);
  });

  it('checks a run added during an existing poll without starting a second timer', async () => {
    const context = setup(); context.controller.recoverPendingFinalAnswers();
    await vi.advanceTimersByTimeAsync(250);
    context.pending.register('one', 'new'); context.controller.startFinalAnswerRecovery('one', 'new');
    context.history.resolve([final('r1'), final('new')]); await Promise.all(background.tasks);
    expect(context.dependencies.loadHistory).toHaveBeenCalledOnce();
    expect(context.pending.entries()).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('admits one recovery per selected session across repeated recovery sweeps', async () => {
    const context = setup(['r1', 'r2']);
    context.controller.recoverPendingFinalAnswers(); context.controller.recoverPendingFinalAnswers();
    await vi.advanceTimersByTimeAsync(250);
    const requests = vi.mocked(context.dependencies.loadHistory).mock.calls.length;
    context.history.resolve([final('r1'), final('r2')]); await Promise.all(background.tasks);
    expect(requests).toBe(1);
    expect(context.dependencies.updateSessionMessages).toHaveBeenCalledTimes(2);
    expect(context.pending.entries()).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('keeps independent pending runs recoverable instead of retiring the older run', async () => {
    const context = setup(['r1', 'r2']); context.controller.recoverPendingFinalAnswers();
    await vi.advanceTimersByTimeAsync(250);
    context.history.resolve([final('r1'), final('r2')]); await Promise.all(background.tasks);
    expect(context.dependencies.loadHistory).toHaveBeenCalledOnce();
    const settled = vi.mocked(context.dependencies.updateSessionMessages).mock.calls.flatMap(([, update]) => typeof update === 'function' ? update([]) : update);
    expect(settled.map(row => row.runId).sort()).toEqual(['r1', 'r2']);
    expect(context.pending.entries()).toEqual([]);
    expect(context.registry.phaseFor('one')).toBeUndefined();
  });

  it.each(['fast', 'steady'] as const)('readmits pending recovery immediately after resuming during its %s wait', async (cadence) => {
    const context = setup();
    vi.mocked(context.dependencies.loadHistory).mockResolvedValue([]);
    context.controller.recoverPendingFinalAnswers();
    if (cadence === 'steady') await vi.advanceTimersByTimeAsync(FINAL_ANSWER_RECOVERY_DELAYS_MS.reduce((total, delay) => total + delay, 0));
    const beforeResume = vi.mocked(context.dependencies.loadHistory).mock.calls.length;
    context.scene.suspend(); const suspendedTimers = vi.getTimerCount(); context.scene.resume();
    vi.mocked(context.dependencies.loadHistory).mockResolvedValue([final('r1')]);
    context.controller.recoverPendingFinalAnswers(); context.controller.recoverPendingFinalAnswers();
    await vi.advanceTimersByTimeAsync(250);
    const afterResume = vi.mocked(context.dependencies.loadHistory).mock.calls.length;
    const recovered = !context.pending.owns('one', 'r1');
    context.scene.suspend(); await vi.advanceTimersByTimeAsync(60_000); await Promise.all(background.tasks);
    expect(suspendedTimers).toBe(0);
    expect(afterResume - beforeResume).toBe(1);
    expect(recovered).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('readmits before a retired history request returns and keeps its late final inert', async () => {
    const context = setup(); const resumed = deferred<WorkspaceMessage[]>();
    vi.mocked(context.dependencies.loadHistory).mockReturnValueOnce(context.history.promise).mockReturnValue(resumed.promise);
    context.controller.recoverPendingFinalAnswers(); await vi.advanceTimersByTimeAsync(250);
    context.scene.suspend(); context.scene.resume(); context.controller.recoverPendingFinalAnswers();
    await vi.advanceTimersByTimeAsync(250);
    const requests = vi.mocked(context.dependencies.loadHistory).mock.calls.length;
    context.history.resolve([final('r1')]); await background.tasks[0];
    expect(context.pending.owns('one', 'r1')).toBe(true);
    resumed.resolve([final('r1')]); await Promise.all(background.tasks);
    expect(requests).toBe(2);
    expect(context.dependencies.updateSessionMessages).toHaveBeenCalledOnce();
    expect(context.pending.entries()).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('rejects an old history result after its exact recovery ticket was replaced', async () => {
    const context = setup(); context.controller.recoverPendingFinalAnswers();
    await vi.advanceTimersByTimeAsync(250);
    context.owners.clear(); context.controller.recoverPendingFinalAnswers();
    context.history.resolve([final('r1')]); await background.tasks[0];
    const pendingBeforeSuccessor = context.pending.owns('one', 'r1');
    const stalePublications = vi.mocked(context.dependencies.updateSessionMessages).mock.calls.length;
    await vi.advanceTimersByTimeAsync(250); await Promise.all(background.tasks);
    expect(pendingBeforeSuccessor).toBe(true);
    expect(stalePublications).toBe(0);
    expect(context.dependencies.loadHistory).toHaveBeenCalledTimes(2);
    expect(context.pending.entries()).toEqual([]);
  });

  it('ignores an old rejected history request after its ticket was replaced', async () => {
    const context = setup(); context.controller.recoverPendingFinalAnswers();
    await vi.advanceTimersByTimeAsync(250);
    context.owners.clear(); context.controller.recoverPendingFinalAnswers();
    context.history.reject(new Error('retired history failed'));
    await vi.advanceTimersByTimeAsync(0);
    const staleDetails = vi.mocked(context.dependencies.setDetail).mock.calls.slice();
    context.scene.suspend(); await vi.advanceTimersByTimeAsync(1_000); await Promise.all(background.tasks);
    expect(staleDetails).toEqual([]);
    expect(context.pending.owns('one', 'r1')).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(['scene', 'selection', 'pending'] as const)('retires a history continuation when %s authority changes', async (authority) => {
    const context = setup(); context.controller.recoverPendingFinalAnswers();
    await vi.advanceTimersByTimeAsync(250);
    if (authority === 'scene') { context.scene.suspend(); context.scene.resume(); }
    if (authority === 'selection') context.dependencies.selectedRef.current = 'two';
    if (authority === 'pending') context.pending.settle('one', 'r1');
    context.history.resolve([final('r1')]); await Promise.all(background.tasks);
    expect(context.dependencies.updateSessionMessages).not.toHaveBeenCalled();
    expect(context.dependencies.setDetail).not.toHaveBeenCalled();
    expect(context.registry.phaseFor('one')).toBeUndefined();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('continues after one transient history failure and recovers the current final', async () => {
    const context = setup();
    vi.mocked(context.dependencies.loadHistory).mockRejectedValueOnce(new Error('temporary history failure'));
    context.controller.recoverPendingFinalAnswers(); await vi.advanceTimersByTimeAsync(250);
    expect(context.pending.owns('one', 'r1')).toBe(true);
    context.history.resolve([final('r1')]); await vi.advanceTimersByTimeAsync(750); await Promise.all(background.tasks);
    expect(context.dependencies.loadHistory).toHaveBeenCalledTimes(2);
    expect(context.dependencies.setDetail).toHaveBeenLastCalledWith('delayed final answer recovered');
    expect(context.pending.entries()).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('settles from the published transcript without injecting a stale pending row', async () => {
    const context = setup();
    vi.mocked(context.dependencies.hasPublishedFinalForRun).mockReturnValue(true);
    vi.mocked(context.dependencies.loadHistory).mockResolvedValue([]);
    context.controller.recoverPendingFinalAnswers();
    await vi.advanceTimersByTimeAsync(250);
    const recoveredAfterFirstPoll = !context.pending.owns('one', 'r1');
    context.scene.suspend(); await vi.runOnlyPendingTimersAsync(); await Promise.all(background.tasks);
    expect(recoveredAfterFirstPoll).toBe(true);
    expect(context.dependencies.updateSessionMessages).toHaveBeenCalledOnce();
    const [, update] = vi.mocked(context.dependencies.updateSessionMessages).mock.calls[0]!;
    const rows = typeof update === 'function' ? update([final('r1')]) : update;
    expect(rows).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ text: '… run completed · final answer pending' }),
    ]));
  });

  it('publishes one pending row for the tracked run rather than one per backlog entry', async () => {
    const context = setup(['r1', 'r2', 'r3']);
    context.registry.registerRun('one', 'r2');
    vi.mocked(context.dependencies.loadHistory).mockResolvedValue([]);
    context.controller.recoverPendingFinalAnswers();
    // Every poller shares one ladder, so they exhaust together and each used to
    // append its own identical row at the transcript tail.
    await vi.advanceTimersByTimeAsync(FINAL_ANSWER_RECOVERY_DELAYS_MS.reduce((total, delay) => total + delay, 0));

    const pendingRows = vi.mocked(context.dependencies.updateSessionMessages).mock.calls
      .flatMap(([, update]) => typeof update === 'function' ? update([]) : update)
      .filter(row => row.text === '… run completed · final answer pending');
    expect(pendingRows.map(row => row.runId)).toEqual(['r2']);

    context.scene.suspend(); await vi.advanceTimersByTimeAsync(60_000); await Promise.all(background.tasks);
  });

  it('rechecks the tracked run when an exhausted pending notice commits after a handoff', async () => {
    const context = setup(); context.registry.registerRun('one', 'r1');
    vi.mocked(context.dependencies.loadHistory).mockResolvedValue([]);
    context.controller.recoverPendingFinalAnswers();
    await vi.advanceTimersByTimeAsync(FINAL_ANSWER_RECOVERY_DELAYS_MS.reduce((sum, delay) => sum + delay, 0));
    const [, update] = vi.mocked(context.dependencies.updateSessionMessages).mock.calls[0]!;
    context.registry.registerRun('one', 'newer');
    expect(typeof update === 'function' ? update([]) : update).toEqual([]);
    context.scene.suspend(); await vi.advanceTimersByTimeAsync(60_000); await Promise.all(background.tasks);
  });

  it('reports a current settlement callback failure before releasing task authority', async () => {
    const context = setup();
    vi.mocked(context.dependencies.persistPendingFinalAnswers).mockImplementation(() => { throw new Error('pending persistence failed'); });
    context.controller.recoverPendingFinalAnswers(); context.history.resolve([final('r1')]);
    await vi.advanceTimersByTimeAsync(250); await Promise.all(background.tasks);
    expect(context.dependencies.setDetail).toHaveBeenLastCalledWith('pending persistence failed');
    context.pending.register('one', 'r1'); context.controller.recoverPendingFinalAnswers();
    expect(background.tasks).toHaveLength(2);
    context.scene.suspend(); await vi.advanceTimersByTimeAsync(250); await Promise.all(background.tasks);
  });

  it('settles an older pending final without replacing a newer terminal lifecycle identity', async () => {
    const context = setup(); context.registry.registerRun('one', 'newer'); context.registry.finishRun('one', 'newer');
    context.controller.recoverPendingFinalAnswers(); context.history.resolve([final('r1')]);
    await vi.advanceTimersByTimeAsync(250); await Promise.all(background.tasks);
    expect(context.pending.entries()).toEqual([]);
    expect(context.dependencies.updateSessionMessages).toHaveBeenCalledOnce();
    expect(context.registry.ownsRun('one', 'newer')).toBe(true);
    expect(context.registry.ownsRun('one', 'r1')).toBe(false);
  });

  it('still completes a matching tracked run when its delayed final arrives', async () => {
    const context = setup(); context.registry.registerRun('one', 'r1');
    context.controller.recoverPendingFinalAnswers(); context.history.resolve([final('r1')]);
    await vi.advanceTimersByTimeAsync(250); await Promise.all(background.tasks);
    expect(context.registry.phaseFor('one')).toBe('completed');
    expect(context.registry.runFor('one')).toBe('');
    expect(context.pending.entries()).toEqual([]);
  });

  it('recovers a prior answer while a census confirms a newer run is active', async () => {
    const context = setup(['older']);
    const [signal] = sessionRegistryLifecycleSignals({ sessions: [{ key: 'one', hasActiveRun: true, activeRunIds: ['newer'] }] });
    applySessionRegistryLifecycleSignal(context.registry, signal!);
    context.controller.recoverPendingFinalAnswers();
    context.history.resolve(messagesFromPayload({ sessionKey: 'one', messages: [
      { id: 'older-final', role: 'assistant', content: 'Recovered older answer', __openclaw: { runId: 'older' } },
    ] }));
    await vi.advanceTimersByTimeAsync(250); await Promise.all(background.tasks);
    expect(context.pending.entries()).toEqual([]);
    expect(context.dependencies.updateSessionMessages).toHaveBeenCalledOnce();
    expect(context.registry.runFor('one')).toBe('newer');
    expect(context.registry.phaseFor('one')).toBe('running');
  });
});
