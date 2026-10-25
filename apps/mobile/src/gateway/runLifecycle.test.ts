import { describe, expect, it } from 'vitest';
import { isRecoverableRunInterruption, isRunWaitRequestTimeout, isRunWaitTimeout, runPhaseForWaitResult, runTerminalDetail } from './runLifecycle';

describe('run lifecycle', () => {
  it('keeps waiting only for gateway wait timeouts', () => {
    expect(isRunWaitTimeout({ status: 'timeout', timeoutPhase: 'queue' })).toBe(true);
    expect(isRunWaitTimeout({ status: 'done' })).toBe(false);
    expect(isRunWaitTimeout({ status: 'error' })).toBe(false);
  });

  it('distinguishes the local wait-request deadline from unrelated failures', () => {
    expect(isRunWaitRequestTimeout(new Error('agent.wait timed out'))).toBe(true);
    expect(isRunWaitRequestTimeout(new Error('chat.history timed out'))).toBe(false);
    expect(isRunWaitRequestTimeout(new Error('provider wait failed'))).toBe(false);
  });

  it('surfaces terminal error and stop detail', () => {
    expect(runTerminalDetail({ status: 'error', error: 'provider unavailable' })).toBe('error: provider unavailable');
    expect(runTerminalDetail({ status: 'killed', stopReason: 'aborted' })).toBe('killed: aborted');
    expect(runTerminalDetail({ status: 'done' })).toBe('done');
  });

  it('classifies authoritative wait results for shared status presentation', () => {
    expect(runPhaseForWaitResult({ status: 'done' })).toBe('completed');
    expect(runPhaseForWaitResult({ status: 'timeout' })).toBe('waiting');
    expect(runPhaseForWaitResult({ status: 'error', error: 'quota' })).toBe('failed');
    expect(runPhaseForWaitResult({ status: 'mystery' })).toBe('uncertain');
  });

  it('preserves accepted runs across transport interruption only', () => {
    expect(isRecoverableRunInterruption(new Error('Gateway disconnected'))).toBe(true);
    expect(isRecoverableRunInterruption(new Error('WebSocket transport error'))).toBe(true);
    expect(isRecoverableRunInterruption(new Error('provider rejected request'))).toBe(false);
  });
});
