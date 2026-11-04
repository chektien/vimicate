import { describe, expect, it, vi } from 'vitest';
import type { OpenClawClient } from './OpenClawClient';
import { presentationBoundedLatestHistory } from './presentationBoundedLatestHistory';
import { latestHistoryWindow } from './historyWindow';
import type { WorkspaceMessage } from '../workspace/workspaceTypes';

const sessionKey = 'one';
const lines = (count: number) => Array.from({ length: count }, (_, i) => `Detail line ${i}`).join('\n');
const answer = (id: string, count: number) => ({ id, role: 'assistant', runId: 'run-one', content: lines(count) });
const page = (messages: unknown[], offset: number) => ({ sessionKey, messages, hasMore: true, nextOffset: offset, totalMessages: 500 });
const clientFor = (history: ReturnType<typeof vi.fn>) => ({ history, decorateMessages: (messages: unknown) => messages }) as unknown as OpenClawClient;

describe('latest-page sizing before optional prompt lookback', () => {
  it('does not download prompt context for a raw candidate that already exceeds the window', async () => {
    const oversized = page(Array.from({ length: 8 }, (_, i) => answer(`dense-${i}`, 100)), 80);
    const smaller = page([answer('answer', 100)], 40);
    const prompt = page([{ id: 'prompt', role: 'user', runId: 'run-one', content: 'Review the details.' }], 120);
    const history = vi.fn(async (_key: string, _limit: number, offset: number) => offset === 0 ? smaller : prompt);
    const result = await presentationBoundedLatestHistory(clientFor(history), sessionKey, oversized, '', () => true, []);
    expect(history.mock.calls.map(call => call.slice(1))).toEqual([[40, 0], [80, 40]]);
    expect(result?.cursor.nextOffset).toBe(40);
    expect(result?.messages.map(row => row.id)).toEqual(['prompt', 'answer']);
  });

  it('still rejects a fitting raw page when prompt context would displace consumed raw rows', async () => {
    const first = page([answer('older-answer', 240), answer('newest-answer', 240)], 80);
    const smaller = page([answer('newest-answer', 240)], 40);
    const prompt = page([{ id: 'prompt', role: 'user', runId: 'run-one', content: lines(100) }], 160);
    const history = vi.fn(async (_key: string, _limit: number, offset: number) => offset === 0 ? smaller : prompt);
    const result = await presentationBoundedLatestHistory(clientFor(history), sessionKey, first, '', () => true, []);
    expect(history.mock.calls.map(call => call.slice(1))).toEqual([[80, 80], [40, 0], [80, 40]]);
    expect(result?.cursor.nextOffset).toBe(40);
    expect(latestHistoryWindow(result!.messages, [], sessionKey).map(row => row.id)).toEqual(['prompt', 'newest-answer']);
  });

  it('bounds dense long-run refreshes without caching prompt context across refreshes', async () => {
    const records = Array.from({ length: 300 }, (_, i) => answer(`answer-${i}`, 100));
    const history = vi.fn(async (_key: string, limit: number, offset: number) =>
      page(records.slice(Math.max(0, records.length - offset - limit), records.length - offset), offset + limit));
    const client = clientFor(history);
    const first = page(records.slice(-80), 80);
    for (let refresh = 0; refresh < 2; refresh += 1) {
      history.mockClear();
      const result = await presentationBoundedLatestHistory(client, sessionKey, first, '', () => true, []);
      expect(history.mock.calls.map(call => call.slice(1))).toEqual([
        [40, 0], [20, 0], [10, 0], [5, 0], [2, 0], [80, 2], [80, 82], [1, 0], [80, 1], [80, 81],
      ]);
      expect(result?.cursor.nextOffset).toBe(1);
      expect(latestHistoryWindow(result!.messages, [], sessionKey).at(-1)?.id).toBe('answer-299');
    }
  });

  it.each(['narration', 'media', 'completion'] as const)('includes %s cost before requesting optional context', async kind => {
    const narration: WorkspaceMessage[] = kind === 'narration'
      ? [{ id: 'narration', role: 'narration', text: lines(100), source: 'history', sessionKey }] : [];
    const rows = kind === 'completion' ? [
      { ...answer('orphan', 100), timestamp: 1000 },
      { id: 'other-prompt', role: 'user', runId: 'other', content: 'Another turn', timestamp: 2000 },
      { ...answer('other-answer', 379), runId: 'other', timestamp: 3000 },
    ] : [kind === 'media' ? { ...answer('large', 475), content: `${lines(475)}\n![Picture](https://example.test/image.png)` } : answer('large', 400)];
    const smaller = page([answer('answer', 100)], 40);
    const prompt = page([{ id: 'prompt', role: 'user', runId: 'run-one', content: 'Review.' }], 120);
    const history = vi.fn(async (_key: string, _limit: number, offset: number) => offset === 0 ? smaller : prompt);
    const result = await presentationBoundedLatestHistory(clientFor(history), sessionKey, page(rows, 80), '', () => true, narration);
    expect(history.mock.calls.map(call => call.slice(1))).toEqual([[40, 0], [80, 40]]);
    expect(result?.cursor.nextOffset).toBe(40);
  });

  it('does not count identical narration twice', async () => {
    const narration: WorkspaceMessage = { id: 'shared', role: 'narration', text: lines(300), sessionKey, source: 'history' };
    const first = page([{ id: 'shared', role: 'narration', content: lines(300) }, answer('answer', 100)], 80);
    const history = vi.fn(async () => page([{ id: 'prompt', role: 'user', runId: 'run-one', content: 'Review.' }], 160));
    const result = await presentationBoundedLatestHistory(clientFor(history), sessionKey, first, '', () => true, [narration]);
    expect(history).toHaveBeenCalledExactlyOnceWith(sessionKey, 80, 80);
    expect(result?.messages.filter(row => row.id === 'shared')).toHaveLength(1);
  });

  it('takes pending-input authority only from the admitted replacement, not rejected or context pages', async () => {
    const sessionId = '00000000-0000-4000-8000-000000000117';
    const pending = (id: string) => ({ items: [{ id, runId: `receipt-${id}`, state: 'queued', acceptedAt: 1000,
      message: { role: 'user', content: id } }], total: 1 });
    const first = { ...page(Array.from({ length: 8 }, (_, i) => answer(`large-${i}`, 100)), 80), sessionId, pendingInputs: pending('rejected') };
    const smaller = { ...page([answer('answer', 100)], 40), sessionId, pendingInputs: pending('accepted') };
    const context = { ...page([{ id: 'prompt', role: 'user', runId: 'run-one', content: 'Review.' }], 120), sessionId, pendingInputs: pending('context') };
    const history = vi.fn(async (_key: string, _limit: number, offset: number) => offset === 0 ? smaller : context);
    const result = await presentationBoundedLatestHistory(clientFor(history), sessionKey, first, '', () => true, []);
    expect(result?.pendingInputSnapshot).toEqual({ sessionKey, transcriptSessionId: sessionId, rowIDs: ['pending-input:accepted'] });
  });

  it('retires a narrowed request before starting any prompt-context read', async () => {
    let current = true;
    const history = vi.fn(async () => { current = false; return page([answer('answer', 100)], 40); });
    const first = page(Array.from({ length: 8 }, (_, i) => answer(`large-${i}`, 100)), 80);
    expect(await presentationBoundedLatestHistory(clientFor(history), sessionKey, first, '', () => current, [])).toBeNull();
    expect(history).toHaveBeenCalledExactlyOnceWith(sessionKey, 40, 0);
  });
});
