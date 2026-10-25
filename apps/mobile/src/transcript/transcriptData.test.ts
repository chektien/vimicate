import { describe, expect, it } from 'vitest';
import { findTranscriptMatches, generateTranscript } from './transcriptData';

describe('transcript fixtures', () => {
  it('produces stable unique identities', () => {
    const rows = generateTranscript(5000, 7);
    expect(new Set(rows.map((row) => row.id)).size).toBe(5000);
    expect(rows[4999]?.ordinal).toBe(4999);
  });
  it('returns semantic search targets', () => {
    expect(findTranscriptMatches(generateTranscript(100), 'viewport').length).toBeGreaterThan(0);
  });
});
