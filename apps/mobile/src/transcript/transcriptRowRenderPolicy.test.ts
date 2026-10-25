import { describe, expect, it } from 'vitest';
import type { WorkspaceMessage } from '../workspace/workspaceTypes';
import { buildTranscriptRenderRows } from './transcriptRenderRows';
import { transcriptMarkdownLineNavigationChanged, transcriptSourceRowNavigationChanged } from './transcriptRowRenderPolicy';
import { createTranscriptBuffer, createTranscriptVimState } from './transcriptVim';

describe('transcript row render policy', () => {
  it('repaints only the old and new cursor rows during a held motion within one message', () => {
    const message: WorkspaceMessage = { id: 'long', role: 'assistant', text: Array.from({ length: 100 }, (_, index) => `line ${index}`).join('\n') };
    const rows = buildTranscriptRenderRows([message]);
    const before = { ...createTranscriptVimState(createTranscriptBuffer([message])), cursor: { row: 48, column: 0 } };
    const after = { ...before, cursor: { row: 49, column: 0 } };
    const changed = rows.filter((row) => transcriptSourceRowNavigationChanged(row, before, after, true, true)).map((row) => row.sourceRow);
    expect(changed).toEqual([48, 49]);
  });

  it('also refreshes first rows whose focused-message timestamp treatment changes', () => {
    const messages: WorkspaceMessage[] = [
      { id: 'one', role: 'assistant', text: 'one\ntwo', timestamp: '2026-08-26T00:00:00Z' },
      { id: 'two', role: 'assistant', text: 'three\nfour', timestamp: '2026-08-26T00:01:00Z' },
    ];
    const rows = buildTranscriptRenderRows(messages);
    const base = createTranscriptVimState(createTranscriptBuffer(messages));
    const before = { ...base, cursor: { row: 1, column: 0 } };
    const after = { ...base, cursor: { row: 2, column: 0 } };
    const changed = rows.filter((row) => transcriptSourceRowNavigationChanged(row, before, after, true, true)).map((row) => row.sourceRow);
    expect(changed).toEqual([0, 1, 2]);
  });

  it('keeps expensive Markdown bodies stable while a boundary step refreshes relative gutters', () => {
    const messages: WorkspaceMessage[] = [
      { id: 'one', role: 'assistant', text: Array.from({ length: 80 }, (_, index) => `first ${index}`).join('\n'), timestamp: '2026-08-26T00:00:00Z' },
      { id: 'two', role: 'assistant', text: Array.from({ length: 80 }, (_, index) => `second ${index}`).join('\n'), timestamp: '2026-08-26T00:01:00Z' },
    ];
    const rows = buildTranscriptRenderRows(messages);
    const base = createTranscriptVimState(createTranscriptBuffer(messages));
    const before = { ...base, cursor: { row: 79, column: 0 } };
    const after = { ...base, cursor: { row: 80, column: 0 } };
    const bodyChanges = rows.filter((row) => transcriptMarkdownLineNavigationChanged(
      row.compiled.source,
      row.sourceRow,
      before,
      after,
      true,
      true,
    )).map((row) => row.sourceRow);

    expect(bodyChanges).toEqual([79, 80]);
  });

  it('repaints search glyphs only on rows whose visible match ranges changed', () => {
    const message: WorkspaceMessage = { id: 'search-local', role: 'assistant', text: 'alpha\nbeta\ngamma' };
    const rows = buildTranscriptRenderRows([message]);
    const before = createTranscriptVimState(createTranscriptBuffer([message]));
    const after = { ...before, searchQuery: 'beta' };
    const bodyChanges = rows.filter((row) => transcriptMarkdownLineNavigationChanged(
      row.compiled.source,
      row.sourceRow,
      before,
      after,
      true,
      true,
    )).map((row) => row.sourceRow);

    expect(bodyChanges).toEqual([1]);
  });

  it('refreshes every row when the search highlight query changes', () => {
    const message: WorkspaceMessage = { id: 'search', role: 'assistant', text: 'alpha\nbeta' };
    const rows = buildTranscriptRenderRows([message]);
    const before = createTranscriptVimState(createTranscriptBuffer([message]));
    const after = { ...before, searchQuery: 'a' };
    expect(rows.every((row) => transcriptSourceRowNavigationChanged(row, before, after, true, true))).toBe(true);
  });
});
