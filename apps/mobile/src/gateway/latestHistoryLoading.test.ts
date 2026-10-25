import { describe, expect, it, vi } from 'vitest';
import { type WorkspaceMessage } from '../workspace/workspaceTypes';
import { messagesFromPayload } from '../workspace/historyMessageProjection';
import type { OpenClawClient } from './OpenClawClient';
import { createLatestHistoryActions, type LatestHistoryActionsContext } from './latestHistoryLoading';
import { HistoryPublicationAuthority } from './historyPublicationAuthority';
import { HistoryArchiveRecovery } from './historyArchiveRecovery';
import { HistoryRefreshDeferral } from './historyRefreshDeferral';
import { OlderHistoryRequestAuthority } from './historyRequestAuthority';
import { SessionHistoryCache } from './sessionHistoryCache';
import { authorizedHistoryStatePublication, olderPageHistoryPublication } from './historyReviewPublication';

const sessionKey = 'one';
const latest = {
  sessionKey, hasMore: true, nextOffset: 80, totalMessages: 160,
  messages: [{ id: 'answer', role: 'assistant', runId: 'run-one', content: 'The completed review is here.' }],
};
const older = {
  sessionKey, hasMore: false, nextOffset: null, totalMessages: 160,
  messages: [{ id: 'prompt', role: 'user', runId: 'run-one', content: 'Review the changes.' }],
};
const review: WorkspaceMessage[] = [{ id: 'review', role: 'assistant', text: 'Previously loaded history.', sessionKey, source: 'history' }];

function setup(mode: 'latest' | 'older' = 'latest') {
  const state = { messages: mode === 'older' ? review : [] as WorkspaceMessage[], problem: '', canLoadOlder: false };
  const history = vi.fn().mockResolvedValueOnce(latest).mockRejectedValueOnce(new Error('Network unavailable'));
  const context: LatestHistoryActionsContext = {
    client: { status: 'connected', history, followSession: vi.fn().mockResolvedValue(undefined),
      decorateMessages: (messages: WorkspaceMessage[]) => messages } as unknown as OpenClawClient,
    selectedRef: { current: sessionKey },
    publicationAuthority: { current: new HistoryPublicationAuthority() },
    latestRequestRevision: { current: 0 }, historySelectionRevision: { current: 0 },
    windowMode: { current: mode }, reviewEntryIntent: { current: mode === 'older' ? 'deliberate' : null }, historyFailure: { current: null },
    cursor: { current: null }, archive: { current: null }, workspacePath: { current: '' },
    olderRequest: { current: new OlderHistoryRequestAuthority() },
    deferredLatestRefresh: { current: new HistoryRefreshDeferral() },
    archiveRecovery: { current: new HistoryArchiveRecovery() },
    latestTailCache: { current: new SessionHistoryCache() }, historyCache: { current: new SessionHistoryCache() },
    hydrateSharedNarration: vi.fn().mockResolvedValue([]),
    setHistoryMessages: vi.fn((key, action, side, ownsPublication) => {
      const publication = authorizedHistoryStatePublication(key, context.selectedRef.current, sessionKey, ownsPublication, state.messages, action);
      if (!publication.owned) return;
      state.messages = publication.messages;
      context.historyCache.current.store(key, state.messages);
      if (side === 'latest') context.latestTailCache.current.store(key, state.messages);
    }),
    setHistoryProblem: vi.fn(problem => { state.problem = problem; }),
    setCanLoadOlder: vi.fn(value => { state.canLoadOlder = value; }), setLoadingOlder: vi.fn(), onDetail: vi.fn(),
    persistLater: vi.fn(), persistHistoryReview: vi.fn(), clearPersistedHistoryReview: vi.fn(),
  };
  context.historyCache.current.store(sessionKey, state.messages);
  context.latestTailCache.current.store(sessionKey, []);
  return { context, state, history, actions: createLatestHistoryActions(context) };
}

