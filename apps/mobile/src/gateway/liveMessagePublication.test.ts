import { afterEach, describe, expect, it, vi } from 'vitest';
import type { WorkspaceMessage } from '../workspace/workspaceTypes';
import { flushBufferedLiveMessages, LIVE_MESSAGE_PUBLICATION_INTERVAL_MS, liveMessagePublicationDelayMs, liveMessagePublicationMode, LiveMessagePublicationBuffer, LiveMessagePublicationTimers, requiresImmediateLivePublication, RICH_LIVE_MESSAGE_PUBLICATION_INTERVAL_MS, suspendLiveMessagePublication } from './liveMessagePublication';
import { MAX_VISIBLE_HISTORY_ROWS } from './historyWindow';

const row = (id: string, text: string, role: WorkspaceMessage['role'] = 'assistant'): WorkspaceMessage => ({ id, text, role, state: 'streaming' });

describe('live Gateway transcript publication', () => {
  afterEach(() => vi.useRealTimers());
  it('coalesces cumulative frames by stable row identity without changing row order', () => {
    const pending = new LiveMessagePublicationBuffer();
    expect(pending.enqueue(row('answer', 'cumulative 1'))).toBe(true);
    expect(pending.drain()).toHaveLength(1);
    expect(pending.enqueue(row('answer', 'cumulative 2'))).toBe(false);
    for (let index = 3; index <= 500; index += 1) pending.enqueue(row('answer', `cumulative ${index}`));
    pending.enqueue(row('tool', 'start', 'tool'));
    pending.enqueue(row('answer', 'cumulative 501'));
    pending.enqueue(row('tool', 'result', 'tool'));

    expect(pending.size).toBe(2);
    expect(pending.drain().map((message) => [message.id, message.text])).toEqual([['answer', 'cumulative 501'], ['tool', 'result']]);
    expect(pending.size).toBe(0);
  });

  it('uses a slower latest-frame cadence for rich cumulative answers', () => {
    expect(liveMessagePublicationDelayMs(row('small', 'short'))).toBe(LIVE_MESSAGE_PUBLICATION_INTERVAL_MS);
    expect(liveMessagePublicationDelayMs(row('rich-lines', Array.from({ length: 241 }, (_, index) => String(index)).join('\n')))).toBe(RICH_LIVE_MESSAGE_PUBLICATION_INTERVAL_MS);
    expect(liveMessagePublicationDelayMs(row('rich-bytes', 'x'.repeat(16_000)))).toBe(RICH_LIVE_MESSAGE_PUBLICATION_INTERVAL_MS);
  });

  it('keeps approvals and failures on the immediate publication lane', () => {
    expect(requiresImmediateLivePublication(row('approval', 'allow?', 'approval'))).toBe(true);
    expect(requiresImmediateLivePublication({ ...row('failed', 'failed', 'tool'), state: 'error' })).toBe(true);
    expect(requiresImmediateLivePublication(row('answer', 'still working'))).toBe(false);
  });

  it('schedules ordinary first-seen rows while urgent and terminal facts bypass the cadence', () => {
    expect(liveMessagePublicationMode(row('tool', 'first tool', 'tool'), false)).toBe('schedule');
    expect(liveMessagePublicationMode(row('answer', 'first answer'), false)).toBe('schedule');
    expect(liveMessagePublicationMode(row('approval', 'allow?', 'approval'), false)).toBe('flush');
    expect(liveMessagePublicationMode(null, true)).toBe('flush');
    expect(liveMessagePublicationMode(null, false)).toBe('none');
  });

  it('coalesces a burst of unique tool rows into one scheduled publication', () => {
    vi.useFakeTimers();
    const pending = new LiveMessagePublicationBuffer();
    const timers = new LiveMessagePublicationTimers();
    const published: string[][] = [];
    const publish = () => published.push(pending.drain().map((message) => message.id));

    for (let index = 0; index < 100; index += 1) {
      const message = { ...row(`tool-${index}`, `step ${index}`, 'tool'), sessionKey: 'thread-a' };
      pending.enqueue(message);
      if (liveMessagePublicationMode(message, false) === 'schedule') {
        timers.schedule('thread-a', LIVE_MESSAGE_PUBLICATION_INTERVAL_MS, publish);
      }
    }

    expect(published).toEqual([]);
    expect(pending.size).toBe(100);
    vi.advanceTimersByTime(LIVE_MESSAGE_PUBLICATION_INTERVAL_MS);
    expect(published).toHaveLength(1);
    expect(published[0]).toHaveLength(100);
  });

  it('bounds a synchronous unique-row burst before the publication clock can run', () => {
    const pending = new LiveMessagePublicationBuffer();

    for (let index = 0; index < 10_000; index += 1) {
      pending.enqueue({
        ...row(`tool-${index}`, `step ${index}\n${'x'.repeat(2_000)}`, 'tool'),
        sessionKey: 'thread-a',
      });
    }

    expect(pending.size).toBe(MAX_VISIBLE_HISTORY_ROWS);
    const retained = pending.drain();
    expect(retained).toHaveLength(MAX_VISIBLE_HISTORY_ROWS);
    expect(retained[0]?.id).toBe('tool-9520');
    expect(retained.at(-1)?.id).toBe('tool-9999');
  });

  it('bounds pending identities per session without evicting another thread', () => {
    const pending = new LiveMessagePublicationBuffer();
    for (let index = 0; index < 10; index += 1) {
      pending.enqueue({ ...row(`a-${index}`, `A ${index}`, 'tool'), sessionKey: 'thread-a' });
    }
    for (let index = 0; index < 1_000; index += 1) {
      pending.enqueue({ ...row(`b-${index}`, `B ${index}`, 'tool'), sessionKey: 'thread-b' });
    }

    expect(pending.drainSession('thread-a').map((message) => message.id)).toEqual(
      Array.from({ length: 10 }, (_, index) => `a-${index}`),
    );
    const retainedB = pending.drainSession('thread-b');
    expect(retainedB).toHaveLength(MAX_VISIBLE_HISTORY_ROWS);
    expect(retainedB[0]?.id).toBe('b-520');
    expect(retainedB.at(-1)?.id).toBe('b-999');
    expect(pending.size).toBe(0);
  });

  it('bounds the number of sessions retained before any publication clock can run', () => {
    const pending = new LiveMessagePublicationBuffer();
    for (let index = 0; index < 65; index += 1) {
      pending.enqueue({
        ...row(`answer-${index}`, `session ${index}`),
        sessionKey: `thread-${index}`,
      });
    }

    expect(pending.drainSession('thread-0')).toEqual([]);
    expect(pending.size).toBe(64);
    expect(pending.drainSession('thread-64').map((message) => message.id)).toEqual(['answer-64']);
  });

  it('keeps a cumulatively updated session recent when the pending-session bound evicts', () => {
    const pending = new LiveMessagePublicationBuffer();
    for (let index = 0; index < 64; index += 1) {
      pending.enqueue({ ...row('answer', `session ${index}`), sessionKey: `thread-${index}` });
    }
    pending.enqueue({ ...row('answer', 'session 0 updated'), sessionKey: 'thread-0' });
    pending.enqueue({ ...row('answer', 'session 64'), sessionKey: 'thread-64' });

    expect(pending.drainSession('thread-1')).toEqual([]);
    expect(pending.drainSession('thread-0').map((message) => message.text)).toEqual(['session 0 updated']);
  });

  it('treats equal upstream ids in different sessions as distinct facts', () => {
    const pending = new LiveMessagePublicationBuffer();
    pending.enqueue({ ...row('answer', 'thread one'), sessionKey: 'one' });
    pending.enqueue({ ...row('answer', 'thread two'), sessionKey: 'two' });

    expect(pending.size).toBe(2);
    expect(pending.drainSession('one').map((message) => message.text)).toEqual(['thread one']);
    expect(pending.size).toBe(1);
    expect(pending.drainSession('two').map((message) => message.text)).toEqual(['thread two']);
  });

  it('flushes queued switch/background frames into their originating session caches', () => {
    const pending = new LiveMessagePublicationBuffer();
    pending.enqueue({ ...row('answer', 'A cumulative answer'), sessionKey: 'thread-a' });
    pending.enqueue({ ...row('image', 'A media card'), role: 'assistant', sessionKey: 'thread-a', attachments: [{ id: 'media-a', filename: 'a.png', mimeType: 'image/png' }] });
    pending.enqueue({ ...row('answer', 'B cumulative answer'), sessionKey: 'thread-b' });
    const sessions = new Map<string, WorkspaceMessage[]>();

    flushBufferedLiveMessages(pending, (sessionKey, action) => sessions.set(sessionKey, action(sessions.get(sessionKey) ?? [])));

    expect(sessions.get('thread-a')?.map((message) => message.id)).toEqual(['answer', 'image']);
    expect(sessions.get('thread-b')?.map((message) => message.id)).toEqual(['answer']);
    expect(pending.size).toBe(0);
  });

  it('keeps independent coalescing timers for late frames from two sessions', () => {
    vi.useFakeTimers();
    const timers = new LiveMessagePublicationTimers();
    const published: string[] = [];

    expect(timers.schedule('thread-a', 180, () => published.push('thread-a'))).toBe(true);
    expect(timers.schedule('thread-b', 180, () => published.push('thread-b'))).toBe(true);
    expect(timers.schedule('thread-a', 180, () => published.push('duplicate-a'))).toBe(false);
    vi.advanceTimersByTime(180);

    expect(published).toEqual(['thread-a', 'thread-b']);
    expect(timers.has('thread-a')).toBe(false);
    expect(timers.has('thread-b')).toBe(false);
  });

  it('bounds coalescing timers when one synchronous batch spans many sessions', () => {
    vi.useFakeTimers();
    const timers = new LiveMessagePublicationTimers();
    const published: string[] = [];
    for (let index = 0; index < 65; index += 1) {
      const sessionKey = `thread-${index}`;
      timers.schedule(sessionKey, 180, () => published.push(sessionKey));
    }

    expect(timers.has('thread-0')).toBe(false);
    expect(vi.getTimerCount()).toBe(64);
    vi.advanceTimersByTime(180);
    expect(published).toHaveLength(64);
    expect(published[0]).toBe('thread-1');
    expect(published.at(-1)).toBe('thread-64');
  });

  it('refreshes timer recency without extending the first-frame deadline', () => {
    vi.useFakeTimers();
    const timers = new LiveMessagePublicationTimers();
    for (let index = 0; index < 64; index += 1) timers.schedule(`thread-${index}`, 180, vi.fn());
    vi.advanceTimersByTime(100);
    expect(timers.schedule('thread-0', 180, vi.fn())).toBe(false);
    timers.schedule('thread-64', 180, vi.fn());

    expect(timers.has('thread-0')).toBe(true);
    expect(timers.has('thread-1')).toBe(false);
    vi.advanceTimersByTime(80);
    expect(timers.has('thread-0')).toBe(false);
    expect(timers.has('thread-64')).toBe(true);
  });

  it('contains a deferred publication exception instead of leaking a timer fatal', async () => {
    vi.useFakeTimers();
    const timers = new LiveMessagePublicationTimers();
    const failure = vi.fn();
    timers.schedule('thread-a', 180, () => { throw new Error('render failed'); }, failure);

    await vi.advanceTimersByTimeAsync(180);

    expect(failure).toHaveBeenCalledOnce();
    expect(failure).toHaveBeenCalledWith(expect.objectContaining({ message: 'render failed' }));
    expect(timers.has('thread-a')).toBe(false);
  });

  it('drops pending frames and timers at suspension without publishing UI state', () => {
    vi.useFakeTimers();
    const pending = new LiveMessagePublicationBuffer();
    const liveTimers = new LiveMessagePublicationTimers();
    const narrationTimers = new LiveMessagePublicationTimers();
    const published: string[] = [];
    pending.enqueue({ ...row('answer', 'late frame'), sessionKey: 'thread-a' });
    liveTimers.schedule('thread-a', 180, () => published.push('live'));
    narrationTimers.schedule('thread-a', 120, () => published.push('narration'));

    suspendLiveMessagePublication(liveTimers, narrationTimers, pending);
    vi.runAllTimers();

    expect(pending.size).toBe(0);
    expect(liveTimers.has('thread-a')).toBe(false);
    expect(narrationTimers.has('thread-a')).toBe(false);
    expect(published).toEqual([]);
  });
});

it('retains the longer pending snapshot before its first publication', () => {
  const buffer = new LiveMessagePublicationBuffer();
  const longer: WorkspaceMessage = { id: 'live-chat-r', sessionKey: 's', runId: 'r', role: 'assistant',
    source: 'live', state: 'streaming', text: 'Long streaming answer' };
  buffer.enqueue(longer);
  buffer.enqueue({ ...longer, text: 'Long' });
  expect(buffer.drainSession('s')).toEqual([longer]);
  expect(buffer.size).toBe(0);
});
