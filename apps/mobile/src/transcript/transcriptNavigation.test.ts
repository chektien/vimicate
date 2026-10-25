import { describe, expect, it } from 'vitest';
import { boundedTranscriptIndex } from './transcriptNavigation';

describe('transcript navigation boundary', () => {
  it('never issues a list index for an empty transcript', () => {
    expect(boundedTranscriptIndex(0, 0)).toBeNull();
    expect(boundedTranscriptIndex(100, 0)).toBeNull();
  });

  it('clamps populated transcript destinations to materialized indices', () => {
    expect(boundedTranscriptIndex(-10, 3)).toBe(0);
    expect(boundedTranscriptIndex(1, 3)).toBe(1);
    expect(boundedTranscriptIndex(99, 3)).toBe(2);
  });
});
