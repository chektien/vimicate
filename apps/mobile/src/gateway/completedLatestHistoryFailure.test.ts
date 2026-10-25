import { describe, expect, it, vi } from 'vitest';
import type { OpenClawClient } from './OpenClawClient';
import { completedLatestHistoryPage } from './completedLatestHistoryPage';
import { latestHistoryRefreshAction } from './historyReviewPublication';

const sessionKey = 'one';
const newest = {
  sessionKey, hasMore: true, nextOffset: 80, totalMessages: 300,
  messages: [{ id: 'answer', role: 'assistant', runId: 'run-one', content: 'The completed review is here.' }],
};
const older = {
  sessionKey, hasMore: true, nextOffset: 160, totalMessages: 300,
  messages: [{ id: 'detail', role: 'tool', content: 'Earlier review detail.' }],
};
const withPrompt = {
  ...older,
  messages: [{ id: 'prompt', role: 'user', runId: 'run-one', content: 'Review the changes.' }],
};
const fakeClient = (history: ReturnType<typeof vi.fn>) => ({
  history, decorateMessages: (messages: unknown) => messages,
}) as unknown as OpenClawClient;

describe('latest history survives optional prompt-context failure', () => {
  it('publishes the valid latest page and exposes retryable context failure', async () => {
    const history = vi.fn().mockRejectedValue(new Error('Network unavailable'));
    const completed = await completedLatestHistoryPage(fakeClient(history), sessionKey, newest, '', () => true);
    expect(completed?.messages.map(message => message.id)).toEqual(['answer']);
    expect(completed?.cursor.nextOffset).toBe(80);
    expect(completed?.lookbackProblem).toBe('earlier prompt context: Network unavailable');
    expect(history).toHaveBeenCalledExactlyOnceWith(sessionKey, 80, 80);
    const published = latestHistoryRefreshAction(completed!.messages, sessionKey, () => [])([]);
    expect(published.some(message => message.id === 'answer')).toBe(true);
  });

  it('keeps an already recovered context page when the second request fails', async () => {
    const history = vi.fn().mockResolvedValueOnce(older).mockRejectedValueOnce(new Error('Timed out'));
    const completed = await completedLatestHistoryPage(fakeClient(history), sessionKey, newest, '', () => true);
    expect(completed?.messages.map(message => message.id)).toEqual(['detail', 'answer']);
    expect(completed?.lookbackProblem).toBe('earlier prompt context: Timed out');
    expect(completed?.cursor.nextOffset).toBe(80);
    expect(history.mock.calls.map(call => call[2])).toEqual([80, 160]);
  });

  it('a successful explicit retry recovers the prompt and clears the failure', async () => {
    const history = vi.fn().mockRejectedValueOnce(new Error('Network unavailable')).mockResolvedValueOnce(withPrompt);
    const client = fakeClient(history);
    const failed = await completedLatestHistoryPage(client, sessionKey, newest, '', () => true);
    const recovered = await completedLatestHistoryPage(client, sessionKey, newest, '', () => true);
    expect(failed?.lookbackProblem).not.toBe('');
    expect(recovered?.lookbackProblem).toBe('');
    expect(recovered?.messages.map(message => message.id)).toEqual(['prompt', 'answer']);
    expect(recovered?.cursor.nextOffset).toBe(80);
  });

  it('does not publish a fallback after authority is retired during the failed request', async () => {
    let current = true;
    const history = vi.fn(async () => { current = false; throw new Error('Disconnected'); });
    expect(await completedLatestHistoryPage(fakeClient(history), sessionKey, newest, '', () => current)).toBeNull();
  });

  it('does not start lookback or return rows when authority is already retired', async () => {
    const history = vi.fn().mockResolvedValue(withPrompt);
    expect(await completedLatestHistoryPage(fakeClient(history), sessionKey, newest, '', () => false)).toBeNull();
    expect(history).not.toHaveBeenCalled();
  });

  it('keeps proactive replies valid without inventing a missing prompt or starting a read', async () => {
    const history = vi.fn();
    const proactive = { ...newest, messages: [{ id: 'proactive', role: 'assistant', content: 'Scheduled summary.' }] };
    const completed = await completedLatestHistoryPage(fakeClient(history), sessionKey, proactive, '', () => true);
    expect(completed?.messages.map(message => message.id)).toEqual(['proactive']);
    expect(completed?.lookbackProblem).toBe('');
    expect(history).not.toHaveBeenCalled();
  });

  it('retains the two-read bound and never consumes the public traversal cursor', async () => {
    const history = vi.fn().mockResolvedValueOnce(older).mockResolvedValueOnce({ ...older, nextOffset: 240 });
    const completed = await completedLatestHistoryPage(fakeClient(history), sessionKey, newest, '', () => true);
    expect(history).toHaveBeenCalledTimes(2);
    expect(completed?.cursor.nextOffset).toBe(80);
    expect(completed?.messages.some(message => message.role === 'user')).toBe(false);
    expect(completed?.lookbackProblem).toBe('');
  });

  it('does not hide a projection error as a recoverable network failure', async () => {
    const history = vi.fn().mockResolvedValue(withPrompt);
    const client = fakeClient(history);
    client.decorateMessages = vi.fn().mockImplementationOnce(messages => messages)
      .mockImplementationOnce(() => { throw new Error('Invalid projection'); });
    await expect(completedLatestHistoryPage(client, sessionKey, newest, '', () => true))
      .rejects.toThrow('Invalid projection');
  });
});
