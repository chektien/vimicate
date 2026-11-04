import { describe, expect, it, vi } from 'vitest';
import type { OpenClawClient } from './OpenClawClient';
import { completedLatestHistoryPage } from './completedLatestHistoryPage';

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
