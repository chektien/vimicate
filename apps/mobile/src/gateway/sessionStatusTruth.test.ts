import { describe, expect, it } from 'vitest';
import { sessionStatusProblem, sessionStatusSupplement } from './sessionStatusTruth';

describe('session status truth', () => {
  it('fails a locally wedged run after an authoritative long silent-running report', () => {
    const payload = { session: { status: 'running', runtimeMs: 450_000 }, tail: 'Tail has not produced useful progress yet beyond the prompt header.' };
    expect(sessionStatusProblem(payload, 'run-1')).toEqual({ phase: 'failed', detail: 'Run run-1 is still running in OpenClaw but silent after 7.5m. Use :stop or :new before sending more.' });
    expect(sessionStatusSupplement(payload)).toEqual(['elapsed 7.5m', 'tail has not produced useful progress beyond the prompt header']);
  });

  it('does not fail a short or useful running session and recognizes explicit timeout', () => {
    expect(sessionStatusProblem({ session: { status: 'running', runtimeMs: 120_000 }, tail: 'no useful progress' }, 'run-1')).toBeNull();
    expect(sessionStatusProblem({ session: { status: 'timed out after 8 minutes' } }, 'run-1')?.detail).toContain('session timeout');
  });
});
