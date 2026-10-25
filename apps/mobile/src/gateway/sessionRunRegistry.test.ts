import { describe, expect, it } from 'vitest';
import { allowsSessionSubmission, selectedRunPresentation, sessionSubmissionDisposition, SessionRunRegistry } from './sessionRunRegistry';

describe('per-session run ownership', () => {
  it('does not admit local uncertainty without an existing exact run owner', () => {
    const registry = new SessionRunRegistry();
    expect(registry.markRunUncertain('one', 'old')).toBe(false);
    expect(registry.markRunUncertain('one', '')).toBe(false);
    expect(registry.isBusy('one')).toBe(false);
    expect(registry.phaseFor('one')).toBeUndefined();
  });

  it('allows uncertainty for the current active run, never its retired predecessor or a terminal fact', () => {
    const registry = new SessionRunRegistry(); registry.registerRun('one', 'old');
    expect(registry.markRunUncertain('one', 'old')).toBe(true);
    expect(registry.phaseFor('one')).toBe('uncertain');
    registry.registerRun('one', 'new'); registry.finishRun('one', 'new');
    expect(registry.markRunUncertain('one', 'old')).toBe(false);
    expect(registry.markRunUncertain('one', 'new')).toBe(false);
    expect(registry.phaseFor('one')).toBe('completed');
    expect(registry.isBusy('one')).toBe(false);
    // Actual newer Gateway run facts still enter through the observation API.
    expect(registry.observePhase('one', 'running', 'next')).toBe(true);
    expect(registry.runFor('one')).toBe('next');
  });

  it('does not recreate cleared or evicted runs from local uncertainty', () => {
    const registry = new SessionRunRegistry(1); registry.registerRun('one', 'old'); registry.finishRun('one', 'old');
    registry.registerRun('two', 'other'); registry.finishRun('two', 'other');
    expect(registry.markRunUncertain('one', 'old')).toBe(false);
    registry.clear(); expect(registry.markRunUncertain('two', 'other')).toBe(false);
    expect(registry.entries()).toEqual([]);
  });

  it('retains current terminal authority until a successor submission starts', () => {
    const registry = new SessionRunRegistry(); registry.registerRun('one', 'r1');
    expect(registry.ownsRun('one', 'r1')).toBe(true);
    registry.finishRun('one', 'r1');
    expect(registry.ownsRun('one', 'r1')).toBe(true);
    expect(registry.ownsRun('two', 'r1')).toBe(false);
    expect(registry.ownsRun('one', '')).toBe(false);
    registry.beginSubmission('one');
    expect(registry.ownsRun('one', 'r1')).toBe(false);
    registry.registerRun('one', 'r2');
    expect(registry.ownsRun('one', 'r1')).toBe(false);
    expect(registry.ownsRun('one', 'r2')).toBe(true);
    registry.clear(); expect(registry.ownsRun('one', 'r2')).toBe(false);
  });

  it('keeps active authority for run-safe input and retires evicted terminal identity', () => {
    const registry = new SessionRunRegistry(1); registry.registerRun('one', 'r1');
    registry.beginSubmission('one');
    expect(registry.ownsRun('one', 'r1')).toBe(true);
    registry.finishSubmission('one'); registry.finishRun('one', 'r1');
    registry.registerRun('two', 'r2'); registry.finishRun('two', 'r2');
    expect(registry.ownsRun('one', 'r1')).toBe(false);
    expect(registry.ownsRun('two', 'r2')).toBe(true);
  });

  it('does not let one running project block another project', () => {
    const registry = new SessionRunRegistry(); registry.beginSubmission('one'); registry.registerRun('one', 'run-1');
    expect(allowsSessionSubmission(registry, 'one', false)).toBe(false);
    expect(allowsSessionSubmission(registry, 'two', false)).toBe(true);
    expect(allowsSessionSubmission(registry, 'one', true)).toBe(true);
  });

  it('forwards ordinary active-run input to OpenClaw without admitting colliding commands', () => {
    const registry = new SessionRunRegistry(); registry.registerRun('one', 'run-1');
    expect(sessionSubmissionDisposition(registry, 'one', false, true)).toBe('active-run-input');
    expect(sessionSubmissionDisposition(registry, 'one', false, false)).toBe('blocked');
    expect(sessionSubmissionDisposition(registry, 'one', true, false)).toBe('run-safe');
    expect(sessionSubmissionDisposition(registry, 'two', false, true)).toBe('new-run');
    expect(registry.runFor('one')).toBe('run-1');
  });

  it('does not let an old completion clear a replacement run', () => {
    const registry = new SessionRunRegistry(); registry.registerRun('one', 'old'); registry.registerRun('one', 'new');
    expect(registry.finishRun('one', 'old')).toBe(false);
    expect(registry.runFor('one')).toBe('new');
    expect(registry.finishRun('one', 'new')).toBe(true);
    expect(registry.phaseFor('one')).toBe('completed');
  });

  it('keeps concurrent recovery entries scoped by session', () => {
    const registry = new SessionRunRegistry(); registry.registerRun('one', 'r1'); registry.registerRun('two', 'r2');
    expect(registry.entries()).toEqual([['one', 'r1'], ['two', 'r2']]);
  });

  it('restores bounded active-run ownership after relaunch', () => {
    const registry = new SessionRunRegistry(); registry.restore('{"one":"r1","two":"r2","bad":42}');
    expect(registry.snapshot()).toEqual({ one: 'r1', two: 'r2' });
    expect(registry.phaseFor('one')).toBe('uncertain');
    registry.restore('invalid'); expect(registry.entries()).toEqual([]);
  });

  it('publishes authoritative phases and ignores an old terminal event', () => {
    const registry = new SessionRunRegistry();
    registry.beginSubmission('one'); expect(registry.phaseFor('one')).toBe('submitting');
    registry.registerRun('one', 'new'); expect(registry.phaseFor('one')).toBe('accepted');
    registry.observePhase('one', 'running', 'new'); expect(registry.phaseFor('one')).toBe('running');
    expect(registry.observePhase('one', 'failed', 'old')).toBe(false);
    expect(registry.runFor('one')).toBe('new');
    registry.observePhase('one', 'completed', 'new'); expect(registry.phaseFor('one')).toBe('completed');
  });

  it('does not call a rejected pre-run submission a crashed thread', () => {
    const registry = new SessionRunRegistry(); registry.beginSubmission('one'); registry.rejectSubmission('one');
    expect(registry.phaseFor('one')).toBeUndefined();
    expect(registry.timingFor('one')).toBeUndefined();
    expect(registry.isBusy('one')).toBe(false);
  });

  it('retires a successful local command submission that never creates a run', () => {
    const registry = new SessionRunRegistry(); registry.beginSubmission('one', 1_000); registry.finishSubmission('one');
    expect(registry.phaseFor('one')).toBeUndefined();
    expect(registry.timingFor('one')).toBeUndefined();
    expect(registry.isBusy('one')).toBe(false);
  });

  it('lets later session-scoped live progress clear an older false failure', () => {
    const registry = new SessionRunRegistry(); registry.registerRun('one', 'old'); registry.finishRun('one', 'old', 'failed');
    expect(registry.observePhase('one', 'running')).toBe(true);
    expect(registry.phaseFor('one')).toBe('running');
  });

  it('does not republish project lifecycle state for every cumulative stream frame', () => {
    const registry = new SessionRunRegistry();
    registry.registerRun('one', 'r1');
    expect(registry.observePhase('one', 'running', 'r1')).toBe(true);
    expect(Array.from({ length: 250 }, () => registry.observePhase('one', 'running', 'r1')).filter(Boolean)).toHaveLength(0);
    expect(registry.observePhase('one', 'running', 'r1', { startedAtMs: 1_800_000_000_000 })).toBe(true);
    expect(registry.observePhase('one', 'running', 'r1', { startedAtMs: 1_800_000_000_000 })).toBe(false);
  });

  it('does not regress a terminal event that arrived before send acceptance', () => {
    const registry = new SessionRunRegistry(); registry.beginSubmission('one');
    registry.observePhase('one', 'running', 'r1'); registry.observePhase('one', 'completed', 'r1');
    registry.registerRun('one', 'r1');
    expect(registry.phaseFor('one')).toBe('completed');
    expect(registry.runFor('one')).toBe('');
  });

  it('ignores delayed nonterminal events from a replaced run', () => {
    const registry = new SessionRunRegistry(); registry.registerRun('one', 'old'); registry.registerRun('one', 'new');
    expect(registry.observePhase('one', 'running', 'old')).toBe(false);
    expect(registry.runFor('one')).toBe('new');
  });

  it('does not let an ownerless terminal observation clear the current run', () => {
    const registry = new SessionRunRegistry(); registry.registerRun('one', 'newer-run');
    expect(registry.observePhase('one', 'completed')).toBe(false);
    expect(registry.observePhase('one', 'failed')).toBe(false);
    expect(registry.runFor('one')).toBe('newer-run');
    expect(registry.phaseFor('one')).toBe('accepted');
  });

  it('isolates the selected prompt action from runs in other sessions', () => {
    const registry = new SessionRunRegistry(); registry.registerRun('thread-a', 'run-a');
    expect(selectedRunPresentation(registry, 'thread-a')).toEqual({ runId: 'run-a', sending: true });
    expect(selectedRunPresentation(registry, 'thread-b')).toEqual({ runId: '', sending: false });
    registry.beginSubmission('thread-c');
    expect(selectedRunPresentation(registry, 'thread-c')).toEqual({ runId: '', sending: true });
    expect(selectedRunPresentation(registry, 'thread-b')).toEqual({ runId: '', sending: false });
  });

  it('keeps completion monotonic against a delayed error and upgrades an earlier failure with final success', () => {
    const completed = new SessionRunRegistry(); completed.beginSubmission('one', 1_000); completed.registerRun('one', 'r1');
    expect(completed.observePhase('one', 'completed', 'r1', { endedAtMs: 3_500 })).toBe(true);
    expect(completed.observePhase('one', 'failed', 'r1', { endedAtMs: 4_000 })).toBe(false);
    expect(completed.phaseFor('one')).toBe('completed');
    expect(completed.elapsedMsFor('one', 'r1')).toBe(2_500);

    const recovered = new SessionRunRegistry(); recovered.registerRun('one', 'r2', { startedAtMs: 2_000 });
    recovered.observePhase('one', 'failed', 'r2', { endedAtMs: 2_500 });
    expect(recovered.observePhase('one', 'completed', 'r2', { endedAtMs: 3_000 })).toBe(true);
    expect(recovered.phaseFor('one')).toBe('completed');
  });

  it('allows only the explicit incomplete-run owner to replace a no-answer completion', () => {
    const registry = new SessionRunRegistry(); registry.registerRun('one', 'r1', { startedAtMs: 1_000 });
    registry.observePhase('one', 'completed', 'r1', { endedAtMs: 4_000 });
    expect(registry.observePhase('one', 'failed', 'r1')).toBe(false);
    expect(registry.markIncompleteRun('one', 'r1', { endedAtMs: 4_000 })).toBe(true);
    expect(registry.phaseFor('one')).toBe('failed');
    expect(registry.runFor('one')).toBe('');
  });

  it('bounds terminal-only run metadata across the process session lifetime', () => {
    const registry = new SessionRunRegistry();
    for (let index = 0; index < 1_000; index += 1) {
      const sessionKey = `session-${index}`;
      const runId = `run-${index}`;
      registry.registerRun(sessionKey, runId, { startedAtMs: index + 1 });
      registry.finishRun(sessionKey, runId, 'completed', { endedAtMs: index + 2 });
    }

    expect(registry.phaseFor('session-935')).toBeUndefined();
    expect(registry.timingFor('session-935')).toBeUndefined();
    expect(registry.phaseFor('session-936')).toBe('completed');
    expect(registry.timingFor('session-999')).toMatchObject({ runId: 'run-999' });
  });

  it('never evicts active run ownership while terminal metadata ages out', () => {
    const registry = new SessionRunRegistry(2);
    registry.registerRun('active', 'active-run');
    for (const sessionKey of ['done-1', 'done-2', 'done-3']) {
      registry.registerRun(sessionKey, `${sessionKey}-run`);
      registry.finishRun(sessionKey, `${sessionKey}-run`);
    }

    expect(registry.runFor('active')).toBe('active-run');
    expect(registry.phaseFor('active')).toBe('accepted');
    expect(registry.phaseFor('done-1')).toBeUndefined();
    expect(registry.phaseFor('done-2')).toBe('completed');
    expect(registry.phaseFor('done-3')).toBe('completed');
  });
});
