import { describe, expect, it } from 'vitest';
import { TRANSCRIPT_BOTTOM_INSET, TRANSCRIPT_HORIZONTAL_INSET, TRANSCRIPT_VERTICAL_INSET } from './transcriptPaneGeometry';

describe('transcript pane outer inset', () => {
  it('matches the prompt editor text-container rhythm', () => {
    expect(TRANSCRIPT_HORIZONTAL_INSET).toBe(9);
    expect(TRANSCRIPT_VERTICAL_INSET).toBe(5);
    expect(TRANSCRIPT_BOTTOM_INSET).toBe(24);
  });
});
