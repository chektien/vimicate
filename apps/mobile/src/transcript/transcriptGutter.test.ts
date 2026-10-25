import { describe, expect, it } from 'vitest';
import { createTranscriptBuffer } from './transcriptVim';
import { transcriptGutterLabel } from './transcriptGutter';
import { buildVisibleTranscriptRenderRows, transcriptNavigationSourceRows } from './transcriptVisibleRows';
// @ts-expect-error Vitest's Node runtime provides this test-only module.
import { readFileSync } from 'node:fs';

describe('transcript gutter coordinate', () => {
  it('uses one flattened source-row coordinate across message boundaries', () => {
    const buffer = createTranscriptBuffer([
      { id: 'one', role: 'assistant', text: 'a\nb\nc' },
      { id: 'two', role: 'user', text: 'd\ne' },
      { id: 'three', role: 'assistant', text: 'f\ng\nh' },
    ]);
    const cursorRow = buffer.lines.findIndex((line) => line.messageId === 'two' && line.lineInMessage === 1);
    expect(cursorRow).toBe(4);
    expect(buffer.lines.map((line, row) => [line.messageId, transcriptGutterLabel(row, cursorRow)])).toEqual([
      ['one', '4'], ['one', '3'], ['one', '2'], ['two', '1'], ['two', '0'], ['three', '1'], ['three', '2'], ['three', '3'],
    ]);
  });

  it('counts source rows rather than physical wrapping width', () => {
    const long = 'wrapped '.repeat(80).trim();
    const buffer = createTranscriptBuffer([{ id: 'long', role: 'assistant', text: `${long}\nshort` }]);
    expect(buffer.lines).toHaveLength(2);
    expect(transcriptGutterLabel(0, 1)).toBe('1');
    expect(transcriptGutterLabel(1, 1)).toBe('0');
  });

  it('numbers visible folded rows by the same navigation stops used by j and k', () => {
    const rows = buildVisibleTranscriptRenderRows([
      { id: 'prompt', role: 'user', text: 'alpha\n\nbeta' },
      { id: 'tool', role: 'tool', text: 'bash\nraw one\nraw two\nraw three', tool: { name: 'bash', summary: 'bash · inspect' } },
      { id: 'answer', role: 'assistant', text: 'gamma\ndelta' },
    ], new Set());
    const sourceRows = transcriptNavigationSourceRows(rows);

    expect(sourceRows).toEqual([0, 2, 3, 7, 8]);
    expect(rows[2]).toMatchObject({
      sourceRow: 3,
      lastSourceRowInMessage: 6,
      fold: { expanded: false, hiddenLineCount: 3 },
    });
    const cursorNavigationIndex = sourceRows.indexOf(7);
    expect(sourceRows.map((sourceRow, sourceNavigationIndex) => transcriptGutterLabel(sourceRow, 7, sourceNavigationIndex, cursorNavigationIndex))).toEqual(['3', '2', '1', '0', '1']);
  });

  it('keeps one relative scale at a deep current row and across folded navigation gaps', () => {
    const sourceRows = [3_356, 3_358, 3_359, 3_360, 3_363, 3_367];
    const cursorNavigationIndex = sourceRows.length - 1;
    expect(sourceRows.map((sourceRow, sourceNavigationIndex) => transcriptGutterLabel(sourceRow, 3_367, sourceNavigationIndex, cursorNavigationIndex))).toEqual([
      '5', '4', '3', '2', '1', '0',
    ]);
  });

  it('passes recycler-stable navigation indices explicitly into every row', () => {
    const pane = readFileSync(new URL('./TranscriptPane.tsx', import.meta.url), 'utf8');
    const row = readFileSync(new URL('./TranscriptSourceRow.tsx', import.meta.url), 'utf8');
    expect(pane).toContain('sourceNavigationIndex={index}');
    expect(pane).toContain('cursorNavigationIndex={cursorNavigationIndex}');
    expect(row).toContain('transcriptGutterLabel(row.sourceRow, navigation.cursor.row, sourceNavigationIndex, cursorNavigationIndex)');
    expect(row).toContain('gutter ${gutterLabel}');
    expect(row).not.toContain('TranscriptGutterCursorProvider');
  });
});
