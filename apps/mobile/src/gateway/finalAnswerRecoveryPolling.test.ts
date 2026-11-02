import { describe, expect, it, vi } from 'vitest';
import { pollForFinalAnswer } from './finalAnswerRecoveryPolling';

describe('late canonical final-answer polling', () => {
  it('continues at the slow cadence after the bounded fast path until source authority appears', async () => {
    const wait = vi.fn(async (_delayMs: number) => undefined);
    const exhausted = vi.fn();
    const values = [{ final: false }, { final: false }, { final: true }];

    const result = await pollForFinalAnswer({
      fastDelaysMs: [1, 2], steadyDelayMs: 60,
      wait, shouldContinue: () => true,
      load: async () => values.shift(), isFinal: (value) => value.final,
      onFastPathExhausted: exhausted,
    });

    expect(result).toEqual({ status: 'found', value: { final: true } });
    expect(wait.mock.calls.map(([delay]) => delay)).toEqual([1, 2, 60]);
    expect(exhausted).toHaveBeenCalledTimes(1);
  });

  it('stops before another history request when lifecycle or session ownership is lost', async () => {
    let owned = true;
    const load = vi.fn(async () => ({ final: false }));
    const result = await pollForFinalAnswer({
      fastDelaysMs: [1], steadyDelayMs: 60,
      wait: async () => { owned = false; }, shouldContinue: () => owned,
      load, isFinal: (value) => value.final,
      onFastPathExhausted: vi.fn(),
    });
    expect(result).toEqual({ status: 'cancelled' });
    expect(load).not.toHaveBeenCalled();
  });

  it('does not let one transient history failure permanently retire the owner', async () => {
    const failure = new Error('history unavailable');
    const onFailure = vi.fn();
    let calls = 0;
    const result = await pollForFinalAnswer({
      fastDelaysMs: [1], steadyDelayMs: 60,
      wait: async () => undefined, shouldContinue: () => true,
      load: async () => { calls += 1; if (calls === 1) throw failure; return { final: true }; },
      isFinal: (value) => value.final,
      onFastPathExhausted: vi.fn(), onLoadFailure: onFailure,
    });
    expect(result.status).toBe('found');
    expect(onFailure).toHaveBeenCalledWith(failure);
  });
});

describe('steady final answer polling', () => {
  it('marks only post-fast-path loads as steady so they may reuse unchanged history', async () => {
    const steady: boolean[] = [];
    let calls = 0;
    await pollForFinalAnswer({
      fastDelaysMs: [1, 2], steadyDelayMs: 60, wait: async () => undefined, shouldContinue: () => true,
      load: async (attempt) => { steady.push(attempt.steady); calls += 1; return calls; },
      isFinal: value => value === 4, onFastPathExhausted: () => undefined,
    });
    expect(steady).toEqual([false, false, true, true]);
  });
});
