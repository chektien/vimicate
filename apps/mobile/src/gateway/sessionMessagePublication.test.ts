import { describe, expect, it, vi } from 'vitest';
import type { WorkspaceMessage } from '../workspace/workspaceTypes';
import { createSessionMessagePublisher } from './sessionMessagePublication';
import { HistoryPublicationAuthority } from './historyPublicationAuthority';
import { SessionHistoryCache } from './sessionHistoryCache';
import { SessionHistoryViewCache } from './sessionHistoryView';

const row = (id: string): WorkspaceMessage => ({ id, role: 'assistant', text: id, sessionKey: 'one', source: 'history' });
const repair = (rows: WorkspaceMessage[]) => rows.map(message => message.id === 'old' ? { ...message, text: 'full answer' } : message);
function setup(mode: 'latest' | 'older' = 'older') {
  const queue: ((rows: WorkspaceMessage[]) => WorkspaceMessage[])[] = [];
  const scene = new HistoryPublicationAuthority();
  const visible = [row('old')]; const latest = mode === 'older' ? [row('latest')] : visible;
  const context: Parameters<typeof createSessionMessagePublisher>[0] = {
    selectedRef: { current: 'one' }, activeSessionKey: { current: 'one' },
    publicationAuthority: { current: scene }, windowMode: { current: mode },
    historyCache: { current: new SessionHistoryCache() }, latestTailCache: { current: new SessionHistoryCache() },
    historyViewCache: { current: new SessionHistoryViewCache() },
    setMessageState: action => queue.push(rows => typeof action === 'function' ? action(rows) : action),
    persistLater: vi.fn(), persistHistoryReview: vi.fn(),
  };
  context.historyCache.current.store('one', visible); context.latestTailCache.current.store('one', latest);
  context.historyViewCache.current.store('one', {
    windowMode: mode, reviewEntryIntent: mode === 'older' ? 'deliberate' : null,
    generation: null, archive: null, cursor: null, historyFailure: null, historyProblem: '',
  });
  const flush = (rows = visible) => queue.splice(0).reduce((current, action) => action(current), rows);
  return { context, scene, visible, latest, queue, flush, publish: createSessionMessagePublisher(context) };
}

