import { describe, expect, it } from 'vitest';
import { nextTranscriptReviewRestoreDecision, transcriptReviewTargetVisible } from './transcriptReviewRestore';

describe('transcript review restore', () => {
  it('requires the exact restored target to belong to the current visible generation', () => {
    expect(transcriptReviewTargetVisible(259, null)).toBe(false);
    expect(transcriptReviewTargetVisible(259, { first: 126, last: 150 })).toBe(false);
    expect(transcriptReviewTargetVisible(259, { first: 258, last: 263 })).toBe(true);
  });

  it('requires two settled observations before releasing viewport ownership', () => {
    const first = nextTranscriptReviewRestoreDecision({ writes: 1, confirmations: 0 }, 0.4505, 0.45);
    expect(first).toEqual({ action: 'confirm', state: { writes: 1, confirmations: 1 } });
    expect(nextTranscriptReviewRestoreDecision(first.state, 0.4507, 0.45)).toEqual({
      action: 'complete',
      state: { writes: 1, confirmations: 2 },
    });
  });

  it('corrects measured-layout drift but bounds the native writes', () => {
    expect(nextTranscriptReviewRestoreDecision({ writes: 1, confirmations: 1 }, 0.08, 0.45)).toEqual({
      action: 'correct',
      state: { writes: 2, confirmations: 0 },
    });
    expect(nextTranscriptReviewRestoreDecision({ writes: 4, confirmations: 0 }, 0.08, 0.45)).toEqual({
      action: 'exhaust',
      state: { writes: 4, confirmations: 0 },
    });
  });

  it('does not accept a visibly shifted review row as settled', () => {
    expect(nextTranscriptReviewRestoreDecision({ writes: 1, confirmations: 0 }, 0.50, 0.45)).toEqual({
      action: 'correct',
      state: { writes: 2, confirmations: 0 },
    });
  });

  it('waits without consuming the bound until layout exists', () => {
    const state = { writes: 1, confirmations: 0 };
    expect(nextTranscriptReviewRestoreDecision(state, null, 0.45)).toEqual({ action: 'wait', state });
  });

  it('does not release the exact anchor while the recycler prepend correction is still settling', () => {
    const state = { writes: 1, confirmations: 0, settleUntil: 250 };

    expect(nextTranscriptReviewRestoreDecision(state, 0.45, 0.45, undefined, undefined, 120)).toEqual({
      action: 'wait',
      state,
    });
    expect(nextTranscriptReviewRestoreDecision(state, 0.45, 0.45, undefined, undefined, 250)).toEqual({
      action: 'confirm',
      state: { ...state, confirmations: 1 },
    });
  });
});
