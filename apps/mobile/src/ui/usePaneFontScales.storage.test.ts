import { describe, expect, it } from 'vitest';
import { PANE_FONT_SCALES_KEY } from './paneFontScaleStorage';

describe('pane font scale persistence generation', () => {
  it('does not restore the pre-layout-fix pinch-harness values', () => {
    expect(PANE_FONT_SCALES_KEY).toBe('ui.paneFontScales.v2');
  });
});
