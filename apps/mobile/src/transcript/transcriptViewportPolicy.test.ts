import { describe, expect, it } from 'vitest';
import { boundedTranscriptRow, nextTranscriptViewportPostLayoutWork, shouldRecoverTranscriptBlankViewport, shouldRecoverTranscriptViewport, shouldRestoreTranscriptTailRange, shouldRunTranscriptViewportPostLayoutWork, shouldRunTranscriptViewportWriter, shouldScheduleTranscriptViewportFrame, shouldScrollTranscriptTarget, transcriptTailScrollOffset, transcriptTailWriterOwnsScrollSample, transcriptTargetOutsidePaintedViewport, transcriptEntryIndex, transcriptViewportIsOffContent, transcriptVisibleContentAnchor, transcriptVisibleRangeForRevision } from './transcriptViewportPolicy';

describe('transcript viewport policy', () => {
  it('does not recenter every j/k when the target remains safely visible', () => {
    expect(shouldScrollTranscriptTarget(13, { first: 10, last: 20 })).toBe(false);
    expect(shouldScrollTranscriptTarget(18, { first: 10, last: 20 })).toBe(true);
    expect(shouldScrollTranscriptTarget(10, { first: 10, last: 20 })).toBe(true);
    expect(shouldScrollTranscriptTarget(15, { first: 10, last: 20 }, true)).toBe(true);
  });

  it('requires a reveal when painted geometry disagrees with a stale visible index range', () => {
    const row = { y: 700, height: 20 };
    expect(transcriptTargetOutsidePaintedViewport(row, 1_000, 400)).toBe(true);
    expect(transcriptTargetOutsidePaintedViewport(row, 200, 400)).toBe(true);
    expect(transcriptTargetOutsidePaintedViewport(row, 600, 400)).toBe(false);
    expect(transcriptTargetOutsidePaintedViewport({ y: 600, height: 400 }, 600, 400)).toBe(false);
  });

  it('invalidates stale render indexes when transcript rows are revised', () => {
    const visible = { first: 0, last: 12 };
    expect(transcriptVisibleRangeForRevision('old', 'old', visible)).toBe(visible);
    expect(transcriptVisibleRangeForRevision('old', 'prepended', visible)).toBeNull();
  });

  it('does not restart reveal work for a tall row that is already the sole visible item', () => {
    expect(shouldScrollTranscriptTarget(12, { first: 12, last: 12 })).toBe(false);
    expect(shouldScrollTranscriptTarget(13, { first: 12, last: 12 })).toBe(true);
    expect(shouldScrollTranscriptTarget(12, { first: 12, last: 12 }, true)).toBe(true);
  });

  it('recognizes an offset stranded below contracted content', () => {
    expect(transcriptViewportIsOffContent(1_400, 1_000, 500)).toBe(true);
    expect(transcriptViewportIsOffContent(480, 1_000, 500)).toBe(false);
    // Physical owlpi entry: tail publication, then a native sample far above
    // the start with rows 37-52 still measured. That is off-content, not review.
    expect(transcriptViewportIsOffContent(-997_668, 1_978, 513)).toBe(true);
    expect(transcriptViewportIsOffContent(-540, 1_978, 513)).toBe(false);
    expect(transcriptViewportIsOffContent(-120, 1_978, 513)).toBe(false);
  });

  it('gives native insertion anchoring to the recycler without automatic tail scrolling', () => {
    expect(transcriptVisibleContentAnchor).toBe(transcriptVisibleContentAnchor);
    expect(transcriptVisibleContentAnchor).toEqual({ animateAutoScrollToBottom: false });
    expect(shouldRecoverTranscriptViewport(true, 1_400, 1_000, 500)).toBe(false);
    expect(shouldRecoverTranscriptViewport(false, 1_400, 1_000, 500)).toBe(true);
  });

  it('paints a newly entered thread at its tail or restored cursor, not row 0', () => {
    expect(transcriptEntryIndex(53, true, 45)).toBe(52);
    expect(transcriptEntryIndex(53, false, 45)).toBe(45);
    expect(transcriptEntryIndex(53, false, 80)).toBe(52);
    expect(transcriptEntryIndex(53, false, -1)).toBe(0);
    expect(transcriptEntryIndex(0, true, 0)).toBeUndefined();
  });

  it('recovers a settled nonempty recycler that reports no visible cells', () => {
    expect(shouldRecoverTranscriptBlankViewport(false, false, false, 120, false, 4_800, 720)).toBe(true);
    expect(shouldRecoverTranscriptBlankViewport(true, false, false, 120, false, 4_800, 720)).toBe(false);
    expect(shouldRecoverTranscriptBlankViewport(false, true, false, 120, false, 4_800, 720)).toBe(false);
    expect(shouldRecoverTranscriptBlankViewport(false, false, true, 120, false, 4_800, 720)).toBe(false);
    expect(shouldRecoverTranscriptBlankViewport(false, false, false, 0, false, 4_800, 720)).toBe(false);
    expect(shouldRecoverTranscriptBlankViewport(false, false, false, 120, true, 4_800, 720)).toBe(false);
    expect(shouldRecoverTranscriptBlankViewport(false, false, false, 120, false, 0, 720)).toBe(false);
    expect(shouldRecoverTranscriptBlankViewport(false, false, false, 120, false, 4_800, 0)).toBe(false);
  });

  it('rejects a mounted middle range as proof of a settled tail viewport', () => {
    expect(shouldRestoreTranscriptTailRange(true, false, 156, { first: 108, last: 119 })).toBe(true);
    expect(shouldRestoreTranscriptTailRange(true, false, 156, { first: 140, last: 155 })).toBe(false);
    expect(shouldRestoreTranscriptTailRange(false, false, 156, { first: 108, last: 119 })).toBe(false);
    expect(shouldRestoreTranscriptTailRange(true, true, 156, { first: 108, last: 119 })).toBe(false);
    expect(shouldRestoreTranscriptTailRange(true, false, 156, null)).toBe(false);
  });

  it('does not confuse a same-structure revision with an actually blank recycler', () => {
    const previousVisible = { first: 428, last: 464 };
    const invalidatedRange = transcriptVisibleRangeForRevision('tail-467', 'tail-468', previousVisible);

    expect(invalidatedRange).toBeNull();
    // The range indexes are revision-stale, but FlashList most recently proved
    // mounted cells. A content publication does not withdraw that native fact.
    expect(shouldRecoverTranscriptBlankViewport(
      false, false, false, 468, true, 12_413, 959,
    )).toBe(false);
  });

  it('bounds semantic recovery to the flattened source rows', () => {
    expect(boundedTranscriptRow(1_745, 5_000)).toBe(1_745);
    expect(boundedTranscriptRow(9_000, 5_000)).toBe(4_999);
    expect(boundedTranscriptRow(0, 0)).toBeNull();
  });

  it('does not postpone an already queued viewport writer under continuous frames', () => {
    expect(shouldScheduleTranscriptViewportFrame(null)).toBe(true);
    expect(shouldScheduleTranscriptViewportFrame(42)).toBe(false);
  });

  it('owns the measured native tail offset without asking the recycler to admit its changing final row', () => {
    // Exact optimized Release recurrence: FlashList accepted scrollToEnd for
    // this non-scrollable geometry, published offset 56, then immediately
    // entered off-content recovery because the true maximum offset is zero.
    expect(transcriptTailScrollOffset(316, 864)).toBeNull();
    expect(transcriptViewportIsOffContent(56, 316, 864)).toBe(true);
    expect(transcriptTailScrollOffset(865, 864)).toBe(1);
    expect(transcriptTailScrollOffset(316, 0)).toBeNull();
    expect(transcriptTailScrollOffset(0, 864)).toBeNull();
    // Post-OTA physical fatal: 417 rows, cursor 416 and native visibility only
    // through 415. The tail owner must use this direct offset rather than
    // FlashList's scrollToEnd -> scrollToIndex(416) branch.
    expect(transcriptTailScrollOffset(18_004, 959)).toBe(17_045);
  });

  it('does not let an unacknowledged tail write claim a later reader scroll', () => {
    expect(transcriptTailWriterOwnsScrollSample(1_600, 1_590, 32)).toBe(true);
    expect(transcriptTailWriterOwnsScrollSample(1_600, 600, 32)).toBe(false);
    expect(transcriptTailWriterOwnsScrollSample(null, 600, 32)).toBe(false);
  });

  it('rejects a queued scroll writer after the selected transcript dataset changes', () => {
    expect(shouldRunTranscriptViewportWriter('session-a', 'session-a')).toBe(true);
    expect(shouldRunTranscriptViewportWriter('session-a', 'session-b')).toBe(false);
  });

  it('coalesces post-layout recovery per dataset and rejects stale project work', () => {
    const recovery = nextTranscriptViewportPostLayoutWork(null, 'session-a', true);
    const combined = nextTranscriptViewportPostLayoutWork(recovery, 'session-a', false);
    expect(combined).toEqual({ datasetKey: 'session-a', recover: true });
    expect(shouldRunTranscriptViewportPostLayoutWork(combined, 'session-a')).toBe(true);
    expect(shouldRunTranscriptViewportPostLayoutWork(combined, 'session-b')).toBe(false);

    expect(nextTranscriptViewportPostLayoutWork(combined, 'session-b', false)).toEqual({
      datasetKey: 'session-b', recover: false,
    });
  });

});
