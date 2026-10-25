import { describe, expect, it } from 'vitest';
import { transcriptBoundedIndexedViewPosition, authoritativeTranscriptScrollOffset, authoritativeTranscriptViewportHeight, capturedTranscriptScrollOffset, capturedTranscriptViewPosition, transcriptIndexedCursorCenterY, transcriptIndexedRevealAcknowledged, transcriptIndexedRevealOffset, transcriptIndexedViewPosition, transcriptIndexedViewPositionForCursorCenter } from './transcriptIndexedReveal';

describe('transcript indexed reveal', () => {
  it('derives the final recycler offset without an asynchronous index correction sequence', () => {
    expect(transcriptIndexedRevealOffset({ y: 1_000, height: 20 }, 500, 2_000, 24, 0.5)).toBe(784);
  });

  it('clamps the first and last target inside mounted content', () => {
    expect(transcriptIndexedRevealOffset({ y: 0, height: 20 }, 500, 2_000, 24, 0.22)).toBe(0);
    expect(transcriptIndexedRevealOffset({ y: 1_980, height: 20 }, 500, 2_000, 24, 0.78)).toBe(1_500);
  });

  it('keeps a taller-than-viewport row bounded while revealing its directional interior', () => {
    expect(transcriptIndexedRevealOffset({ y: 700, height: 900 }, 500, 2_000, 24, 0.78)).toBe(1_036);
  });

  it('round-trips the row position already owned by the reader', () => {
    const layout = { y: 1_000, height: 20 };
    const offset = transcriptIndexedRevealOffset(layout, 500, 2_000, 24, 0.5);
    expect(transcriptIndexedViewPosition(layout, 500, offset, 24)).toBe(0.5);
  });

  it('translates a physical cursor center across different row heights', () => {
    const cursorCenterY = transcriptIndexedCursorCenterY({ y: 660, height: 20 }, 600, 0);
    const targetPosition = transcriptIndexedViewPositionForCursorCenter({ y: 640, height: 34 }, 400, cursorCenterY);
    const targetOffset = transcriptIndexedRevealOffset({ y: 640, height: 34 }, 400, 2_000, 0, targetPosition);

    expect(cursorCenterY).toBe(70);
    expect(targetOffset).toBe(587);
  });

  it('captures the synchronous native offset after a programmatic jump even when React scroll state lags', () => {
    expect(authoritativeTranscriptScrollOffset(640, 500)).toBe(640);
    expect(authoritativeTranscriptScrollOffset(640, 500, true)).toBe(500);
    expect(authoritativeTranscriptScrollOffset(Number.NaN, 500)).toBe(500);
  });

  it('uses the mounted native offset for an immediate project-switch capture', () => {
    expect(capturedTranscriptScrollOffset(740, 420)).toBe(740);
    expect(capturedTranscriptScrollOffset(Number.NaN, 420)).toBe(420);
  });

  it('captures with the mounted recycler height while the React layout mirror is still zero', () => {
    expect(authoritativeTranscriptViewportHeight(520, 0)).toBe(520);
    expect(authoritativeTranscriptViewportHeight(0, 480)).toBe(480);
  });

  it('keeps an issued native reveal authoritative until its matching scroll event is observed', () => {
    expect(capturedTranscriptViewPosition({ target: 4, viewPosition: 0.05 }, 4, 0.45)).toBe(0.05);
    expect(capturedTranscriptViewPosition({ target: 4, viewPosition: 0.05 }, 4, null)).toBe(0.05);
    expect(capturedTranscriptViewPosition({ target: 3, viewPosition: 0.22 }, 4, 0.78)).toBe(0.78);
    expect(transcriptIndexedRevealAcknowledged(640, 639.5)).toBe(true);
    expect(transcriptIndexedRevealAcknowledged(640, 500)).toBe(false);
  });

  it('retains the reader-owned vertical position when older rows are prepended', () => {
    const viewportHeight = 500;
    const beforeLayout = { y: 1_000, height: 20 };
    const beforeOffset = transcriptIndexedRevealOffset(beforeLayout, viewportHeight, 2_000, 24, 0.63);
    const captured = transcriptIndexedViewPosition(beforeLayout, viewportHeight, beforeOffset, 24);
    const afterLayout = { y: 1_640, height: 20 };
    const afterOffset = transcriptIndexedRevealOffset(afterLayout, viewportHeight, 2_640, 24, captured);

    expect(captured).toBeCloseTo(0.63);
    expect(transcriptIndexedViewPosition(afterLayout, viewportHeight, afterOffset, 24)).toBeCloseTo(captured);
    expect(afterOffset - beforeOffset).toBeCloseTo(640);
  });

  it('bounds partially visible rows and oversized rows', () => {
    expect(transcriptIndexedViewPosition({ y: 100, height: 20 }, 500, 500, 0)).toBe(0);
    expect(transcriptIndexedViewPosition({ y: 1_000, height: 20 }, 500, 0, 0)).toBe(1);
    expect(transcriptIndexedViewPosition({ y: 0, height: 700 }, 500, 0, 0)).toBe(0.5);
  });
});

it('preserves an explicit source-leading-edge restore without changing ordinary oversized centering', () => {
  const layout = { y: 800, height: 1000 };
  expect(transcriptBoundedIndexedViewPosition(layout, 400, 2000, 0, 0)).toBe(0);
  expect(transcriptBoundedIndexedViewPosition(layout, 400, 2000, 0, 0.22)).toBe(0.5);
  expect(transcriptBoundedIndexedViewPosition(layout, 400, 2000, 0, 0.78)).toBe(0.5);
});
