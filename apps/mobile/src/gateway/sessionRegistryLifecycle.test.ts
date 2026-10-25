import { gatewayResponseFailure } from './gatewayRequestDelivery';
import { describe, expect, it } from 'vitest';
import { SessionRunRegistry } from './sessionRunRegistry';
import { applySessionRegistryLifecycleSignal, captureSessionCensusRequests, refreshSelectedSessionRunTruth, sessionRegistryLifecycleSignals } from './sessionRegistryLifecycle';

describe('session registry lifecycle', () => {
  it('projects only authoritative session lifecycle states', () => {
    expect(sessionRegistryLifecycleSignals({ sessions: [
      { key: 'done', status: 'completed' },
      { key: 'timeout', status: 'timeout' },
      { key: 'live', hasActiveRun: true, activeRunId: 'r1' },
      { key: 'unknown', status: 'mystery' },
    ] })).toEqual([
      { sessionKey: 'done', runId: '', phase: 'completed' },
      { sessionKey: 'timeout', runId: '', phase: 'failed' },
      { sessionKey: 'live', runId: 'r1', phase: 'running' },
    ]);
  });

  it('reads the real OpenClaw activeRunIds census shape', () => {
    expect(sessionRegistryLifecycleSignals({ sessions: [
      { key: 'live', status: 'running', hasActiveRun: true, activeRunIds: ['authoritative-run'] },
    ] })).toEqual([{ sessionKey: 'live', runId: 'authoritative-run', phase: 'running' }]);
  });

  it('prefers explicit active-run truth over a lagging idle label', () => {
    expect(sessionRegistryLifecycleSignals({ sessions: [
      { key: 'live', status: 'idle', hasActiveRun: true, activeRunIds: ['newer-run'] },
    ] })).toEqual([{ sessionKey: 'live', runId: 'newer-run', phase: 'running' }]);
  });

  it('rebinds a short-lived steering operation to the authoritative active run', () => {
    const registry = new SessionRunRegistry();
    registry.registerRun('live', 'steering-operation');
    registry.observePhase('live', 'completed', 'steering-operation');
    expect(applySessionRegistryLifecycleSignal(registry, {
      sessionKey: 'live', runId: 'authoritative-run', phase: 'running',
    })).toBe(true);
    expect(registry.runFor('live')).toBe('authoritative-run');
    expect(registry.phaseFor('live')).toBe('running');
  });

  it('does not let a run-less terminal census row settle a newer tracked run', () => {
    const registry = new SessionRunRegistry(); registry.registerRun('live', 'newer-run');
    expect(applySessionRegistryLifecycleSignal(registry, { sessionKey: 'live', runId: '', phase: 'completed' })).toBe(false);
    expect(registry.runFor('live')).toBe('newer-run');
    expect(registry.phaseFor('live')).toBe('accepted');
  });

  it('clears the tracked run when the complete census explicitly reports no active run', () => {
    const [signal] = sessionRegistryLifecycleSignals({ sessions: [
      { key: 'dotfiles', status: 'idle', hasActiveRun: false, activeRunIds: [] },
    ] });
    const registry = new SessionRunRegistry(); registry.registerRun('dotfiles', 'accepted-run');

    expect(signal).toEqual({
      sessionKey: 'dotfiles', runId: '', phase: 'completed', authoritativeNoActiveRun: true,
    });
    expect(applySessionRegistryLifecycleSignal(registry, signal!)).toBe(true);
    expect(registry.runFor('dotfiles')).toBe('');
    expect(registry.phaseFor('dotfiles')).toBe('completed');
  });

  it('does not apply a runless negative census after a newer live frame', async () => {
    const registry = new SessionRunRegistry();
    registry.registerRun('dotfiles', 'streaming-run');
    let resolve!: (payload: Record<string, unknown>) => void;
    const payload = new Promise<Record<string, unknown>>(done => { resolve = done; });
    const refresh = refreshSelectedSessionRunTruth({ listSessions: () => payload }, registry, 'dotfiles');
    registry.noteLiveFrame('dotfiles', 'streaming-run');
    registry.observePhase('dotfiles', 'running', 'streaming-run');
    resolve({ sessions: [{ key: 'dotfiles', status: 'idle', hasActiveRun: false, activeRunIds: [] }] });
    await expect(refresh).resolves.toBe(false);
    expect(registry.runFor('dotfiles')).toBe('streaming-run');
    expect(registry.phaseFor('dotfiles')).toBe('running');
  });

  it('prefers explicit active-run absence over a lagging running label', () => {
    expect(sessionRegistryLifecycleSignals({ sessions: [
      { key: 'dotfiles', status: 'running', hasActiveRun: false, activeRunIds: [] },
    ] })).toEqual([{
      sessionKey: 'dotfiles', runId: '', phase: 'completed', authoritativeNoActiveRun: true,
    }]);
  });

  it('self-heals a stale selected-session owner from a fresh census on reselection', async () => {
    const registry = new SessionRunRegistry();
    registry.registerRun('dotfiles', 'restored-stale-run');
    const reader = {
      listSessions: async () => ({ sessions: [
        { key: 'other', status: 'running', hasActiveRun: true, activeRunIds: ['other-run'] },
        { key: 'dotfiles', status: 'done', hasActiveRun: false },
      ] }),
    };

    await expect(refreshSelectedSessionRunTruth(reader, registry, 'dotfiles')).resolves.toBe(true);
    expect(registry.runFor('dotfiles')).toBe('');
    expect(registry.phaseFor('dotfiles')).toBe('completed');
    expect(registry.runFor('other')).toBe('');
  });

  it('keeps the selected run active when the fresh census names it', async () => {
    const registry = new SessionRunRegistry();
    registry.registerRun('dotfiles', 'active-run');

    await expect(refreshSelectedSessionRunTruth({
      listSessions: async () => ({ sessions: [
        { key: 'dotfiles', status: 'done', hasActiveRun: true, activeRunIds: ['active-run'] },
      ] }),
    }, registry, 'dotfiles')).resolves.toBe(true);
    expect(registry.runFor('dotfiles')).toBe('active-run');
    expect(registry.phaseFor('dotfiles')).toBe('running');
  });

  it('does not mutate restored run ownership after its scene revision retires', async () => {
    const registry = new SessionRunRegistry();
    registry.registerRun('dotfiles', 'restored-stale-run');
    let resolve!: (payload: Record<string, unknown>) => void;
    const payload = new Promise<Record<string, unknown>>((done) => { resolve = done; });
    let current = true;
    const refresh = refreshSelectedSessionRunTruth({ listSessions: () => payload }, registry, 'dotfiles', () => current);

    current = false;
    resolve({ sessions: [{ key: 'dotfiles', status: 'done', hasActiveRun: false }] });

    await expect(refresh).resolves.toBe(false);
    expect(registry.runFor('dotfiles')).toBe('restored-stale-run');
    expect(registry.phaseFor('dotfiles')).toBe('accepted');
  });
});


