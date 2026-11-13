import { describe, expect, it } from 'vitest';
import { guardedPromptSubmission } from './guardedSubmission';

describe('fire-and-forget prompt submission boundary', () => {
  it('retains ordinary accepted and rejected outcomes', async () => {
    await expect(guardedPromptSubmission(async () => true)).resolves.toEqual({ kind: 'accepted' });
    await expect(guardedPromptSubmission(async () => false)).resolves.toEqual({ kind: 'rejected' });
  });

  it('converts both synchronous and asynchronous failures into owned UI state', async () => {
    for (const submit of [() => { throw new Error('payload bridge failed'); }, async () => { throw new Error('gateway promise failed'); }]) {
      const outcome = await guardedPromptSubmission(submit);
      expect(outcome).toMatchObject({ kind: 'failed', detail: expect.stringContaining('delivery is not verified') });
      if (outcome.kind === 'failed') {
        expect(outcome.detail).toContain('draft is kept'); expect(outcome.detail).toContain('Refresh');
        expect(outcome.detail).not.toContain('Message not sent');
        expect(outcome.detail).toMatch(/bridge failed|promise failed/);
      }
    }
  });
});