describe('latest history loading publication', () => {
  it('keeps both history and narration snapshots behind live subscription admission', async () => {
    const { context, history, actions } = setup();
    let subscribed!: () => void;
    vi.mocked(context.client.followSession).mockReturnValue(new Promise(resolve => { subscribed = resolve; }));
    const request = actions.loadHistory(sessionKey, 'reveal-current');
    const narrationStarted = vi.mocked(context.hydrateSharedNarration).mock.calls.length;
    const historyStarted = history.mock.calls.length;
    subscribed();
    await request;
    // A pre-subscription snapshot could miss commentary written during entry.
    expect(narrationStarted).toBe(0);
    expect(historyStarted).toBe(0);
    expect(context.hydrateSharedNarration).toHaveBeenCalledOnce();
  });

  it.each(['selection', 'scene', 'revision'] as const)('does not start a history read after subscription loses %s authority', async retired => {
    const { context, history, actions } = setup();
    let subscribed!: () => void;
    vi.mocked(context.client.followSession).mockReturnValue(new Promise(resolve => { subscribed = resolve; }));
    const request = actions.loadHistory(sessionKey, 'reveal-current');
    if (retired === 'selection') context.selectedRef.current = 'two';
    if (retired === 'scene') context.publicationAuthority.current!.suspend();
    if (retired === 'revision') context.latestRequestRevision.current += 1;
    subscribed();
    await request;
    expect(history).not.toHaveBeenCalled();
    expect(context.setHistoryMessages).not.toHaveBeenCalled();
  });

  it('reveals a fresh thread tail without fetching the intervening unseen pages', async () => {
    const { context, state, history, actions } = setup();
    const generation = '00000000-0000-4000-8000-000000000117';
    const page = (seqs: number[], offset: number) => ({
      sessionKey, sessionId: generation, hasMore: true, nextOffset: offset, totalMessages: 1000,
      messages: seqs.map(seq => ({ role: 'user', content: `row ${seq}`,
        __openclaw: { id: `row-${seq}`, transcriptPosition: { source: 'sqlite', rawSeq: seq } } })),
    });
    const cached = messagesFromPayload(page([1, 2], 80));
    const local: WorkspaceMessage = { id: 'local', sessionKey, role: 'user', source: 'local', text: 'pending prompt' };
    state.messages = [...cached, local];
    context.historyCache.current.store(sessionKey, state.messages);
    context.latestTailCache.current.store(sessionKey, state.messages);
    history.mockReset().mockImplementation(async (_key, _limit, offset) => page(offset === 0 ? [900, 901] : [800 - offset], offset + 80));
    await actions.loadHistory(sessionKey, 'reveal-current');
    expect(history).toHaveBeenCalledExactlyOnceWith(sessionKey, 80, 0);
    expect(state.messages.filter(row => row.displayPosition).map(row => row.displayPosition?.rawSeq)).toEqual([900, 901]);
    expect(state.messages).toContainEqual(local);
    expect(context.cursor.current?.nextOffset).toBe(80);
    expect(state.canLoadOlder).toBe(true);
  });

  it.each(['scene', 'selection', 'request'] as const)('starts fresh history instead of joining an obsolete %s request', async (retired) => {
    const { context, state, history, actions } = setup();
    let release!: (page: unknown) => void;
    history.mockReset().mockReturnValueOnce(new Promise(resolve => { release = resolve; }))
      .mockResolvedValue({ ...latest, hasMore: false, nextOffset: null });
    const obsolete = actions.loadHistory(sessionKey);
    await Promise.resolve();
    if (retired === 'scene') { context.publicationAuthority.current!.suspend(); context.publicationAuthority.current!.resume(); }
    if (retired === 'selection') context.historySelectionRevision.current += 1;
    if (retired === 'request') context.latestRequestRevision.current += 1;
    const resumed = actions.loadHistory(sessionKey);
    await Promise.resolve();
    const requestsBeforeOldResponse = history.mock.calls.length;
    release({ sessionKey, messages: [], hasMore: false });
    await Promise.all([obsolete, resumed]);
    expect(requestsBeforeOldResponse).toBe(2);
    expect(state.messages.map(message => message.id)).toEqual(['answer']);
  });

  it('coalesces concurrent latest refreshes for one session into a single request set', async () => {
    const { context, history, actions } = setup();
    let releaseLatest!: (page: unknown) => void;
    const pendingLatest = new Promise(resolve => { releaseLatest = resolve; });
    history.mockReset();
    history.mockReturnValueOnce(pendingLatest).mockResolvedValue(older);
    // Independent recovery/monitor owners refresh the same selected session.
    const concurrent = Array.from({ length: 5 }, () => actions.loadHistory(sessionKey));
    releaseLatest(latest);
    const results = await Promise.all(concurrent);

    expect(context.hydrateSharedNarration).toHaveBeenCalledOnce();
    expect(history).toHaveBeenCalledTimes(2);
    expect(results.every(result => result === results[0])).toBe(true);
    expect(results[0]?.map(message => message.id)).toEqual(['prompt', 'answer']);

    // The coalescing window closes with the request; a later refresh reloads.
    await actions.loadHistory(sessionKey);
    expect(context.hydrateSharedNarration).toHaveBeenCalledTimes(2);
  });

  it('lets census and run-status refreshes join the thread-entry request instead of superseding its first paint', async () => {
    const { context, state, history, actions } = setup('older');
    let release!: (page: unknown) => void;
    history.mockReset().mockReturnValue(new Promise(resolve => { release = resolve; }));
    const entry = actions.loadHistory(sessionKey, 'reveal-current');
    await vi.waitFor(() => expect(history).toHaveBeenCalledOnce());
    const refresh = actions.loadHistory(sessionKey);
    await Promise.resolve();
    const requestCount = history.mock.calls.length;
    release({ sessionKey, messages: [{ id: 'fresh', role: 'user', content: 'new update' }], hasMore: false });
    await Promise.all([entry, refresh]);
    expect(requestCount).toBe(1);
    expect(context.hydrateSharedNarration).toHaveBeenCalledOnce();
    expect(context.windowMode.current).toBe('latest');
    expect(state.messages.map(row => row.id)).toEqual(['fresh']);
  });

  it('retires only custody rows captured before the request and preserves one first published while awaiting it', async () => {
    const { context, state, history, actions } = setup();
    const sessionId = '00000000-0000-4000-8000-000000000117';
    const pending = (id: string, acceptedAt: number) => ({
      id, runId: `receipt-${id}`, state: 'queued', acceptedAt,
      message: { role: 'user', content: id, __openclaw: { id: `pending:${id}` } },
    });
    const old = messagesFromPayload({
      sessionKey, sessionId, messages: [], pendingInputs: { items: [pending('old', 1000)], total: 1 },
    });
    state.messages = old;
    context.historyCache.current.store(sessionKey, old);
    context.latestTailCache.current.store(sessionKey, old);

    let release!: (page: unknown) => void;
    history.mockReset().mockReturnValueOnce(new Promise(resolve => { release = resolve; }));
    const request = actions.loadHistory(sessionKey);
    await vi.waitFor(() => expect(history).toHaveBeenCalledOnce());

    // This row was not a retirement candidate because it first appeared after
    // the request began. A response snapshot taken immediately before that
    // acceptance cannot erase it when its updater eventually applies.
    const newer = messagesFromPayload({
      sessionKey, sessionId, messages: [], pendingInputs: { items: [pending('new', 2000)], total: 1 },
    })[0]!;
    context.latestTailCache.current.store(sessionKey, [...old, newer]);
    state.messages = [...old, newer];
    release({
      sessionKey, sessionId, hasMore: false, nextOffset: null, totalMessages: 1,
      messages: [{ role: 'user', content: 'old', timestamp: 1000, idempotencyKey: 'old-submission:user',
        __openclaw: { id: 'canonical-old', importedFrom: 'claude-cli', cliSessionId: sessionId,
          externalId: 'claude-old', transcriptPosition: { source: 'sqlite', rawSeq: 10 } } }],
      pendingInputs: { items: [], total: 0 },
    });
    await request;

    expect(state.messages.filter(message => message.role === 'user').map(message => message.id))
      .toEqual(['canonical-old', 'pending-input:new']);
  });

  it.each(['loadHistory', 'restoreLatestHistory'] as const)('%s bridges a disjoint newest page before publishing over a cached native tail', async (action) => {
    const { context, state, history, actions } = setup();
    const generation = '00000000-0000-4000-8000-000000000117';
    const wire = (seq: number, role: 'user' | 'assistant') => ({
      role,
      content: `${role} ${seq}`,
      timestamp: 1_789_000_000_000 + seq,
      __openclaw: {
        id: `native-${seq}`,
        transcriptPosition: { source: 'sqlite-generation', rawSeq: seq },
      },
    });
    const cached = messagesFromPayload({
      sessionKey,
      sessionId: generation,
      messages: [wire(1, 'assistant')],
    });
    state.messages = cached;
    context.historyCache.current.store(sessionKey, cached);
    context.latestTailCache.current.store(sessionKey, cached);
    history.mockReset()
      .mockResolvedValueOnce({
        sessionKey,
        sessionId: generation,
        hasMore: true,
        nextOffset: 2,
        totalMessages: 5,
        messages: [wire(4, 'user'), wire(5, 'assistant')],
      })
      .mockResolvedValueOnce({
        sessionKey,
        sessionId: generation,
        hasMore: false,
        nextOffset: null,
        totalMessages: 5,
        messages: [wire(1, 'assistant'), wire(2, 'user'), wire(3, 'assistant')],
      });

    if (action === 'loadHistory') await actions.loadHistory(sessionKey);
    else await actions.restoreLatestHistory();

    expect(context.cursor.current?.nextOffset).toBe(2);
    expect(state.canLoadOlder).toBe(true);
    expect(history.mock.calls.map(call => call.slice(1))).toEqual([[80, 0], [80, 2]]);
    expect(state.messages.flatMap(message => message.displayPosition ? [message.displayPosition.rawSeq] : []))
      .toEqual([1, 2, 3, 4, 5]);
  });

  it.each(['refresh', 'restore', 'reveal', 'review'] as const)('%s recovers a tail beyond the bridge budget without joining across the gap', async action => {
    const { context, state, history, actions } = setup(action === 'refresh' ? 'latest' : 'older');
    const generation = '00000000-0000-4000-8000-000000000117';
    const page = (seqs: number[], offset: number) => ({
      sessionKey, sessionId: generation, hasMore: true, nextOffset: offset, totalMessages: 1000,
      messages: seqs.map(seq => ({ role: 'user', content: `prompt ${seq}`, timestamp: 1_789_000_000_000 + seq,
        __openclaw: { id: `native-${seq}`, transcriptPosition: { source: 'sqlite', rawSeq: seq } } })),
    });
    const cached = messagesFromPayload(page([1], 80));
    const local: WorkspaceMessage = { id: 'unsynced', role: 'user', text: 'Not canonical yet', source: 'local', sessionKey };
    const tail = [...cached, local];
    context.latestTailCache.current.store(sessionKey, tail);
    if (action === 'refresh') { state.messages = tail; context.historyCache.current.store(sessionKey, tail); }
    context.cursor.current = { sessionKey, nextOffset: 500, hasMore: true, totalMessages: 900 };
    history.mockReset().mockResolvedValueOnce(page([900, 901], 80))
      .mockImplementation(async (_key, _limit, offset) => page([900 - offset], offset + 80));
    if (action === 'restore') await actions.restoreLatestHistory();
    else await actions.loadHistory(sessionKey, action === 'reveal' ? 'reveal-current' : 'preserve-review');
    expect(history).toHaveBeenCalledTimes(action === 'reveal' ? 1 : 7);
    expect(state.problem).toBe('');
    const published = context.latestTailCache.current.restore(sessionKey)!;
    expect(published.filter(row => row.displayPosition).map(row => row.displayPosition?.rawSeq)).toEqual([900, 901]);
    expect(published.some(row => row.id === local.id)).toBe(true);
    if (action === 'review') {
      expect(state.messages).toBe(review);
      expect(context.windowMode.current).toBe('older');
      expect(context.cursor.current?.nextOffset).toBe(600);
    } else {
      expect(state.messages).toEqual(published);
      expect(context.cursor.current?.nextOffset).toBe(80);
      expect(context.windowMode.current).toBe('latest');
      expect(state.canLoadOlder).toBe(true);
      // The new retained edge overlaps, so subsequent refreshes do not repeat the bridge.
      history.mockResolvedValue(page([900, 901], 80));
      await actions.loadHistory(sessionKey);
      expect(history).toHaveBeenCalledTimes(action === 'reveal' ? 2 : 8);
      // The first older page remains reachable, including the formerly missing span.
      const olderRows = messagesFromPayload(page([820, 899], 160));
      expect(olderPageHistoryPublication(state.messages, published, olderRows, sessionKey).visible
        .filter(row => row.displayPosition).map(row => row.displayPosition?.rawSeq)).toEqual([820, 899, 900, 901]);
    }
  });

  for (const action of ['loadHistory', 'restoreLatestHistory'] as const) {
    it(`${action} publishes valid latest rows with retry state, then recovers prompt context`, async () => {
      const { context, state, history, actions } = setup(action === 'restoreLatestHistory' ? 'older' : 'latest');
      await actions[action](sessionKey);
      expect(state.messages.map(message => message.id)).toEqual(['answer']);
      expect(state.problem).toBe('earlier prompt context: Network unavailable');
      expect(context.historyFailure.current).toBe('latest');
      expect(context.windowMode.current).toBe('latest');
      expect(state.canLoadOlder).toBe(true);
      expect(context.cursor.current?.nextOffset).toBe(80);

      history.mockResolvedValueOnce(latest).mockResolvedValueOnce(older);
      // Both failure paths use the existing latest-refresh retry action.
      await actions.loadHistory(sessionKey);
      expect(state.messages.map(message => message.id)).toEqual(['prompt', 'answer']);
      expect(state.problem).toBe('');
      expect(context.historyFailure.current).toBeNull();
      expect(history.mock.calls.map(call => call[2])).toEqual([0, 80, 0, 80]);
    });

    it(`${action} retires rejected lookback after scene suspension`, async () => {
      const { context, state, history, actions } = setup();
      history.mockReset().mockResolvedValueOnce(latest).mockImplementationOnce(async () => {
        context.publicationAuthority.current!.suspend();
        throw new Error('Disconnected');
      });
      await actions[action](sessionKey);
      expect(context.setHistoryMessages).not.toHaveBeenCalled();
      expect(context.setCanLoadOlder).not.toHaveBeenCalled();
      expect(context.onDetail).not.toHaveBeenCalled();
      expect(context.persistLater).not.toHaveBeenCalled();
      expect(state.problem).toBe('');
      expect(context.cursor.current).toBeNull();
    });

    it(`${action} rejects a stale result after a generation revision`, async () => {
      const { context, state, history, actions } = setup();
      history.mockReset().mockResolvedValueOnce(latest).mockImplementationOnce(async () => {
        context.latestRequestRevision.current += 1;
        return older;
      });
      await actions[action](sessionKey);
      expect(context.setHistoryMessages).not.toHaveBeenCalled();
      expect(state.messages).toEqual([]);
      expect(context.cursor.current).toBeNull();
    });

    it(`${action} never publishes into another selected session`, async () => {
      const { context, state, history, actions } = setup();
      history.mockReset().mockResolvedValueOnce(latest).mockImplementationOnce(async () => {
        context.selectedRef.current = 'two';
        throw new Error('Disconnected');
      });
      await actions[action](sessionKey);
      expect(context.setHistoryMessages).not.toHaveBeenCalled();
      expect(context.onDetail).not.toHaveBeenCalled();
      expect(state.problem).toBe('');
      expect(context.cursor.current).toBeNull();
    });

    it.each(['failure', 'selection', 'scene'] as const)(`${action} does not commit an oversized candidate after narrowing %s`, async (retired) => {
      const { context, state, history, actions } = setup('older');
      const messages = Array.from({ length: 20 }, (_, i) => ({ id: `dense-${i}`, role: i % 2 ? 'assistant' : 'user',
        content: i % 2 ? Array.from({ length: 100 }, (_, line) => `answer ${i} line ${line}`).join('\n') : `prompt ${i}` }));
      const dense = { sessionKey, messages, hasMore: false, nextOffset: null, totalMessages: 20 };
      history.mockReset().mockResolvedValueOnce(dense).mockImplementationOnce(async () => {
        if (retired === 'failure') throw new Error('Smaller page unavailable');
        if (retired === 'selection') context.selectedRef.current = 'two';
        if (retired === 'scene') context.publicationAuthority.current!.suspend();
        return dense;
      });
      await actions[action](sessionKey);
      expect(history.mock.calls.map(call => call.slice(1))).toEqual([[80, 0], [40, 0]]);
      expect(state.messages).toEqual(review);
      expect(context.cursor.current).toBeNull();
      expect(context.setHistoryMessages).not.toHaveBeenCalled();
      expect(context.persistLater).not.toHaveBeenCalled();
      expect(state.problem).toBe(retired === 'failure' && action === 'restoreLatestHistory' ? 'Smaller page unavailable' : '');
      if (retired === 'failure') expect(context.onDetail).toHaveBeenCalledWith('Smaller page unavailable');
    });

    it(`${action} leaves existing rows intact when the required latest page itself fails`, async () => {
      const { context, state, history, actions } = setup('older');
      history.mockReset().mockRejectedValueOnce(new Error('Latest page unavailable'));
      await actions[action](sessionKey);
      expect(state.messages).toEqual(review);
      expect(context.setHistoryMessages).not.toHaveBeenCalled();
      expect(context.cursor.current).toBeNull();
      expect(history).toHaveBeenCalledExactlyOnceWith(sessionKey, 80, 0);
      expect(context.onDetail).toHaveBeenCalledWith('Latest page unavailable');
    });
  }

  it('updates the hidden latest tail without overwriting an older review or its error', async () => {
    const { context, state, actions } = setup('older');
    state.problem = 'Older history failed';
    context.historyFailure.current = 'older';
    await actions.loadHistory(sessionKey);
    expect(state.messages).toEqual(review);
    expect(state.problem).toBe('Older history failed');
    expect(context.historyFailure.current).toBe('older');
    expect(context.windowMode.current).toBe('older');
    expect(context.setHistoryMessages).not.toHaveBeenCalled();
    expect(context.latestTailCache.current.restore(sessionKey)?.map(message => message.id)).toEqual(['answer']);
    expect(context.persistLater).toHaveBeenCalledExactlyOnceWith(sessionKey, expect.arrayContaining([expect.objectContaining({ id: 'answer' })]));
  });

  it('reveals a nonempty current tail when thread re-entry began from a restored review', async () => {
    const { context, state, actions } = setup('older');
    await actions.loadHistory(sessionKey, 'reveal-current');
    expect(state.messages.map(message => message.id)).toEqual(['answer']);
    expect(context.windowMode.current).toBe('latest');
    expect(context.clearPersistedHistoryReview).toHaveBeenCalledExactlyOnceWith(sessionKey);
  });

  it('keeps a restored review when thread re-entry finds a genuinely empty current generation', async () => {
    const { context, state, history, actions } = setup('older');
    history.mockReset().mockResolvedValueOnce({
      sessionKey, messages: [], hasMore: false, nextOffset: null, totalMessages: 0,
    });
    await actions.loadHistory(sessionKey, 'reveal-current');
    expect(state.messages).toEqual(review);
    expect(context.windowMode.current).toBe('older');
    expect(context.clearPersistedHistoryReview).not.toHaveBeenCalled();
  });

  it('preserves retry state when canonical latest rows recover an obsolete archive review', async () => {
    const { context, state, actions } = setup('older');
    context.archiveRecovery.current.request(sessionKey);
    await actions.loadHistory(sessionKey);
    expect(state.messages.map(message => message.id)).toEqual(['answer']);
    expect(context.windowMode.current).toBe('latest');
    expect(context.historyFailure.current).toBe('latest');
    expect(state.problem).toBe('earlier prompt context: Network unavailable');
    expect(context.clearPersistedHistoryReview).toHaveBeenCalledExactlyOnceWith(sessionKey);
  });

  it('defers a normal refresh behind an existing older-page request', async () => {
    const { context, history, actions } = setup('older');
    context.olderRequest.current.begin(sessionKey, 0);
    await actions.loadHistory(sessionKey);
    expect(history).not.toHaveBeenCalled();
    expect(context.deferredLatestRefresh.current.consume(sessionKey)).toBe(sessionKey);
  });

  it('bare G keeps the mounted review when the latest generation is legitimately empty', async () => {
    const { context, state, history, actions } = setup('older');
    history.mockReset().mockResolvedValueOnce({ messages: [], hasMore: false });
    await actions.restoreLatestHistory();
    expect(state.messages).toEqual(review);
    expect(context.windowMode.current).toBe('older');
    expect(state.problem).toBe('');
    expect(context.persistHistoryReview).toHaveBeenCalledExactlyOnceWith(sessionKey, review);
    expect(context.clearPersistedHistoryReview).not.toHaveBeenCalled();
  });
});


