import { describe, expect, it, vi } from 'vitest';
import { nextTranscriptSearchCursor, visitTranscriptMessageSearchMatches } from './transcriptMessageSearch';

import { createTranscriptBuffer } from './transcriptBuffer';

describe('sparse transcript message search', () => {
  it('does not compile every hidden plain-text line when an absent pattern is searched', () => {
    const text = Array.from({ length: 20_000 }, (_, index) => `plain tool output ${index}`).join('\n');
    const renderedRanges = vi.fn(() => []);
    let matches = 0;

    visitTranscriptMessageSearchMatches(
      text,
      'pattern that is absent',
      () => { matches += 1; },
      renderedRanges,
    );

    expect(matches).toBe(0);
    expect(renderedRanges).not.toHaveBeenCalled();
  });

  it('retains literal hidden coordinates and rendered Markdown fallback', () => {
    const literal: Array<[number, number]> = [];
    visitTranscriptMessageSearchMatches(
      'first\nhidden target\nlast',
      'target',
      (line, column) => literal.push([line, column]),
    );
    expect(literal).toEqual([[1, 7]]);

    const rendered: Array<[number, number]> = [];
    visitTranscriptMessageSearchMatches(
      'before\nUpdated [standup.md](</tmp/standup.md>) after',
      'updated standup.md',
      (line, column) => rendered.push([line, column]),
    );
    expect(rendered).toEqual([[1, 0]]);
  });
});


describe('reader-facing transcript search', () => {
  it('skips tool arguments and results in both directions regardless of fold projection', () => {
    const buffer = createTranscriptBuffer([
      { id: 'preamble', role: 'narration', text: 'needle preamble' },
      { id: 'tool', role: 'tool', text: 'Bash\n{ "command": "needle" }\nneedle result' },
      { id: 'response', role: 'assistant', text: 'needle response' },
    ]);
    for (const navigationRows of [undefined, [0, 1, 4], [0, 1, 2, 3, 4]]) {
      expect(nextTranscriptSearchCursor(buffer, 'needle', { row: 0, column: 0 }, 1, navigationRows)).toEqual({ row: 4, column: 0 });
      expect(nextTranscriptSearchCursor(buffer, 'needle', { row: 4, column: 0 }, -1, navigationRows)).toEqual({ row: 0, column: 0 });
    }
    expect(nextTranscriptSearchCursor(buffer, 'command', { row: 0, column: 0 }, 1)).toBeNull();
    const { messages: _messages, ...legacyBuffer } = buffer;
    expect(nextTranscriptSearchCursor(legacyBuffer, 'command', { row: 0, column: 0 }, 1)).toBeNull();
  });
  it('keeps user text, colon responses and braces in ordinary responses searchable', () => {
    const buffer = createTranscriptBuffer([
      { id: 'u', role: 'user', text: 'needle question' },
      { id: 'c', role: 'command', text: 'needle status' },
      { id: 'a', role: 'assistant', text: '{ "needle": "answer" }' },
    ]);
    expect(nextTranscriptSearchCursor(buffer, 'needle', { row: 0, column: 0 }, 1)).toEqual({ row: 1, column: 0 });
    expect(nextTranscriptSearchCursor(buffer, 'needle', { row: 1, column: 0 }, 1)).toEqual({ row: 2, column: 3 });
  });
});
