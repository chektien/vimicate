import { describe, expect, it } from 'vitest';
import type { HardwareKeyEvent } from '../../modules/vimicate-editor';
import { buildVisibleTranscriptRenderRows } from './transcriptVisibleRows';
import { transcriptLinkAtVisibleSourceCursor } from './transcriptRenderedCursor';
import { applyTranscriptSearch, createTranscriptBuffer, createTranscriptVimState, handleTranscriptKey, repeatTranscriptSearch, transcriptSearchRanges } from './transcriptVim';
import { visitTranscriptMessageSearchMatches } from './transcriptMessageSearch';

const source = 'I checked the live [guide](https://example.test/guide). Its findings are covered.';
const messages = [{ id: 'answer', role: 'assistant' as const, text: source }];
const buffer = createTranscriptBuffer(messages);
const rows = buildVisibleTranscriptRenderRows(messages, new Set());
const key = (value: string): HardwareKeyEvent => ({ key: value, shift: false, control: false, option: false, command: false });

describe('search and horizontal movement through rendered links', () => {
  it('backward search and n stop on the visible label, never its hidden destination', () => {
    const initial = { ...createTranscriptVimState(buffer), cursor: { row: 0, column: source.length } };
    const found = applyTranscriptSearch(buffer, initial, 'guide', -1).state;
    expect(found.cursor.column).toBe(source.indexOf('guide'));
    expect(repeatTranscriptSearch(buffer, found).state.cursor).toEqual(found.cursor);
    expect(transcriptLinkAtVisibleSourceCursor(rows, 0, found.cursor.column))
      .toEqual({ kind: 'web', url: 'https://example.test/guide' });
    expect(transcriptSearchRanges(source, 'guide')).toEqual([{ start: 20, end: 24 }]);
    expect(transcriptSearchRanges(source, 'example.test')).toEqual([]);
  });

  it('finds visible phrases even when another raw occurrence exists on the same row', () => {
    const matches: number[] = [];
    visitTranscriptMessageSearchMatches('live [guide](https://example.test/guide), live guide', 'live guide',
      (_row, column) => matches.push(column));
    expect(matches.sort((a, b) => a - b)).toEqual([0, 42]);
  });

  it('moves h and l by visible glyphs around a link and recovers from a hidden URL cursor', () => {
    const lineAt = (row: number) => rows.find((item) => item.sourceRow === row)?.compiled;
    let state = { ...createTranscriptVimState(buffer), cursor: { row: 0, column: source.indexOf(').') + 1 } };
    state = handleTranscriptKey(buffer, state, key('h'), [0], lineAt).state;
    expect(state.cursor.column).toBe(source.indexOf('guide') + 4);
    expect(transcriptLinkAtVisibleSourceCursor(rows, 0, state.cursor.column)?.kind).toBe('web');
    state = handleTranscriptKey(buffer, state, key('l'), [0], lineAt).state;
    expect(source[state.cursor.column]).toBe('.');
    const hidden = { ...state, cursor: { row: 0, column: source.lastIndexOf('guide') } };
    expect(handleTranscriptKey(buffer, hidden, key('h'), [0], lineAt).state.cursor.column).toBe(source.indexOf('guide') + 4);
    expect(source[handleTranscriptKey(buffer, hidden, key('l'), [0], lineAt).state.cursor.column]).toBe(' ');
  });
  it('crosses visible-row boundaries and keeps character selection in source coordinates', () => {
    const input = [
      { id: 'first', role: 'assistant' as const, text: '**A** [go](https://example.test/go)' },
      { id: 'last', role: 'assistant' as const, text: '[next](https://example.test/next)' },
    ];
    const text = createTranscriptBuffer(input);
    const painted = buildVisibleTranscriptRenderRows(input, new Set());
    const lineAt = (row: number) => painted.find((item) => item.sourceRow === row)?.compiled;
    let state = { ...createTranscriptVimState(text), cursor: { row: 0, column: 2 } };
    state = handleTranscriptKey(text, state, key('h'), [0, 1], lineAt).state;
    expect(state.cursor).toEqual({ row: 0, column: 2 });
    state = handleTranscriptKey(text, state, key('v'), [0, 1], lineAt).state;
    state = handleTranscriptKey(text, state, key('4'), [0, 1], lineAt).state;
    state = handleTranscriptKey(text, state, key('l'), [0, 1], lineAt).state;
    expect(state.anchor).toEqual({ row: 0, column: 2 });
    expect(state.cursor).toEqual({ row: 1, column: 1 });
    state = handleTranscriptKey(text, state, key('h'), [0, 1], lineAt).state;
    expect(state.cursor).toEqual({ row: 0, column: input[0]!.text.indexOf('go') + 1 });
  });

  it.each([
    ['```html\n<br> **bold**\n```', '<br>', 0],
    ['```md\n# heading **bold**\n```', '# heading', 0],
  ])('searches contextual fenced glyphs in %s', (text, query, column) => {
    const matches: [number, number][] = [];
    visitTranscriptMessageSearchMatches(text, query, (row, col) => matches.push([row, col]));
    expect(matches).toEqual([[1, column]]);
  });

  it('crosses synthetic tool summaries without trapping the cursor in their generated text', () => {
    const input = [
      { id: 'tool', role: 'tool' as const, text: 'x\nlong long long result' },
      { id: 'answer', role: 'assistant' as const, text: '[go](https://example.test/go)' },
    ];
    const text = createTranscriptBuffer(input);
    const painted = buildVisibleTranscriptRenderRows(input, new Set());
    const lineAt = (row: number) => painted.find((item) => item.sourceRow === row)?.compiled;
    let state = { ...createTranscriptVimState(text), cursor: { row: 0, column: 0 } };
    state = handleTranscriptKey(text, state, key('l'), [0, 2], lineAt).state;
    expect(state.cursor.row).toBe(2);
    state = handleTranscriptKey(text, state, key('h'), [0, 2], lineAt).state;
    expect(state.cursor).toEqual({ row: 0, column: 0 });
  });

  it.each(['😀', 'İ'])('maps visible search after %s to original UTF-16 source coordinates', (prefix) => {
    const text = `${prefix} [guide](https://example.test/guide)`;
    const ranges = transcriptSearchRanges(text, 'guide');
    expect(ranges).toEqual([{ start: text.indexOf('guide'), end: text.indexOf('guide') + 4 }]);
    expect(transcriptSearchRanges(`${prefix} guide`, 'guide')).toEqual([{ start: prefix.length + 1, end: prefix.length + 5 }]);
  });

  it('preserves visible block-like prefixes in non-conversation rows', () => {
    const text = '# heading **bold**';
    const matches: [number, number][] = [];
    visitTranscriptMessageSearchMatches(text, '# heading', (row, col) => matches.push([row, col]), undefined, undefined, false);
    expect(matches).toEqual([[0, 0]]);
  });

});
