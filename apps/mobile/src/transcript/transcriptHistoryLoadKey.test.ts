import { describe, expect, it } from 'vitest';
import { requestsNewerTranscriptAtReviewBottom, cursorProjectsToOldestVisibleStop, requestsOlderTranscriptAtReviewTop, requestsOlderTranscriptAtVisibleTop } from './transcriptHistoryLoadKey';

const event = (key: string, extra = {}) => ({ key, shift: false, control: false, option: false, command: false, ...extra });

describe('older transcript keyboard trigger', () => {
  it('requires one fresh k after navigation has already reached the oldest visible row', () => {
    expect(requestsOlderTranscriptAtReviewTop(event('k'), 18, [12, 18, 41], true)).toBe(false);
    expect(requestsOlderTranscriptAtReviewTop(event('k'), 12, [12, 18, 41], true)).toBe(true);
  });

  it('does not cascade from a held k or treat another top-boundary key as a request', () => {
    expect(requestsOlderTranscriptAtReviewTop(event('k', { isRepeat: true }), 12, [12, 18, 41], true)).toBe(false);
    expect(requestsOlderTranscriptAtReviewTop(event('up'), 12, [12, 18, 41], true)).toBe(false);
    expect(requestsOlderTranscriptAtReviewTop(event('enter'), 12, [12, 18, 41], true)).toBe(false);
    expect(requestsOlderTranscriptAtReviewTop(event('k'), 18, [12, 18, 41], true)).toBe(false);
    expect(requestsOlderTranscriptAtReviewTop(event('k', { control: true }), 12, [12, 18, 41], true)).toBe(false);
    expect(requestsOlderTranscriptAtReviewTop(event('k'), 12, [12, 18, 41], false)).toBe(false);
  });

  it('uses the same projected stop as folded Vim navigation', () => {
    expect(cursorProjectsToOldestVisibleStop(12, [12, 18, 41])).toBe(true);
    expect(cursorProjectsToOldestVisibleStop(14, [12, 18, 41])).toBe(true);
    expect(cursorProjectsToOldestVisibleStop(18, [12, 18, 41])).toBe(false);
    expect(cursorProjectsToOldestVisibleStop(20, [12, 18, 41])).toBe(false);
    expect(cursorProjectsToOldestVisibleStop(12, [])).toBe(false);
    expect(requestsOlderTranscriptAtReviewTop(event('k'), 14, [12, 18, 41], true)).toBe(true);
  });

  it('accepts the pane-rendered oldest stop as the keyboard authority', () => {
    expect(requestsOlderTranscriptAtVisibleTop(event('k'), true, true)).toBe(true);
    expect(requestsOlderTranscriptAtVisibleTop(event('k', { isRepeat: true }), true, true)).toBe(false);
    expect(requestsOlderTranscriptAtVisibleTop(event('k'), false, true)).toBe(false);
  });
});

describe('newer transcript keyboard trigger', () => {
  it('requires a fresh unmodified j at the last committed visible stop', () => {
    expect(requestsNewerTranscriptAtReviewBottom(event('j'), 41, [12, 18, 41], true)).toBe(true);
    expect(requestsNewerTranscriptAtReviewBottom(event('j'), 18, [12, 18, 41], true)).toBe(false);
    expect(requestsNewerTranscriptAtReviewBottom(event('j', { isRepeat: true }), 41, [12, 18, 41], true)).toBe(false);
    expect(requestsNewerTranscriptAtReviewBottom(event('j', { command: true }), 41, [12, 18, 41], true)).toBe(false);
    expect(requestsNewerTranscriptAtReviewBottom(event('j'), 41, [12, 18, 41], false)).toBe(false);
    expect(requestsNewerTranscriptAtReviewBottom(event('j'), 41, [], true)).toBe(false);
  });
});