describe('session message publication actions', () => {
  it('notifies new-response subscribers for a hidden live tail without replacing review, coalesced and disposed', async () => {
    const test = setup(); const notify = vi.fn();
    const unsubscribe = test.context.latestTailCache.current.subscribe(notify);
    test.publish('one', rows => [...rows, row('preamble')]);
    test.publish('one', rows => [...rows, row('final')]);
    expect(test.queue).toEqual([]);
    expect(test.context.historyCache.current.restore('one')).toEqual(test.visible);
    expect(notify).not.toHaveBeenCalled();
    await Promise.resolve(); expect(notify).toHaveBeenCalledTimes(1);
    expect(test.context.latestTailCache.current.restore('one')?.at(-1)?.id).toBe('final');
    test.publish('one', rows => rows.map(message => ({ ...message })));
    await Promise.resolve(); expect(notify).toHaveBeenCalledTimes(1);
    test.publish('one', rows => [...rows, row('later')]); unsubscribe();
    await Promise.resolve(); expect(notify).toHaveBeenCalledTimes(1);
  });

  it('publishes and persists review-only recovery even when the latest tail is unchanged', () => {
    const test = setup(); test.publish('one', repair, 'message-recovery');
    const next = test.flush();
    expect(next[0]?.text).toBe('full answer');
    expect(test.context.historyCache.current.restore('one')).toEqual(next);
    expect(test.context.latestTailCache.current.restore('one')).toEqual(test.latest);
    expect(test.context.persistHistoryReview).toHaveBeenCalledWith('one', next);
    expect(test.context.persistLater).not.toHaveBeenCalled();
    expect(test.context.windowMode.current).toBe('older');
  });

  it('repairs a parked review without publishing into the selected dataset', () => {
    const test = setup(); test.context.selectedRef.current = 'two'; test.context.activeSessionKey.current = 'two';
    test.publish('one', repair, 'message-recovery');
    expect(test.queue).toEqual([]);
    expect(test.context.historyCache.current.restore('one')?.[0]?.text).toBe('full answer');
    expect(test.context.persistHistoryReview).toHaveBeenCalledWith('one', expect.any(Array));
    expect(test.context.persistLater).not.toHaveBeenCalled();
  });

  it('rejects a queued recovery publication after a scene epoch changes', () => {
    const test = setup(); test.publish('one', repair, 'message-recovery');
    test.scene.suspend(); test.scene.resume();
    expect(test.flush()).toBe(test.visible);
    expect(test.context.historyCache.current.restore('one')).toEqual(test.visible);
    expect(test.context.persistHistoryReview).not.toHaveBeenCalled();
  });

  it('routes queued recovery to its parked owner after selection changes', () => {
    const test = setup(); test.publish('one', repair, 'message-recovery');
    test.context.selectedRef.current = 'two'; test.context.activeSessionKey.current = 'two';
    const foreign = [{ ...row('foreign'), sessionKey: 'two' }];
    expect(test.flush(foreign)).toBe(foreign);
    expect(test.context.historyCache.current.restore('one')?.[0]?.text).toBe('full answer');
  });

  it('rechecks review mode before a queued live update applies', () => {
    const test = setup('latest'); test.publish('one', rows => [...rows, row('live')]);
    test.context.windowMode.current = 'older';
    const review = [row('review')];
    expect(test.flush(review)).toBe(review);
    expect(test.context.latestTailCache.current.restore('one')?.map(message => message.id)).toEqual(['old', 'live']);
    expect(test.context.persistHistoryReview).not.toHaveBeenCalled();
  });

  it('bounds parked live updates while preserving an older review', () => {
    const test = setup(); test.context.selectedRef.current = 'two';
    test.publish('one', rows => [...rows, ...Array.from({ length: 2_000 }, (_, i) => row(`live-${i}`))]);
    expect(test.queue).toEqual([]);
    expect(test.context.historyCache.current.restore('one')).toEqual(test.visible);
    expect(test.context.latestTailCache.current.restore('one')).toHaveLength(480);
    expect(test.context.persistHistoryReview).not.toHaveBeenCalled();
  });

  it('updates both caches for latest-tail recovery and preserves equal publication identity', () => {
    const test = setup('latest'); test.publish('one', repair, 'message-recovery');
    const next = test.flush();
    expect(test.context.historyCache.current.restore('one')).toEqual(next);
    expect(test.context.latestTailCache.current.restore('one')).toEqual(next);
    expect(test.context.persistLater).toHaveBeenCalledOnce();
    test.publish('one', rows => rows.map(message => ({ ...message })), 'message-recovery');
    expect(test.flush(next)).toBe(next);
    expect(test.context.persistLater).toHaveBeenCalledOnce();
  });

  it('stages an optimistic prompt before a parked reply survives switch-back before React commits', () => {
    const test = setup('latest');
    const prompt: WorkspaceMessage = {
      id: 'local-prompt', role: 'user', text: 'new request', source: 'local',
      sessionKey: 'one', idempotencyKey: 'submission-one', timestamp: '1000',
    };
    const reply: WorkspaceMessage = {
      id: 'live-reply', role: 'assistant', text: 'working', source: 'live',
      sessionKey: 'one', runId: 'run-one', timestamp: '1001',
    };

    test.publish('one', current => [...current, prompt], 'optimistic-prompt');
    expect(test.context.historyCache.current.restore('one')?.map(message => message.id))
      .toEqual(['old', 'local-prompt']);

    test.context.selectedRef.current = 'two'; test.context.activeSessionKey.current = 'two';
    test.publish('one', current => [...current, reply]);
    expect(test.context.historyCache.current.restore('one')?.map(message => message.id))
      .toEqual(['old', 'local-prompt', 'live-reply']);

    test.context.selectedRef.current = 'one'; test.context.activeSessionKey.current = 'one';
    const mounted = test.context.historyCache.current.restore('one') ?? [];
    expect(test.flush(mounted)).toBe(mounted);
    expect(mounted.map(message => message.id)).toEqual(['old', 'local-prompt', 'live-reply']);
  });

  it('does nothing while inactive, including parked-session writes', () => {
    const test = setup(); test.scene.suspend(); test.context.selectedRef.current = 'two';
    test.publish('one', repair, 'message-recovery');
    expect(test.queue).toEqual([]);
    expect(test.context.historyCache.current.restore('one')).toEqual(test.visible);
    expect(test.context.persistHistoryReview).not.toHaveBeenCalled();
  });
});
