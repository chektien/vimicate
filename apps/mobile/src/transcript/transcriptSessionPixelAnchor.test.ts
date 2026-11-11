import { describe, expect, it } from 'vitest';
import { captureTranscriptSessionPixelAnchor, transcriptSessionPixelRestoreOffset } from './transcriptSessionPixelAnchor';

describe('session viewport pixel anchors', () => {
  const capture = (offset: number, heights: number[], header = 0) => captureTranscriptSessionPixelAnchor({
    getLayout: (index: number) => ({ y: heights.slice(0, index).reduce((a, b) => a + b, 0), height: heights[index]! }),
    getFirstItemOffset: () => header,
  }, heights.length, offset);
  it('distinguishes parked positions inside an oversized question card', () => {
    expect(capture(175, [100, 1_000, 100])).toEqual({ row: 1, rowOffset: 75 });
    expect(capture(725, [100, 1_000, 100])).toEqual({ row: 1, rowOffset: 625 });
  });
  it('preserves partially clipped rows and header-relative fractional offsets', () => {
    expect(capture(90.5, [20, 20, 20, 20, 20, 20], 20)).toEqual({ row: 3, rowOffset: 10.5 });
    expect(capture(0, [20, 20], 35)).toEqual({ row: 0, rowOffset: -35 });
  });
  it('bounds the pixel anchor by the current row and content after an editor shrinks', () => {
    expect(transcriptSessionPixelRestoreOffset({ y: 800, height: 300 }, 625, 400, 2_000, 0)).toBe(1_099);
    expect(transcriptSessionPixelRestoreOffset({ y: 800, height: 1_000 }, 625, 400, 1_500, 0)).toBe(1_100);
    expect(transcriptSessionPixelRestoreOffset({ y: 0, height: 20 }, -35, 400, 500, 35)).toBe(0);
  });
  it('does not invent a pixel anchor before layout admission', () => {
    expect(captureTranscriptSessionPixelAnchor(null, 20, 100)).toBeNull();
    expect(captureTranscriptSessionPixelAnchor({ getLayout: () => undefined, getFirstItemOffset: () => 0 }, 20, 100)).toBeNull();
    expect(capture(NaN, [20])).toBeNull();
  });
});