it('keeps whole-session narration outside the fetched page from masking older-page progress', async () => {
  const { context, state, history, actions } = setup('latest');
  const time = 1_788_000_000_000;
  history.mockReset().mockResolvedValue({ sessionKey, hasMore: true, nextOffset: 80, totalMessages: 500,
    messages: [
      { id: 'latest-prompt', role: 'user', content: 'latest prompt', timestamp: time + 6000 },
      { id: 'latest-final', role: 'assistant', content: 'latest final', timestamp: time + 6002 },
    ] });
  const narration: WorkspaceMessage[] = Array.from({ length: 480 }, (_, index) => ({
    id: `live-item-old-${index}`, narrationItemId: `old-${index}`, role: 'narration', text: `old preamble ${index}`, timestamp: String(time + index), sessionKey, source: 'history',
  }));
  narration.push({ id: 'current-preamble', role: 'narration', text: 'current preamble', timestamp: String(time + 6001), sessionKey, source: 'history' });
  vi.mocked(context.hydrateSharedNarration).mockResolvedValue(narration);
  await actions.loadHistory(sessionKey);
  const olderPage: WorkspaceMessage[] = [{ id: 'older-visible', role: 'user', text: 'the newly loaded page', timestamp: String(time + 5000), sessionKey, source: 'history' }];
  const reviewed = olderPageHistoryPublication(state.messages, state.messages, olderPage, sessionKey).visible;
  expect(reviewed[0]?.id).toBe('older-visible');
  expect(state.messages.map(row => row.id)).toEqual(['latest-prompt', 'current-preamble', 'latest-final', 'history-run-latest-final']);
});


