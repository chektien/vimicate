import { describe, expect, it } from 'vitest';
import { bindRunLifecycleSignal, ownedRunLifecycleSignal, runLifecycleSignalForGatewayFrame } from './runLifecycleProjection';
import { SessionRunRegistry } from './sessionRunRegistry';

describe('gateway run lifecycle projection', () => {
  it('derives phase only from explicitly scoped run events', () => {
    expect(runLifecycleSignalForGatewayFrame({ event: 'chat', payload: { sessionKey: 'one', runId: 'r1', state: 'delta' } })).toEqual({ sessionKey: 'one', runId: 'r1', phase: 'running' });
    expect(runLifecycleSignalForGatewayFrame({ event: 'agent', payload: { sessionKey: 'one', runId: 'r1', stream: 'lifecycle', data: { phase: 'end' } } })).toEqual({ sessionKey: 'one', runId: 'r1', phase: 'completed' });
    expect(runLifecycleSignalForGatewayFrame({ event: 'chat', payload: { runId: 'r1', state: 'delta' } })).toBeNull();
  });

  it('classifies approvals and errors without activity-age inference', () => {
    expect(runLifecycleSignalForGatewayFrame({ event: 'exec.approval.requested', payload: { request: { sessionKey: 'one' }, runId: 'r1' } })?.phase).toBe('waiting');
    expect(runLifecycleSignalForGatewayFrame({ event: 'agent', payload: { sessionKey: 'one', runId: 'r1', stream: 'error', data: {} } })?.phase).toBe('failed');
  });

  it('normalizes lifecycle timing from seconds or milliseconds', () => {
    expect(runLifecycleSignalForGatewayFrame({ event: 'agent', payload: { sessionKey: 'one', runId: 'r1', stream: 'lifecycle', data: { phase: 'end', startedAt: 1_800_000_000, endedAtMs: 1_800_000_004_500 } } })).toEqual({ sessionKey: 'one', runId: 'r1', phase: 'completed', startedAtMs: 1_800_000_000_000, endedAtMs: 1_800_000_004_500 });
  });

  it('keeps messageless finals terminal for their own run without settling an earlier run', () => {
    const registry = new SessionRunRegistry();
    registry.registerRun('one', 'streaming-run');
    const queued = runLifecycleSignalForGatewayFrame({ event: 'chat', payload: {
      sessionKey: 'one', runId: 'queued-receipt', state: 'final',
    } });
    expect(queued).toMatchObject({ runId: 'queued-receipt', phase: 'completed' });
    expect(ownedRunLifecycleSignal(queued, registry)).toBeNull();
    expect(registry.runFor('one')).toBe('streaming-run');
    const ownFinal = runLifecycleSignalForGatewayFrame({ event: 'chat', payload: {
      sessionKey: 'one', runId: 'streaming-run', state: 'final',
    } });
    expect(ownedRunLifecycleSignal(ownFinal, registry)).toBe(ownFinal);
    expect(registry.observePhase('one', ownFinal!.phase, ownFinal!.runId)).toBe(true);
    expect(registry.runFor('one')).toBe('');
  });

  it('keeps malformed assistant projection diagnostics nonterminal for canonical recovery', () => {
    expect(runLifecycleSignalForGatewayFrame({ event: 'chat', payload: { sessionKey: 'one', runId: 'r1', state: 'error', errorMessage: 'error: content=text=search x role=assistant timestamp=1781229207542' } })?.phase).toBe('uncertain');
    expect(runLifecycleSignalForGatewayFrame({ event: 'chat', payload: { sessionKey: 'one', runId: 'r1', state: 'error', errorMessage: 'provider quota exceeded' } })?.phase).toBe('failed');
  });

  it('never assigns an ownerless terminal frame to a newer active run', () => {
    const ownerlessCompletion = runLifecycleSignalForGatewayFrame({ event: 'agent', payload: { sessionKey: 'one', stream: 'lifecycle', data: { phase: 'end' } } });
    const ownerlessProgress = runLifecycleSignalForGatewayFrame({ event: 'agent', payload: { sessionKey: 'one', stream: 'item', data: { kind: 'preamble' } } });

    expect(bindRunLifecycleSignal(ownerlessCompletion, 'newer-run')).toBeNull();
    expect(bindRunLifecycleSignal(ownerlessProgress, 'newer-run')).toEqual({ sessionKey: 'one', runId: 'newer-run', phase: 'running' });
  });
});
