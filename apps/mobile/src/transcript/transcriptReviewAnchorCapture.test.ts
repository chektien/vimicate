import { describe, expect, it, vi } from 'vitest';
import { captureTranscriptReviewAnchor } from './transcriptReviewAnchorCapture';

describe('synchronous transcript review anchor capture', () => {
  it('uses the current measured range on every capture', () => {
    const computeVisibleIndices = vi.fn().mockReturnValueOnce({ startIndex: 30, endIndex: 49 })
      .mockReturnValueOnce({ startIndex: 51, endIndex: 70 });
    const position = vi.fn(() => 0.45);
    expect(captureTranscriptReviewAnchor({ computeVisibleIndices }, 100, 99, position)).toEqual({ row: 39, viewPosition: 0.45 });
    expect(captureTranscriptReviewAnchor({ computeVisibleIndices }, 100, 99, position)).toEqual({ row: 60, viewPosition: 0.45 });
    expect(position.mock.calls).toEqual([[39], [60]]);
  });

  it('retains an actually visible keyboard cursor', () => {
    const list = { computeVisibleIndices: () => ({ startIndex: 30, endIndex: 49 }) };
    expect(captureTranscriptReviewAnchor(list, 100, 35, () => 0.2)).toEqual({ row: 35, viewPosition: 0.2 });
  });

  it('retains the entire visible span for forward window trimming, not only its bottom cursor', () => {
    const list = { computeVisibleIndices: () => ({ startIndex: 30, endIndex: 49 }) };
    expect(captureTranscriptReviewAnchor(list, 100, 49, () => 0, 'start')).toEqual({ row: 30, viewPosition: 0 });
  });

  it('does not invent an anchor without initialized geometry', () => {
    const position = vi.fn(() => 0.5);
    expect(captureTranscriptReviewAnchor(null, 100, 99, position)).toBeNull();
    expect(captureTranscriptReviewAnchor({ computeVisibleIndices: () => { throw new Error('layout not initialized'); } }, 100, 99, position)).toBeNull();
    expect(position).not.toHaveBeenCalled();
  });

  it.each([
    { startIndex: -1, endIndex: -1 }, { startIndex: 1, endIndex: 0 },
    { startIndex: 99, endIndex: 100 }, { startIndex: 1.5, endIndex: 4 },
    { startIndex: NaN, endIndex: 4 }, { startIndex: 0, endIndex: Infinity },
  ])('rejects unmeasured or out-of-bounds indices %o', range => {
    const position = vi.fn(() => 0.5);
    expect(captureTranscriptReviewAnchor({ computeVisibleIndices: () => range }, 100, 99, position)).toBeNull();
    expect(position).not.toHaveBeenCalled();
  });

  it.each([null, NaN, Infinity])('requires a measured finite position: %s', position => {
    expect(captureTranscriptReviewAnchor({ computeVisibleIndices: () => ({ startIndex: 0, endIndex: 0 }) }, 1, 0, () => position)).toBeNull();
  });
});
