import { describe, expect, it } from 'vitest';
import { PANE_FONT_PINCH_STEP_RATIO, paneFontPinchStep } from './paneFontPinch';

describe('pane font pinch quantization', () => {
  it('does not resize for ordinary two-finger jitter', () => {
    expect(paneFontPinchStep(100, 108)).toBe(0);
    expect(paneFontPinchStep(100, 94)).toBe(0);
  });

  it('emits symmetric outward and inward steps', () => {
    expect(paneFontPinchStep(100, 100 * PANE_FONT_PINCH_STEP_RATIO)).toBe(1);
    expect(paneFontPinchStep(100, 100 / PANE_FONT_PINCH_STEP_RATIO)).toBe(-1);
    expect(paneFontPinchStep(100, 100 * PANE_FONT_PINCH_STEP_RATIO ** 3)).toBe(3);
    expect(paneFontPinchStep(100, 100 / PANE_FONT_PINCH_STEP_RATIO ** 2)).toBe(-2);
  });

  it('fails closed for incomplete touch geometry', () => {
    expect(paneFontPinchStep(0, 100)).toBe(0);
    expect(paneFontPinchStep(100, Number.NaN)).toBe(0);
  });
});
