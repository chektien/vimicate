import { describe, expect, it, vi } from 'vitest';
import { waitForAuthoritativeRun } from './runWaitPolling';

describe('authoritative run-wait polling', () => {
  it('continues after an authoritative still-running timeout result', async () => {
    const wait = vi.fn()
      .mockResolvedValueOnce({ status: 'timeout', timeoutPhase: 'queue' })
      .mockResolvedValueOnce({ status: 'done' });
    const onWaiting = vi.fn();

    await expect(waitForAuthoritativeRun({ wait, isConnected: () => true, ownsRun: () => true, onWaiting }))
      .resolves.toEqual({ status: 'done' });
    expect(wait).toHaveBeenCalledTimes(2);
    expect(onWaiting).toHaveBeenCalledWith({ status: 'timeout', timeoutPhase: 'queue' });
  });

  it('continues when the local agent.wait request expires but the same connected run still owns monitoring', async () => {
    const wait = vi.fn()
      .mockRejectedValueOnce(new Error('agent.wait timed out'))
      .mockResolvedValueOnce({ status: 'completed', runId: 'run-1' });
    const onWaiting = vi.fn();

    await expect(waitForAuthoritativeRun({ wait, isConnected: () => true, ownsRun: () => true, onWaiting }))
      .resolves.toEqual({ status: 'completed', runId: 'run-1' });
    expect(wait).toHaveBeenCalledTimes(2);
    expect(onWaiting).toHaveBeenCalledOnce();
    expect(onWaiting).toHaveBeenCalledWith();
  });

  it('does not swallow a definitive request failure', async () => {
    const failure = new Error('provider rejected wait request');
    await expect(waitForAuthoritativeRun({
      wait: async () => { throw failure; },
      isConnected: () => true,
      ownsRun: () => true,
      onWaiting: vi.fn(),
    })).rejects.toBe(failure);
  });

  it('does not start another request after disconnect or run replacement', async () => {
    const wait = vi.fn().mockRejectedValue(new Error('agent.wait timed out'));
    await expect(waitForAuthoritativeRun({ wait, isConnected: () => false, ownsRun: () => true, onWaiting: vi.fn() }))
      .rejects.toThrow('agent.wait timed out');
    await expect(waitForAuthoritativeRun({ wait, isConnected: () => true, ownsRun: () => false, onWaiting: vi.fn() }))
      .rejects.toThrow('agent.wait timed out');
    expect(wait).toHaveBeenCalledTimes(2);
  });
});
