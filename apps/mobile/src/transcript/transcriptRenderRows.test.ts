import { describe, expect, it } from 'vitest';
import { buildTranscriptRenderRows } from './transcriptRenderRows';

describe('transcript render rows', () => {
  it('flattens message lines into stable source-coordinate items', () => {
    const rows = buildTranscriptRenderRows([
      { id: 'answer', role: 'assistant', text: '# Head\nbody' },
      { id: 'tool', role: 'tool', text: 'one\ntwo\nthree' },
    ]);
    expect(rows.map((row) => [row.key, row.sourceRow, row.compiled.kind])).toEqual([
      ['answer:0', 0, 'heading'], ['answer:1', 1, 'paragraph'], ['tool:0', 2, 'paragraph'],
      ['tool:1', 3, 'paragraph'], ['tool:2', 4, 'paragraph'],
    ]);
    expect(rows[2]).toMatchObject({ firstInMessage: true, lastInMessage: false, groupPosition: 'standalone' });
  });

  it('does not create a single giant virtualized item for long machine output', () => {
    const text = Array.from({ length: 5_000 }, (_, index) => `line ${index + 1}`).join('\n');
    const rows = buildTranscriptRenderRows([{ id: 'large', role: 'tool', text }]);
    expect(rows).toHaveLength(5_000);
    expect(rows[4_999]).toMatchObject({ key: 'large:4999', sourceRow: 4_999, lastInMessage: true });
  });
});