describe('selected live steering identity', () => {
  it('replaces a cached operation with the actual selected runtime target', async () => {
    const registry = new SessionRunRegistry(); registry.registerRun('live', 'stale-operation');
    const reader = { listSessions: async () => ({ sessions: [{ key: 'live', hasActiveRun: true, lastRunId: 'terminal' }] }),
      readSessionRunTruth: async () => ({ session: { key: 'live', hasActiveRun: true, activeRunId: 'actual-target' } }) };
    await refreshSelectedSessionRunTruth(reader, registry, 'live');
    expect(registry.runFor('live')).toBe('actual-target');
  });
  it('does not replace a newer live owner with an older positive response', async () => {
    const registry = new SessionRunRegistry(); registry.registerRun('live', 'old');
    let resolve!: (value: Record<string, unknown>) => void;
    const pending = new Promise<Record<string, unknown>>(done => { resolve = done; });
    const refresh = refreshSelectedSessionRunTruth({ listSessions: () => pending }, registry, 'live');
    registry.registerRun('live', 'successor'); registry.noteLiveFrame('live', 'successor');
    resolve({ sessions: [{ key: 'live', hasActiveRun: true, activeRunIds: ['old'] }] });
    expect(await refresh).toBe(false);
    expect(registry.runFor('live')).toBe('successor');
  });
  it('does not use another route from a scoped read', async () => {
    const registry = new SessionRunRegistry(); registry.registerRun('live', 'cached');
    const reader = { listSessions: async () => ({ sessions: [] }),
      readSessionRunTruth: async () => ({ session: { key: 'other', hasActiveRun: true, activeRunId: 'foreign' } }) };
    expect(await refreshSelectedSessionRunTruth(reader, registry, 'live')).toBe(false);
    expect(registry.runFor('live')).toBe('cached');
  });
});


it.each([
  { code: 'UNAVAILABLE', message: 'Active-run identity requires an audited Gateway runtime.' },
  { code: 'INVALID_REQUEST', message: 'unknown method: vimicate.runs.read' },
])('retains census recovery when the optional richer route is unavailable: $code', async failure => {
  const registry = new SessionRunRegistry(); registry.registerRun('live', 'cached');
  const reader = { listSessions: async () => ({ sessions: [{ key: 'live', hasActiveRun: false }] }),
    readSessionRunTruth: async () => { throw gatewayResponseFailure(failure); } };
  await expect(refreshSelectedSessionRunTruth(reader, registry, 'live')).resolves.toBe(true);
  expect(registry.runFor('live')).toBe('');
});
it('does not bypass denied richer reads via census fallback', async () => {
  const registry = new SessionRunRegistry(); let censusCalled = false;
  const reader = { listSessions: async () => { censusCalled = true; return {}; },
    readSessionRunTruth: async () => { throw gatewayResponseFailure({ code: 'FORBIDDEN', message: 'denied' }); } };
  await expect(refreshSelectedSessionRunTruth(reader, registry, 'live')).rejects.toThrow('denied');
  expect(censusCalled).toBe(false);
});

it('captures retained terminal routes so an older frame revision does not block a new census owner', () => {
  const registry = new SessionRunRegistry(); registry.registerRun('live', 'finished');
  registry.noteLiveFrame('live', 'finished'); registry.observePhase('live', 'completed', 'finished');
  const request = captureSessionCensusRequests(registry).get('live');
  expect(request).toEqual({ runId: '', liveFrameRevision: 1 });
  expect(applySessionRegistryLifecycleSignal(registry, { sessionKey: 'live', runId: 'new', phase: 'running' }, request)).toBe(true);
  expect(registry.runFor('live')).toBe('new');
});
