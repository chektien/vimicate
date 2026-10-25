import { describe, expect, it } from 'vitest';
import { guardedPromptSubmission } from './guardedSubmission';

describe('fire-and-forget prompt submission boundary', () => {
  it('retains ordinary accepted and rejected outcomes', async () => {
    await expect(guardedPromptSubmission(async () => true)).resolves.toEqual({ kind: 'accepted' });
    await expect(guardedPromptSubmission(async () => false)).resolves.toEqual({ kind: 'rejected' });
  });

  it('converts both synchronous and asynchronous failures into owned UI state', async () => {
    await expect(guardedPromptSubmission(() => { throw new Error('payload bridge failed'); })).resolves.toEqual({ kind: 'failed', detail: 'payload bridge failed' });
    await expect(guardedPromptSubmission(async () => { throw new Error('gateway promise failed'); })).resolves.toEqual({ kind: 'failed', detail: 'gateway promise failed' });
  });
});
