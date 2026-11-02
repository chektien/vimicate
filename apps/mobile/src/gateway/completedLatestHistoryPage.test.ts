import { describe, expect, it, vi } from 'vitest';
import type { OpenClawClient } from './OpenClawClient';
import { completedLatestHistoryPage } from './completedLatestHistoryPage';
import { RunPromptLookback } from './runPromptLookback';

describe('latest-history completion lookback', () => {
  it('does not consume the public older-history cursor when it looks back for a run prompt', async () => {
    const olderPayload = {
      hasMore: true,
      nextOffset: 160,
      totalMessages: 861,
      messages: [
        {
          id: 'image-answer',
          role: 'assistant',
          timestamp: 1787820874884,
          content: 'Here is the recovered signature page:\n\n![Example signed page](</var/folders/device/Word Screenshot.jpeg>)',
        },
        { id: 'owned-prompt', role: 'user', runId: 'run-1', content: 'recover the signature page' },
      ],
    };
    const client = {
      history: vi.fn(async (_sessionKey: string, _limit: number, offset: number) => {
        expect(offset).toBe(80);
        return olderPayload;
      }),
      decorateMessages: vi.fn((messages) => messages),
    } as unknown as OpenClawClient;
    const newestPayload = {
      hasMore: true,
      nextOffset: 80,
      totalMessages: 861,
      messages: [{ id: 'owned-answer', role: 'assistant', runId: 'run-1', content: 'done' }],
    };

    const completed = await completedLatestHistoryPage(client, 'agent:main:r3cap', newestPayload, '~/repos/r3cap', () => true);

    expect(client.history).toHaveBeenCalledTimes(1);
    expect(completed?.messages.map((message) => message.id)).toContain('image-answer');
    expect(completed?.messages.find((message) => message.id === 'image-answer')?.attachments).toEqual([
      expect.objectContaining({ filename: 'Example signed page' }),
    ]);
    // The lookback merged useful run context into the latest publication, but
    // upward paging must still begin at the first unseen Gateway page.
    expect(completed?.cursor.nextOffset).toBe(80);
  });
});

describe('run prompt lookback reuse', () => {
  const older = { hasMore: false, nextOffset: null, messages: [
    { id: 'prompt', role: 'user', runId: 'run-1', content: 'long task' },
    { id: 'tool-1', role: 'assistant', runId: 'run-1', content: 'step one' },
  ] };
  const latest = (ids: string[]) => ({ hasMore: true, nextOffset: 80, messages: ids.map(id => ({ id, role: 'assistant', runId: 'run-1', content: id })) });
  const client = () => ({ history: vi.fn(async () => older), decorateMessages: vi.fn((messages) => messages) }) as unknown as OpenClawClient & { history: ReturnType<typeof vi.fn> };

  it('fetches the lookback once, then reuses retained rows while they still join the fresh page', async () => {
    const lookback = new RunPromptLookback(); const transport = client();
    const first = await completedLatestHistoryPage(transport, 's', latest(['tool-2', 'tool-3']), '', () => true, lookback);
    expect(transport.history).toHaveBeenCalledTimes(1);
    expect(first?.messages.map(row => row.id)).toEqual(['prompt', 'tool-1', 'tool-2', 'tool-3']);
    // The page window moved forward: tool-2 fell out but is retained.
    const second = await completedLatestHistoryPage(transport, 's', latest(['tool-3', 'tool-4']), '', () => true, lookback);
    expect(transport.history).toHaveBeenCalledTimes(1);
    expect(second?.messages.map(row => row.id)).toEqual(['prompt', 'tool-1', 'tool-2', 'tool-3', 'tool-4']);
    expect(second?.cursor.nextOffset).toBe(80);
  });

  it('fetches again when the retained rows no longer reach the fresh page or the run changed', async () => {
    const lookback = new RunPromptLookback(); const transport = client();
    await completedLatestHistoryPage(transport, 's', latest(['tool-2']), '', () => true, lookback);
    await completedLatestHistoryPage(transport, 's', latest(['tool-9']), '', () => true, lookback);
    expect(transport.history).toHaveBeenCalledTimes(2);
    expect(new RunPromptLookback().olderRows('s', 'run-1', [])).toBeNull();
  });
});
