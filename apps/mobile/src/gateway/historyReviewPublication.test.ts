import { describe, expect, it } from 'vitest';
import type { WorkspaceMessage } from '../workspace/workspaceTypes';
import { authorizedHistoryStatePublication, externalHistoryPublication, latestHistoryRefreshAction, latestSessionPublication, olderPageHistoryPublication, parkedSessionHistoryPublication, promptSubmissionHistoryPublication } from './historyReviewPublication';
import { returnToLatestHistory } from './sessionHistoryView';

const row = (id: string, source: WorkspaceMessage['source'] = 'history'): WorkspaceMessage => ({ id, role: 'assistant', text: id, source, sessionKey: 'one' });

describe('older-history review publication', () => {
  it('applies explicit full-message recovery to an older review without mounting the latest tail', () => {
    const visible = [row('old-1'), row('old-2')];
    const latest = [row('new-1')];
    const recover = (rows: WorkspaceMessage[]) => rows.map(message => message.id === 'old-1'
      ? { ...message, text: 'complete older answer' } : message);
    const result = externalHistoryPublication('older', visible, latest, recover, 'message-recovery');
    expect(result.visible.map(message => message.id)).toEqual(['old-1', 'old-2']);
    expect(result.visible[0]?.text).toBe('complete older answer');
    expect(result.visible[1]).toBe(visible[1]);
    expect(result.latest).toEqual(latest);
    const live = externalHistoryPublication('older', result.visible, result.latest, rows => [...rows, row('live')]);
    expect(live.visible).toBe(result.visible);
    expect(live.latest.map(message => message.id)).toEqual(['new-1', 'live']);
  });

  it('retains a recovered parked review even when no matching row exists in the hidden tail', () => {
    const review = [row('old')]; const latest = [row('new')];
    const result = parkedSessionHistoryPublication('older', review, latest,
      rows => rows.map(message => message.id === 'old' ? { ...message, text: 'complete' } : message), 'message-recovery');
    expect(result.replaceVisible).toBe(true);
    expect(result.visible[0]?.text).toBe('complete');
    expect(result.latest).toEqual(latest);
  });

  it('keeps the mounted review dataset byte-for-byte stable while live rows update the hidden latest tail', () => {
    const visible = [row('old-1'), row('old-2')];
    const latest = [row('new-1')];
    const result = externalHistoryPublication('older', visible, latest, (current) => [...current, row('stream', 'live')]);
    expect(result.visible).toBe(visible);
    expect(result.latest.map((item) => item.id)).toEqual(['new-1', 'stream']);
  });

  it('publishes and bounds the mounted dataset normally at the latest tail', () => {
    const visible = [row('new-1')];
    const result = externalHistoryPublication('latest', visible, visible, (current) => [...current, row('stream', 'live')]);
    expect(result.visible.map((item) => item.id)).toEqual(['new-1', 'stream']);
    expect(result.latest).toBe(result.visible);
  });

  it('does not let a queued canonical refresh erase a live row applied immediately before it', () => {
    const canonical = [{ ...row('canonical'), timestamp: '1000' }];
    let latest: WorkspaceMessage[] = [];
    const queue: Array<(current: WorkspaceMessage[]) => WorkspaceMessage[]> = [];

    queue.push((current) => {
      const publication = externalHistoryPublication('latest', current, latest, (rows) => [
        ...rows,
        { ...row('live', 'live'), role: 'narration', runId: 'run-one' },
      ]);
      latest = publication.latest;
      return publication.visible;
    });
    queue.push(latestHistoryRefreshAction(canonical, 'one', () => latest));

    const visible = queue.reduce((current, action) => action(current), [] as WorkspaceMessage[]);
    expect(visible.map((message) => message.id)).toEqual(['live', 'canonical']);
  });

  it('rebases stale native history at application time while preserving late live and pending inputs', () => {
    const generation = '00000000-0000-4000-8000-000000000117';
    const native = (seq: number): WorkspaceMessage => ({ ...row(`native-${seq}`), role: 'user',
      transcriptSessionId: generation, displayPosition: { source: 'sqlite', rawSeq: seq }, timestamp: String(1000 + seq) });
    const canonical = [native(900)];
    let tail = [native(1)];
    const publish = latestHistoryRefreshAction(canonical, 'one', () => tail, undefined,
      { source: 'sqlite', transcriptSessionId: generation, rawSeq: 900 });
    const pending: WorkspaceMessage = { ...row('pending-input:accepted'), role: 'user', runId: 'receipt',
      transcriptSessionId: generation, inputAcceptedAtMs: 2000, timestamp: '2000' };
    const local: WorkspaceMessage = { ...row('local', 'local'), role: 'user', timestamp: '2001' };
    const live: WorkspaceMessage = { ...row('late-live', 'live'), role: 'assistant', state: 'streaming', timestamp: '2002' };
    tail = [...tail, pending, local, live, native(901)];
    const result = publish([]);
    expect(result.map(message => message.id)).toEqual(expect.arrayContaining(['native-900', 'native-901', pending.id, local.id, live.id]));
    expect(result.some(message => message.id === 'native-1')).toBe(false);
  });

  it('rejects an older-page updater whose publication authority retired before React applies it', () => {
    const predecessor = [row('predecessor-page')];
    const successor = [{ ...row('successor-answer'), sessionKey: 'one' }];
    let ownsPublication = true;
    const queued = (current: WorkspaceMessage[]) => authorizedHistoryStatePublication(
      'one', 'one', 'one', () => ownsPublication, current,
      (rows) => olderPageHistoryPublication(rows, [], predecessor, 'one').visible,
    ).messages;

    // `/new` keeps the route key but retires every predecessor-generation
    // history request before React drains the already queued state updater.
    ownsPublication = false;
    expect(queued(successor)).toBe(successor);
    expect(queued(successor).map((message) => message.id)).toEqual(['successor-answer']);
  });

  it('can apply after transport settlement while its independent publication token remains current', () => {
    const current = [row('current')];
    let transportActive = true;
    const queued = (rows: WorkspaceMessage[]) => authorizedHistoryStatePublication(
      'one', 'one', 'one', () => true, rows,
      (visible) => [...visible, row('page')],
    ).messages;

    transportActive = false;
    expect(transportActive).toBe(false);
    expect(queued(current).map((message) => message.id)).toEqual(['current', 'page']);
  });

  it('lets a newer same-route request publish without reviving the retired one', () => {
    const current = [row('current')];
    let olderOwns = true;
    const older = (rows: WorkspaceMessage[]) => authorizedHistoryStatePublication(
      'one', 'one', 'one', () => olderOwns, rows,
      (visible) => [...visible, row('retired')],
    ).messages;
    const newer = (rows: WorkspaceMessage[]) => authorizedHistoryStatePublication(
      'one', 'one', 'one', () => true, rows,
      (visible) => [...visible, row('newer')],
    ).messages;

    olderOwns = false;
    const published = [older, newer].reduce((rows, action) => action(rows), current);
    expect(published.map((message) => message.id)).toEqual(['current', 'newer']);
  });

  it('does not let a retired short refresh erase a final published by a newer same-session request', () => {
    const prompt: WorkspaceMessage = {
      id: 'prompt', role: 'user', text: 'finish the review', source: 'history',
      sessionKey: 'one', timestamp: '1000',
    };
    const final: WorkspaceMessage = {
      id: 'final', role: 'assistant', text: 'The review is complete.', source: 'history',
      sessionKey: 'one', timestamp: '3000',
    };
    let staleOwns = true;
    const staleShortPage = (rows: WorkspaceMessage[]) => authorizedHistoryStatePublication(
      'one', 'one', 'one', () => staleOwns, rows,
      latestHistoryRefreshAction([prompt], 'one', () => rows),
    ).messages;
    const freshFinalPage = (rows: WorkspaceMessage[]) => authorizedHistoryStatePublication(
      'one', 'one', 'one', () => true, rows,
      latestHistoryRefreshAction([prompt, final], 'one', () => rows),
    ).messages;

    staleOwns = false;
    const published = [freshFinalPage, staleShortPage].reduce(
      (rows, action) => action(rows),
      [] as WorkspaceMessage[],
    );

    expect(published.map((message) => message.id)).toEqual(['prompt', 'final', 'history-run-final']);
  });

  it('rejects a queued history updater after the selected dataset changes', () => {
    const threadB = [{ ...row('thread-b'), sessionKey: 'two' }];
    const publication = authorizedHistoryStatePublication(
      'one', 'two', 'two', () => true, threadB,
      (rows) => [...rows, row('thread-a-history')],
    );

    expect(publication.owned).toBe(false);
    expect(publication.messages).toBe(threadB);
  });

  it('mounts the hidden latest tail before an optimistic prompt is appended', () => {
    const review = [row('older-answer')];
    const latest = [row('latest-answer')];
    const prepared = promptSubmissionHistoryPublication('older', review, latest);
    const sent = externalHistoryPublication(prepared.windowMode, prepared.visible, prepared.latest, (current) => [...current, row('new-prompt', 'local')]);

    expect(prepared.changed).toBe(true);
    expect(sent.visible.map((message) => message.id)).toEqual(['latest-answer', 'new-prompt']);
    expect(sent.latest).toBe(sent.visible);
  });

  it('preserves the exact live tail through sustained bounded older-history paging and bare G', () => {
    const latest = Array.from({ length: 40 }, (_, index) => row(`latest-${index}`));
    let publication = { visible: latest, latest };

    for (let page = 0; page < 24; page += 1) {
      const older = Array.from({ length: 80 }, (_, index) => row(`older-${page}-${index}`));
      publication = olderPageHistoryPublication(publication.visible, publication.latest, older, 'one');
      expect(publication.latest).toBe(latest);
      expect(publication.visible.reduce((rows, message) => rows + message.text.split('\n').length, 0)).toBeLessThanOrEqual(480);
    }

    expect(publication.visible.some((message) => message.id.startsWith('latest-'))).toBe(false);
    expect(returnToLatestHistory('older', publication.latest, publication.visible)).toEqual({
      windowMode: 'latest',
      messages: latest,
    });
  });

  it('bounds live publication for a parked session before it enters either cache', () => {
    const current = [row('old')];
    const incoming = Array.from({ length: 2_000 }, (_, index) => row(`live-${index}`, 'live'));
    const result = latestSessionPublication(current, (rows) => [...rows, ...incoming]);

    expect(result).toHaveLength(480);
    expect(result[0]?.id).toBe('live-1520');
    expect(result.at(-1)?.id).toBe('live-1999');
    expect(current.map((message) => message.id)).toEqual(['old']);
  });

  it('keeps a parked running thread review mounted while its hidden tail advances', () => {
    const review = [row('archived-prompt'), row('archived-answer')];
    const tail = [row('latest-answer')];
    const publication = parkedSessionHistoryPublication('older', review, tail, (current) => [
      ...current,
      row('background-progress', 'live'),
    ]);

    expect(publication.replaceVisible).toBe(false);
    expect(publication.visible).toBe(review);
    expect(publication.latest.map((message) => message.id)).toEqual(['latest-answer', 'background-progress']);
  });

  it('updates both parked caches when that session owns its latest tail', () => {
    const tail = [row('latest-answer')];
    const publication = parkedSessionHistoryPublication('latest', tail, tail, (current) => [
      ...current,
      row('background-progress', 'live'),
    ]);

    expect(publication.replaceVisible).toBe(true);
    expect(publication.visible).toBe(publication.latest);
  });

  it('bounds a byte-valid cold cache by visible rows before its first paint', () => {
    const cached = Array.from({ length: 200 }, (_, index): WorkspaceMessage => ({
      id: `cached-${index}`,
      role: 'assistant',
      source: 'history',
      sessionKey: 'one',
      text: Array.from({ length: 300 }, (_, line) => `cached ${index}:${line}`).join('\n'),
    }));

    const result = latestSessionPublication([], cached);
    expect(result).toHaveLength(1);
    expect(result[0]?.id).toBe('cached-199');
  });
});


describe('older review end authority', () => {
  it('distinguishes omitted current publications from shallow review, empty successors and completion decoration', async () => {
    const { reviewOmitsLatestMessages } = await import('./historyReviewPublication');
    const row: WorkspaceMessage = { id: 'new', role: 'assistant', text: 'Same words', sessionKey: 'one' };
    const old = { ...row, id: 'old' };
    expect(reviewOmitsLatestMessages('older', [old], [row])).toBe(true);
    expect(reviewOmitsLatestMessages('older', [old, row], [row])).toBe(false);
    expect(reviewOmitsLatestMessages('latest', [old], [row])).toBe(false);
    expect(reviewOmitsLatestMessages('older', [old], [])).toBe(false);
    expect(reviewOmitsLatestMessages('older', [row], [row, { ...row, id: 'completion', role: 'run' }])).toBe(false);
    expect(reviewOmitsLatestMessages('older', [{ ...row, sessionKey: 'other' }], [row])).toBe(true);
    const narration: WorkspaceMessage = { ...row, role: 'narration', transcriptSessionId: 'generation', narrationItemId: 'item' };
    expect(reviewOmitsLatestMessages('older', [{ ...narration, id: 'live-id' }], [narration])).toBe(false);
  });
});
