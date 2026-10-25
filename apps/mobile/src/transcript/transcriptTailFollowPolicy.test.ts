import { describe, expect, it } from 'vitest';
import { shouldCancelTranscriptTailWriter, shouldScrollTranscriptTailReveal, transcriptDragWillMomentum, transcriptMomentumBelongsToUser, transcriptTailFollowAfterScroll, transcriptTailFollowForReveal, transcriptTailFollowOnDragBegin } from './transcriptTailFollowPolicy';

describe('transcript tail-follow ownership', () => {
  it('keeps tail ownership when streaming content growth produces a programmatic scroll event', () => {
    expect(transcriptTailFollowAfterScroll(true, false, 240, 32)).toBe(true);
  });

  it('lets deliberate touch review suspend following without opting back in from bottom geometry', () => {
    expect(transcriptTailFollowOnDragBegin()).toBe(false);
    expect(transcriptTailFollowAfterScroll(true, true, 240, 32)).toBe(false);
    expect(transcriptTailFollowAfterScroll(false, true, 8, 32)).toBe(false);
  });

  it('uses explicit review/tail ownership instead of guessing from the final two cursor rows', () => {
    expect(transcriptTailFollowForReveal(true, 'review')).toBe(false);
    expect(transcriptTailFollowForReveal(false, 'review')).toBe(false);
    expect(transcriptTailFollowForReveal(false, 'tail')).toBe(true);
    expect(transcriptTailFollowForReveal(true, 'preserve')).toBe(true);
    expect(transcriptTailFollowForReveal(false, 'preserve')).toBe(false);
  });

  it('retires an already queued tail writer when keyboard review takes ownership', () => {
    expect(shouldCancelTranscriptTailWriter('review', 42)).toBe(true);
    expect(shouldCancelTranscriptTailWriter('review', null)).toBe(false);
    expect(shouldCancelTranscriptTailWriter('tail', 42)).toBe(false);
    expect(shouldCancelTranscriptTailWriter('preserve', 42)).toBe(false);
  });

  it('does not scroll again while cursor motion stays inside the settled tail zone', () => {
    expect(shouldScrollTranscriptTailReveal(false, 18, { first: 10, last: 19 }, 0, 32)).toBe(false);
    expect(shouldScrollTranscriptTailReveal(false, 19, { first: 10, last: 19 }, 20, 32)).toBe(false);
    expect(shouldScrollTranscriptTailReveal(false, 19, { first: 10, last: 18 }, 0, 32)).toBe(true);
    expect(shouldScrollTranscriptTailReveal(false, 19, { first: 10, last: 19 }, 120, 32)).toBe(true);
    expect(shouldScrollTranscriptTailReveal(true, 18, { first: 10, last: 19 }, 0, 32)).toBe(true);
  });

  it('does not mistake programmatic recycler momentum for a user review gesture', () => {
    expect(transcriptDragWillMomentum(undefined)).toBe(false);
    expect(transcriptDragWillMomentum(0)).toBe(false);
    expect(transcriptDragWillMomentum(-0.2)).toBe(true);
    expect(transcriptMomentumBelongsToUser(false)).toBe(false);
    expect(transcriptMomentumBelongsToUser(true)).toBe(true);
  });
});
