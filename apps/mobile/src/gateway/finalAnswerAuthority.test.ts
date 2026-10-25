// @ts-expect-error Vitest's Node runtime provides this test-only module.
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import type { WorkspaceMessage } from '../workspace/workspaceTypes';
import { projectGatewayEvent } from './gatewayEventProjection';
import { mergeLatestHistory } from './historyPagination';
import { pollForFinalAnswer } from './finalAnswerRecoveryPolling';
import { hasRenderedAssistantFinalForRun } from './runCompletionMessage';

const sessionKey = 'one';
const runId = 'run-one';
const prompt: WorkspaceMessage = {
  id: 'prompt', role: 'user', text: 'Review this.', source: 'history', sessionKey, runId,
  timestamp: '1700000001000', idempotencyKey: 'request:user',
};
const delta = projectGatewayEvent({ event: 'chat', payload: {
  sessionKey, runId, state: 'delta', message: { content: 'Draft', timestamp: 1700000002000 },
} }, sessionKey)!.message;

describe('final answer authority after run completion', () => {
  it('distinguishes visible streaming content from a completed answer', () => {
    const { runId: _runId, ...unowned } = delta;
    expect(hasRenderedAssistantFinalForRun([delta], runId)).toBe(false);
    expect(hasRenderedAssistantFinalForRun([prompt, unowned], runId)).toBe(false);
    expect(hasRenderedAssistantFinalForRun([prompt, { ...unowned, source: 'history' }], runId)).toBe(false);
  });

  it('keeps confirming through partial live/history snapshots until the canonical final arrives', async () => {
    const partial: WorkspaceMessage = {
      id: 'canonical-answer', role: 'assistant', text: 'Draft', source: 'history', sessionKey,
      timestamp: '1700000003000', idempotencyKey: 'mirror:assistant',
    };
    const final = { ...partial, text: 'Draft complete. Here is the full review.' };
    let rows = [prompt, delta];
    let loads = 0;
    const load = vi.fn(async () => {
      rows = mergeLatestHistory([prompt, ++loads === 1 ? partial : final], rows, sessionKey);
      return rows;
    });
    const result = await pollForFinalAnswer({
      fastDelaysMs: [1, 2], steadyDelayMs: 60, wait: async () => undefined,
      shouldContinue: () => loads < 5, load,
      isFinal: latest => hasRenderedAssistantFinalForRun(latest, runId),
      onFastPathExhausted: vi.fn(),
    });
    expect(result.status).toBe('found');
    expect(loads).toBeGreaterThan(1);
    expect(rows.find(message => message.role === 'assistant')?.text).toBe(final.text);
  });

  it('does not borrow an explicitly different run inside the prompt interval', () => {
    const other = { ...delta, runId: 'other-run', source: 'history' as const, state: 'complete' as const };
    expect(hasRenderedAssistantFinalForRun([prompt, other], runId)).toBe(false);
  });

  it('accepts completed live content and unowned canonical content in the owned turn', () => {
    expect(hasRenderedAssistantFinalForRun([{ ...delta, state: 'complete' }], runId)).toBe(true);
    const { runId: _runId, state: _state, ...unowned } = delta;
    const canonical: WorkspaceMessage = { ...unowned, source: 'history' };
    expect(hasRenderedAssistantFinalForRun([prompt, canonical], runId)).toBe(true);
    expect(hasRenderedAssistantFinalForRun([canonical], runId)).toBe(false);
  });

  it('requires content while accepting a completed image-only reply', () => {
    const empty = { ...delta, text: '', state: 'complete' as const };
    expect(hasRenderedAssistantFinalForRun([empty], runId)).toBe(false);
    const attachments = [{ id: 'image', filename: 'image.png', mimeType: 'image/png', uri: 'https://example.test/image.png' }];
    expect(hasRenderedAssistantFinalForRun([{ ...empty, attachments }], runId)).toBe(true);
    expect(hasRenderedAssistantFinalForRun([{ ...empty, state: 'streaming', attachments }], runId)).toBe(false);
  });

  it('uses the same final authority before an incoming assistant retires pending recovery', () => {
    const source = readFileSync(new URL('./useGatewayWorkspace.ts', import.meta.url), 'utf8');
    expect(source.includes('hasRenderedAssistantFinalForRun([projection.message], projection.message.runId)')).toBe(true);
    expect(source.includes("projection?.message.role === 'assistant' && projection.message.runId && pendingFinalAnswers.current.settle(")).toBe(false);
  });
});
