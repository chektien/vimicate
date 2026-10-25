import { describe, expect, it } from 'vitest';
import { FINAL_ANSWER_RECOVERY_DELAYS_MS, FINAL_ANSWER_STEADY_RECOVERY_DELAY_MS, PendingFinalAnswerRegistry } from './pendingFinalAnswerRegistry';

describe('durable delayed final-answer ownership', () => {
  it('retains old obligations across launch until evidence settles their exact run', () => {
    const source = new PendingFinalAnswerRegistry();
    source.register('one', 'overnight', 1);
    source.register('one', 'recent');
    const restored = new PendingFinalAnswerRegistry();
    restored.restore(source.serialized());
    expect(restored.entries().map(entry => entry.runId)).toEqual(['overnight', 'recent']);
    restored.settle('one', 'overnight');
    expect(restored.entries().map(entry => entry.runId)).toEqual(['recent']);
  });

  it('keeps independent run identities and never lets a later turn retire an earlier owner', () => {
    const registry = new PendingFinalAnswerRegistry();
    registry.register('one', 'r1', 1); registry.register('one', 'r2', 2);
    expect(registry.settle('one', 'r2')).toBe(true);
    expect(registry.owns('one', 'r1')).toBe(true);
  });

  it('round trips bounded nonsecret recovery metadata and fails closed on malformed values', () => {
    const registry = new PendingFinalAnswerRegistry(); registry.register('one', 'r1', 1); registry.markExhausted('one', 'r1');
    const restored = new PendingFinalAnswerRegistry(); restored.restore(registry.serialized());
    expect(restored.entries()).toEqual([{ sessionKey: 'one', runId: 'r1', registeredAtMs: 1, exhausted: true }]);
    restored.restore('{bad'); expect(restored.entries()).toEqual([]);
  });

  it('uses a bounded recovery schedule with no individual wait above 60 seconds', () => {
    expect(FINAL_ANSWER_RECOVERY_DELAYS_MS.length).toBeLessThanOrEqual(8);
    expect(Math.max(...FINAL_ANSWER_RECOVERY_DELAYS_MS)).toBeLessThan(60_000);
    expect(FINAL_ANSWER_STEADY_RECOVERY_DELAY_MS).toBe(60_000);
  });
});
