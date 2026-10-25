import { describe, expect, it, vi } from 'vitest';
import type { OpenClawClient } from './OpenClawClient';
import { completedNativeHistoryContinuity, retainedNativeHistoryWindow } from './latestHistoryContinuity';
import { type WorkspaceMessage } from '../workspace/workspaceTypes';
import { messagesFromPayload } from '../workspace/historyMessageProjection';

const sessionKey = 'continuity';
const generation = '00000000-0000-4000-8000-000000000117';
const page = (seqs: number[], nextOffset: number | null) => ({
  sessionKey, sessionId: generation, hasMore: nextOffset !== null, nextOffset, totalMessages: 900,
  messages: seqs.map(seq => ({
    role: 'assistant', content: `Answer ${seq}`, timestamp: 1_789_000_000_000 + seq,
    __openclaw: { id: `native-${seq}`, transcriptPosition: { source: 'sqlite', rawSeq: seq } },
  })),
});
function setup() {
  const history = vi.fn();
  const client = { history, decorateMessages: (messages: WorkspaceMessage[]) => messages } as unknown as OpenClawClient;
  const completed = {
    cursor: { sessionKey, nextOffset: 80, hasMore: true, totalMessages: 900 },
    messages: messagesFromPayload(page([804, 819, 826], 80)), lookbackProblem: '',
  };
  const retained = messagesFromPayload(page([747], null));
  const run = (owns = () => true) => completedNativeHistoryContinuity(client, sessionKey, completed, retained, '', owns);
  return { history, completed, retained, run };
}

describe('native history continuity controls', () => {
  it('bridges multiple pages without consuming the public older-history cursor', async () => {
    const { history, completed, run } = setup();
    history.mockResolvedValueOnce(page([790, 792], 160)).mockResolvedValueOnce(page([747, 748, 786, 788], 240));
    const result = await run();
    expect(result?.messages.map(message => message.displayPosition?.rawSeq)).toEqual([747, 748, 786, 788, 790, 792, 804, 819, 826]);
    expect(result?.cursor).toBe(completed.cursor);
    expect(history.mock.calls).toEqual([[sessionKey, 80, 80], [sessionKey, 80, 160]]);
  });

  it.each(['overlap', 'generation', 'source'] as const)('does not invent a gap across %s', async kind => {
    const { history, retained, completed, run } = setup();
    if (kind === 'overlap') retained[0]!.displayPosition!.rawSeq = 804;
    if (kind === 'generation') retained[0]!.transcriptSessionId = 'another-generation';
    if (kind === 'source') retained[0]!.displayPosition!.source = 'another-source';
    expect(await run()).toBe(completed);
    expect(history).not.toHaveBeenCalled();
  });

  it('discards an in-flight bridge after publication authority retires', async () => {
    const { history, run } = setup();
    let release!: (payload: unknown) => void;
    history.mockReturnValueOnce(new Promise(resolve => { release = resolve; }));
    let owned = true;
    const request = run(() => owned);
    owned = false;
    release(page([747, 748], 160));
    expect(await request).toBeNull();
    expect(history).toHaveBeenCalledOnce();
  });

  it('propagates bridge failure without returning a partial joined transcript', async () => {
    const { history, completed, run } = setup();
    history.mockResolvedValueOnce(page([790, 792], 160)).mockRejectedValueOnce(new Error('offline'));
    await expect(run()).rejects.toThrow('offline');
    expect(completed.messages.map(message => message.displayPosition?.rawSeq)).toEqual([804, 819, 826]);
  });

  it('rejects non-advancing pagination instead of repeatedly fetching it', async () => {
    const { history, run } = setup();
    history.mockResolvedValue(page([790, 792], 80));
    await expect(run()).rejects.toThrow('did not advance');
    expect(history).toHaveBeenCalledOnce();
  });

  it('bounds bridge reads when the retained edge is beyond the lookback budget', async () => {
    const { history, run } = setup();
    history.mockImplementation(async (_key, _limit, offset) => page([790, 792], offset + 80));
    const result = await run();
    expect(result?.messages.map(message => message.displayPosition?.rawSeq)).toEqual([804, 819, 826]);
    expect(result?.nativeHistoryFloor).toEqual({ source: 'sqlite', transcriptSessionId: generation, rawSeq: 804 });
    expect(result?.cursor.nextOffset).toBe(80);
    expect(history).toHaveBeenCalledTimes(6);
  });

  it('retires a bounded recovery when authority changes on its last bridge read', async () => {
    const { history, run } = setup();
    let owned = true;
    history.mockImplementation(async (_key, _limit, offset) => {
      if (offset === 480) owned = false;
      return page([790, 792], offset + 80);
    });
    expect(await run(() => owned)).toBeNull();
    expect(history).toHaveBeenCalledTimes(6);
  });

  it('limits native-window replacement to the exact source, session and generation', () => {
    const old = messagesFromPayload(page([747], null))[0]!;
    const otherSession = { ...old, sessionKey: 'other' };
    const otherGeneration = { ...old, transcriptSessionId: 'other' };
    const otherSource = { ...old, displayPosition: { ...old.displayPosition!, source: 'other' } };
    const newer = { ...old, displayPosition: { ...old.displayPosition!, rawSeq: 900 } };
    const retained = [old, otherSession, otherGeneration, otherSource, newer];
    expect(retainedNativeHistoryWindow(retained, sessionKey)).toBe(retained);
    expect(retainedNativeHistoryWindow(retained, sessionKey, { source: 'sqlite', transcriptSessionId: generation, rawSeq: 804 }))
      .toEqual([otherSession, otherGeneration, otherSource, newer]);
  });
});