it.each(['restore', 'reentry'] as const)('resets pagination to the visible latest window on explicit %s', async kind => {
  const { context, state, history, actions } = setup('older');
  context.cursor.current = { sessionKey, hasMore: true, nextOffset: 400, totalMessages: 1000 };
  const identity = { sessionKey, currentSessionId: 'current', currentSessionStartedAtMs: 1 };
  context.archive.current = { identity, exhausted: true, pageCursor: { segmentIndex: 0, nextOffset: 256, totalRawRecords: 1000 } };
  history.mockReset().mockResolvedValue({ sessionKey, hasMore: true, nextOffset: 80, totalMessages: 1000,
    messages: [{ id: 'new-tail', role: 'user', content: 'latest boundary' }] });
  if (kind === 'restore') await actions.restoreLatestHistory();
  else await actions.loadHistory(sessionKey, 'reveal-current');
  expect(state.messages.map(row => row.id)).toContain('new-tail');
  expect(context.cursor.current?.nextOffset).toBe(80);
  expect(context.archive.current).toEqual({ identity, exhausted: false });
});


it('rereads once after an older in-flight snapshot when remote user input arrives', async () => {
  const { state, history, actions } = setup();
  let release!: (page: unknown) => void;
  history.mockReset().mockReturnValueOnce(new Promise(resolve => { release = resolve; }))
    .mockResolvedValue({ sessionKey, hasMore: false, messages: [{ id: 'remote-user', role: 'user', content: 'From the iPad.' }] });
  const old = actions.loadHistory(sessionKey);
  await vi.waitFor(() => expect(history).toHaveBeenCalledOnce());
  const input = actions.loadHistory(sessionKey, 'preserve-review', true);
  const secondInput = actions.loadHistory(sessionKey, 'preserve-review', true);
  release({ sessionKey, hasMore: false, messages: [] });
  await Promise.all([old, input, secondInput]);
  expect(history).toHaveBeenCalledTimes(2);
  expect(state.messages.some(row => row.id === 'remote-user')).toBe(true);
});

it('retires a queued remote-input reread when its session is deselected', async () => {
  const { context, history, actions } = setup();
  let release!: (page: unknown) => void;
  history.mockReset().mockReturnValueOnce(new Promise(resolve => { release = resolve; }));
  const old = actions.loadHistory(sessionKey);
  await vi.waitFor(() => expect(history).toHaveBeenCalledOnce());
  const input = actions.loadHistory(sessionKey, 'preserve-review', true);
  context.selectedRef.current = 'two';
  release({ sessionKey, hasMore: false, messages: [] });
  await Promise.all([old, input]);
  expect(history).toHaveBeenCalledOnce();
});
