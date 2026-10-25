import { describe, expect, it } from 'vitest';
import { transcriptFocusMetrics } from './transcriptFocusMetrics';

describe('transcript focus metrics', () => {
  it('keeps pane and timestamp measurements identical across focus transfer', () => {
    expect(transcriptFocusMetrics(1, false)).toEqual(transcriptFocusMetrics(1, true));
    expect(transcriptFocusMetrics(1.2, false)).toEqual(transcriptFocusMetrics(1.2, true));
  });

  it('scales the reserved timestamp column with the pane font', () => {
    expect(transcriptFocusMetrics(1, false).timestampWidth).toBe(92);
    expect(transcriptFocusMetrics(1.2, true).timestampWidth).toBeCloseTo(110.4);
  });
});
