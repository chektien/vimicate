import { describe, expect, it } from 'vitest';
import { type WorkspaceMessage } from '../workspace/workspaceTypes';
import { messagesFromPayload } from '../workspace/historyMessageProjection';
import { buildTranscriptRenderRows } from './transcriptRenderRows';
import { transcriptVisibleRangeForRevision } from './transcriptViewportPolicy';
import { createTranscriptBuffer, createTranscriptVimState, applyTranscriptSearch, selectedTranscriptText } from './transcriptVim';
import { transcriptGutterLabel } from './transcriptGutter';
import { buildVisibleTranscriptRenderRows, retainStableTranscriptRenderRows, transcriptNavigationSourceRows, transcriptRenderIndexForSourceRow, visibleTranscriptRenderRows } from './transcriptVisibleRows';

describe('transcript explicit folds', () => {
  const machine: WorkspaceMessage = { id: 'tool', role: 'tool', text: Array.from({ length: 5000 }, (_, index) => `output ${index}`).join('\n') };

  it('retains every unchanged row identity across a live tail append', () => {
    const stable: WorkspaceMessage[] = [
      { id: 'prompt', role: 'user', text: 'do it', timestamp: '1000' },
      { id: 'answer', role: 'assistant', text: 'done', timestamp: '2000' },
    ];
    const previous = buildVisibleTranscriptRenderRows(stable, new Set());
    const next = buildVisibleTranscriptRenderRows([
      ...stable,
      { id: 'live', role: 'narration', text: 'checking', timestamp: '3000', state: 'streaming' },
    ], new Set());
    const retained = retainStableTranscriptRenderRows(previous, next);

    expect(retained).toHaveLength(3);
    expect(retained[0]).toBe(previous[0]);
    expect(retained[1]).toBe(previous[1]);
    expect(retained[2]).toBe(next[2]);
  });

  it('retains unchanged interior rows when one live message grows', () => {
    const beforeMessage: WorkspaceMessage = {
      id: 'live-answer',
      role: 'assistant',
      text: Array.from({ length: 260 }, (_, index) => `line ${index}`).join('\n'),
      timestamp: '3000',
      state: 'streaming',
    };
    const afterMessage: WorkspaceMessage = {
      ...beforeMessage,
      text: `${beforeMessage.text}\nline 260\nline 261`,
    };
    const previous = buildVisibleTranscriptRenderRows([beforeMessage], new Set());
    const next = buildVisibleTranscriptRenderRows([afterMessage], new Set());
    const retained = retainStableTranscriptRenderRows(previous, next);

    expect(retained).toHaveLength(262);
    expect(retained[0]).not.toBe(previous[0]);
    expect(retained[1]).toBe(previous[1]);
    expect(retained[258]).toBe(previous[258]);
    expect(retained[259]).not.toBe(previous[259]);
    expect(retained[260]).toBe(next[260]);
    expect(retained[261]).toBe(next[261]);
  });

  it('invalidates every row when live message action metadata changes', () => {
    const beforeMessage: WorkspaceMessage = {
      id: 'recoverable-answer',
      role: 'assistant',
      text: 'first\nsecond\nthird',
      recovery: { sourceMessageId: 'source', state: 'available', detail: 'tap to load' },
    };
    const afterMessage: WorkspaceMessage = {
      ...beforeMessage,
      recovery: { ...beforeMessage.recovery!, state: 'loading' },
    };
    const previous = buildVisibleTranscriptRenderRows([beforeMessage], new Set());
    const next = buildVisibleTranscriptRenderRows([afterMessage], new Set());
    const retained = retainStableTranscriptRenderRows(previous, next);

    expect(retained.every((row, index) => row !== previous[index])).toBe(true);
  });

  it('advances the viewport revision for a same-height interior presentation change only once', () => {
    const before: WorkspaceMessage[] = [
      { id: 'prompt', role: 'user', text: 'inspect it' },
      { id: 'interior', role: 'assistant', text: 'same width', recovery: { sourceMessageId: 'source', state: 'available' } },
      { id: 'tail', role: 'assistant', text: 'unchanged tail' },
    ];
    const after: WorkspaceMessage[] = [
      before[0]!,
      { ...before[1]!, recovery: { sourceMessageId: 'source', state: 'loading' } },
      before[2]!,
    ];
    const previousRows = buildVisibleTranscriptRenderRows(before, new Set());
    const changedRows = retainStableTranscriptRenderRows(
      previousRows,
      buildVisibleTranscriptRenderRows(after, new Set()),
    );
    const visibleRange = { first: 0, last: 2 };

    expect(changedRows).toHaveLength(previousRows.length);
    expect(changedRows[0]).toBe(previousRows[0]);
    expect(changedRows[1]).not.toBe(previousRows[1]);
    expect(changedRows[2]).toBe(previousRows[2]);
    expect(transcriptVisibleRangeForRevision(previousRows, changedRows, visibleRange)).toBeNull();

    const stableRows = retainStableTranscriptRenderRows(
      changedRows,
      buildVisibleTranscriptRenderRows(after, new Set()),
    );
    expect(stableRows).toBe(changedRows);
    expect(transcriptVisibleRangeForRevision(changedRows, stableRows, visibleRange)).toBe(visibleRange);
  });

  it('does not materialize raw rows for a very large folded tool result', () => {
    const text = Array.from({ length: 20_000 }, (_, index) => `raw ${index}`).join('\n');
    const rows = buildVisibleTranscriptRenderRows([{ id: 'huge', role: 'tool', text, tool: { name: 'bash', summary: 'bash · inspect history' } }], new Set());
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ sourceRow: 0, lastSourceRowInMessage: 19_999, fold: { expanded: false, hiddenLineCount: 19_999 } });
    expect(rows[0]?.compiled.source).not.toContain('raw 19999');
  });

  it('does not materialize a pathological 20k-line assistant response until explicitly expanded', () => {
    const text = Array.from({ length: 20_000 }, (_, index) => index ? `detail ${index}` : '# Large response').join('\n');
    const collapsed = buildVisibleTranscriptRenderRows([{ id: 'huge-answer', role: 'assistant', text }], new Set());
    expect(collapsed).toHaveLength(1);
    expect(collapsed[0]).toMatchObject({ sourceRow: 0, lastSourceRowInMessage: 19_999, fold: { expanded: false, hiddenLineCount: 19_999 } });
    expect(collapsed[0]?.compiled.source).toContain('Large response');

    const expanded = buildVisibleTranscriptRenderRows([{ id: 'huge-answer', role: 'assistant', text }], new Set(['huge-answer']));
    expect(expanded.length).toBeLessThanOrEqual(2_001);
    expect(expanded[0]?.key).toBe(collapsed[0]?.key);
    expect(expanded.at(-1)).toMatchObject({ sourceRow: 2_000, lastInMessage: true, fold: { expanded: true, hiddenLineCount: 18_000 } });
    expect(expanded.at(-1)?.compiled.source).toContain('18000 more lines omitted');
    expect(transcriptRenderIndexForSourceRow(expanded, 19_500)).toBe(0);
  });

  it('folds a pathological single wrapped paragraph before Markdown glyph allocation', () => {
    const text = `summary ${'wrapped '.repeat(10_000)}`;
    const rows = buildVisibleTranscriptRenderRows([{ id: 'huge-paragraph', role: 'assistant', text }], new Set());
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ sourceRow: 0, fold: { expanded: false } });
    expect(rows[0]?.compiled.source.length).toBeLessThan(220);
    const expanded = buildVisibleTranscriptRenderRows([{ id: 'huge-paragraph', role: 'assistant', text }], new Set(['huge-paragraph']));
    expect(expanded).toHaveLength(1);
    expect(expanded[0]?.compiled.source.length).toBeLessThan(8_100);
    expect(expanded[0]?.compiled.source).toContain('characters omitted');
  });

  it('suppresses structural Markdown blank rows while retaining their absolute coordinates', () => {
    const rows = buildVisibleTranscriptRenderRows([{ id: 'answer', role: 'assistant', text: 'Displayed:\n\n- **Title:** Daddy\n\nDone.' }], new Set());
    expect(rows.map((row) => [row.sourceRow, row.compiled.kind])).toEqual([[0, 'paragraph'], [2, 'bullet'], [4, 'paragraph']]);
  });

  it('keeps a truncated, tool-heavy history tail addressable after row suppression and folds', () => {
    const messages = messagesFromPayload({
      sessionKey: 'agent:main:dashboard:synthetic', truncated: true, contentTruncated: true,
      messages: [
        { role: 'user', content: '[System] A prior task stopped unexpectedly. Continue.' },
        { role: 'assistant', content: [{ type: 'text', text: 'No further reply is needed.' }] },
        { role: 'assistant', content: [
          { type: 'toolcall', id: 'synthetic-call', name: 'exec', arguments: { cmd: 'pwd' } },
          { type: 'tool_result', toolCallId: 'synthetic-call', content: '/workspace' },
        ] },
        { role: 'assistant', content: [{ type: 'text', text: '**Summary**\n\n- [A reference](https://example.test/)\n\nDone.' }] },
      ],
    });
    const buffer = createTranscriptBuffer(messages);
    const rows = buildVisibleTranscriptRenderRows(messages, new Set());
    expect(messages.some(message => message.role === 'tool')).toBe(true);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.at(-1)?.compiled.source).toBe('Done.');
    for (let sourceRow = 0; sourceRow < buffer.lines.length; sourceRow += 1) {
      const index = transcriptRenderIndexForSourceRow(rows, sourceRow);
      expect(index).toBeGreaterThanOrEqual(0);
      expect(index).toBeLessThan(rows.length);
      expect(rows[index]?.compiled.source).not.toBe('');
    }
  });

  it('folds tool details by default without cursor-driven expansion', () => {
    const canonical = buildTranscriptRenderRows([{ id: 'answer', role: 'assistant', text: 'answer' }, machine]);
    const visible = visibleTranscriptRenderRows(canonical, new Set());
    expect(visible).toHaveLength(2);
    expect(visible.at(-1)).toMatchObject({ sourceRow: 1, lastInMessage: true, fold: { expanded: false, hiddenLineCount: 4999 } });
    expect(visible.at(-1)?.compiled.source).toContain('[4999 lines folded]');
    expect(visible.at(-1)?.compiled.source).not.toContain('\n');
    expect(transcriptRenderIndexForSourceRow(visible, 2500)).toBe(1);
    expect(visible[transcriptRenderIndexForSourceRow(visible, 2500)]?.sourceRow).toBe(1);
    expect(transcriptNavigationSourceRows(visible)).toEqual([0, 1]);
  });

  it('expands only when explicitly toggled', () => {
    const canonical = buildTranscriptRenderRows([{ id: 'answer', role: 'assistant', text: 'answer' }, { id: 'tool', role: 'tool', text: 'exec\nresult' }]);
    expect(visibleTranscriptRenderRows(canonical, new Set())).toHaveLength(2);
    const expanded = visibleTranscriptRenderRows(canonical, new Set(['tool']));
    expect(expanded).toHaveLength(3);
    expect(expanded[1]?.key).toBe(visibleTranscriptRenderRows(canonical, new Set())[1]?.key);
    expect(expanded[1]?.fold).toEqual({ expanded: true, hiddenLineCount: 1 });
  });

  it('keeps the semantic tool summary and duration visible while raw details are folded', () => {
    const canonical = buildTranscriptRenderRows([{ id: 'tool-meta', role: 'tool', text: 'exec\n{"cmd":"pwd"}\n/tmp', tool: { name: 'exec', summary: 'exec · pwd', durationMs: 1250 } }]);
    const [folded] = visibleTranscriptRenderRows(canonical, new Set());
    expect(folded?.compiled.source).toContain('exec · pwd · 1.3s');
    expect(folded?.compiled.source).not.toContain('{"cmd"');
  });

  it('bounds a single enormous machine source line', () => {
    const canonical = buildTranscriptRenderRows([{ id: 'one-line', role: 'tool', text: 'x'.repeat(5000) }]);
    const [folded] = visibleTranscriptRenderRows(canonical, new Set());
    expect(folded?.compiled.source.length).toBeLessThan(1300);
    expect(folded?.sourceRow).toBe(0);
  });

  it('never exposes raw code or JSON in a collapsed tool row without metadata', () => {
    const raw = 'bash\n{"cmd":"node -e \\\"console.log({ deeply: nested })\\\"","env":{"TOKEN":"private"}}\n{"output":"' + 'x'.repeat(5000) + '"}';
    const canonical = buildTranscriptRenderRows([{ id: 'raw-history-tool', role: 'tool', text: raw }]);
    const [folded] = visibleTranscriptRenderRows(canonical, new Set());
    const expanded = visibleTranscriptRenderRows(canonical, new Set(['raw-history-tool']));

    expect(folded?.compiled.source).toMatch(/^bash · /);
    expect(folded?.compiled.source.length).toBeLessThan(160);
    expect(folded?.compiled.source).not.toMatch(/[{}\n]/);
    expect(folded?.compiled.source).not.toContain('TOKEN');
    expect(expanded.map((row) => row.compiled.source).join('\n')).toContain('console.log({ deeply: nested })');
  });

  it('presents expanded tools as a semantic header plus a visually distinct output block', () => {
    const message: WorkspaceMessage = { id: 'json-tool', role: 'tool', text: 'bash\n{\n  "state": "DONE"\n}', tool: { name: 'bash', summary: 'bash · inspect quiz state' } };
    const rows = buildVisibleTranscriptRenderRows([message], new Set(['json-tool']));
    expect(rows.map((row) => [row.compiled.source, row.compiled.kind])).toEqual([
      ['bash · inspect quiz state', 'paragraph'],
      ['{', 'code'],
      ['  "state": "DONE"', 'code'],
      ['}', 'code'],
    ]);
    expect(rows.map((row) => row.sourceRow)).toEqual([0, 1, 2, 3]);
  });
});

describe('assistant and narration prose breaks', () => {
  it('renders, searches and copies user and command prose breaks consistently', () => {
    for (const role of ['user', 'command'] as const) {
      const text = 'a<br>b';
      const rows = buildVisibleTranscriptRenderRows([{ id: role, role, text }], new Set());
      expect(rows[0]?.compiled.glyphs.map(glyph => glyph.char).join('')).toBe('a\nb');
      const buffer = createTranscriptBuffer([{ id: role, role, text }]);
      const visual = { ...createTranscriptVimState(buffer), anchor: { row: 0, column: 0 }, cursor: { row: 0, column: 5 }, visualMode: 'character' as const };
      expect(selectedTranscriptText(buffer, visual)).toBe('a\nb');
      expect(applyTranscriptSearch(buffer, createTranscriptVimState(buffer), '<br>', 1).state.cursor).toEqual({ row: 0, column: 0 });
      expect(applyTranscriptSearch(buffer, createTranscriptVimState(buffer), 'b', 1).state.cursor).toEqual({ row: 0, column: 5 });
    }
  });

  it('treats a standalone pair of breaks between document sections as blank source spacing', () => {
    for (const role of ['assistant', 'narration'] as const) {
      const text = '# First\n<br><br>\n# Second';
      const rows = buildVisibleTranscriptRenderRows([{ id: role, role, text }], new Set());
      expect(rows.map((row) => [row.sourceRow, row.compiled.source])).toEqual([[0, '# First'], [2, '# Second']]);
      expect(transcriptNavigationSourceRows(rows)).toEqual([0, 2]);
      expect(transcriptGutterLabel(2, 0, 1, 0)).toBe('1');
    }
  });

  it('copies prose breaks as newlines while keeping fenced and inline code literal', () => {
    const text = 'a<br>b\n`<br>`\n```html\n<br>\n```';
    const buffer = createTranscriptBuffer([{ id: 'reply', role: 'assistant', text }]);
    const visual = { ...createTranscriptVimState(buffer), anchor: { row: 0, column: 0 }, cursor: { row: 4, column: 2 }, visualMode: 'line' as const };
    expect(selectedTranscriptText(buffer, visual)).toBe('a\nb\n`<br>`\n```html\n<br>\n```');
    const inline = { ...visual, cursor: { row: 0, column: 5 }, visualMode: 'character' as const };
    expect(selectedTranscriptText(buffer, inline)).toBe('a\nb');
    expect(applyTranscriptSearch(buffer, createTranscriptVimState(buffer), 'b', 1).state.cursor).toEqual({ row: 0, column: 5 });
    expect(applyTranscriptSearch(buffer, createTranscriptVimState(buffer), '<br>', 1).state.cursor).toEqual({ row: 1, column: 1 });
  });
});

describe('assistant and narration Markdown disclosures', () => {
  const rowsFor = (text: string, role: WorkspaceMessage['role'] = 'assistant', expanded = new Set<string>()) =>
    buildVisibleTranscriptRenderRows([{ id: 'reply', role, text }], expanded);

  it('projects complete disclosures after expanding an oversized answer or narration', () => {
    for (const role of ['assistant', 'narration'] as const) {
      const text = `${'Long answer. '.repeat(5500)}\n<details><summary>Sources</summary>\n- hidden source\n</details>\nAfter.`;
      const folded = rowsFor(text, role);
      expect(folded).toHaveLength(1);
      const expanded = rowsFor(text, role, new Set(['reply']));
      const disclosure = expanded.find(row => row.foldKey === 'reply:details:1');
      expect(expanded[0]?.fold).toMatchObject({ expanded: true });
      expect(disclosure?.compiled.source).toBe('Sources  … [2 lines folded]');
      expect(expanded.some(row => row.compiled.source === '<details><summary>Sources</summary>')).toBe(false);
      const opened = rowsFor(text, role, new Set(['reply', disclosure!.foldKey!]));
      expect(opened.find(row => row.compiled.source === '- hidden source')?.sourceRow).toBe(2);
      expect(opened[0]?.fold).toMatchObject({ expanded: true });
    }
  });

  it('collapses the reported inline summary and restores formatted inner Markdown on expansion', () => {
    const text = 'Answer.\n<details><summary>Sources</summary>\n\n- Live process tree: `ps`\n- [OpenClaw docs](https://docs.openclaw.ai/)\n- Update wrapper\n</details>\nAfter.';
    const collapsed = rowsFor(text);
    expect(collapsed.map((row) => [row.sourceRow, row.compiled.source])).toEqual([
      [0, 'Answer.'], [1, 'Sources  … [5 lines folded]'], [7, 'After.'],
    ]);
    expect(collapsed[1]?.fold).toMatchObject({ expanded: false, hiddenLineCount: 5 });
    const expanded = rowsFor(text, 'assistant', new Set([collapsed[1]!.foldKey!]));
    expect(expanded.map((row) => [row.sourceRow, row.compiled.kind])).toEqual([
      [0, 'paragraph'], [1, 'paragraph'], [3, 'bullet'], [4, 'bullet'], [5, 'bullet'], [7, 'paragraph'],
    ]);
    expect(expanded[3]?.compiled.glyphs.some((glyph) => glyph.link?.kind === 'web')).toBe(true);
    expect(expanded[2]?.compiled.glyphs.some((glyph) => glyph.marks.includes('code'))).toBe(true);
    expect(expanded[1]?.key).toBe(collapsed[1]?.key);
    expect(transcriptNavigationSourceRows(collapsed)).toEqual([0, 1, 7]);
    expect(transcriptRenderIndexForSourceRow(collapsed, 4)).toBe(1);
  });

  it('accepts a separate summary line and falls back to Details without one', () => {
    const separate = rowsFor('<details>\n<summary>Notes</summary>\n- One\n</details>', 'narration');
    expect(separate).toHaveLength(1);
    expect(separate[0]?.compiled.source).toBe('Notes  … [3 lines folded]');
    const fallback = rowsFor('<details>\n- One\n</details>');
    expect(fallback[0]?.compiled.source).toBe('Details  … [2 lines folded]');
  });

  it('leaves fenced and inline code tags literal', () => {
    const text = '```html\n<details>\n<summary>Example</summary>\n</details>\n```\n`<details>`';
    const rows = rowsFor(text);
    expect(rows.map((row) => row.compiled.source)).toEqual(text.split('\n'));
    expect(rows.every((row) => !row.fold)).toBe(true);
  });

  it('keeps unclosed and malformed blocks literal without swallowing the tail', () => {
    const text = 'Before\n<details>\n<summary>Sources</summary>\n- pending\nAfter';
    expect(rowsFor(text).map((row) => row.compiled.source)).toEqual(text.split('\n'));
    const malformed = '<details>\n<summary>broken\n- one\n</details>\nAfter';
    expect(rowsFor(malformed).map((row) => row.compiled.source)).toEqual(malformed.split('\n'));
  });

  it('renders nested tag lines literally inside an expanded outer disclosure', () => {
    const text = '<details><summary>Outer</summary>\n<details><summary>Inner</summary>\n- inside\n</details>\n</details>';
    const collapsed = rowsFor(text);
    expect(collapsed).toHaveLength(1);
    const expanded = rowsFor(text, 'assistant', new Set([collapsed[0]!.foldKey!]));
    expect(expanded.map((row) => row.compiled.source)).toEqual(['Outer', '<details><summary>Inner</summary>', '- inside', '</details>']);
  });

  it('shows a live unclosed disclosure literally then converges after its closing line arrives', () => {
    const before = '<details><summary>Sources</summary>\n- live';
    const live = rowsFor(before);
    expect(live.map((row) => row.compiled.source)).toEqual(before.split('\n'));
    const complete = rowsFor(`${before}\n</details>`);
    expect(complete).toHaveLength(1);
    expect(complete[0]?.key).toBe(live[0]?.key);
    expect(complete[0]?.sourceRow).toBe(0);
    expect(complete[0]?.compiled.source).toBe('Sources  … [2 lines folded]');
  });

  it('projects hidden search hits and visual copy through the existing Vim stops', () => {
    const text = 'Before\n<details><summary>Sources</summary>\n- hidden needle\n</details>\nAfter';
    const buffer = createTranscriptBuffer([{ id: 'reply', role: 'assistant', text }]);
    const collapsed = rowsFor(text);
    const navigationRows = transcriptNavigationSourceRows(collapsed);
    const initial = { ...createTranscriptVimState(buffer), cursor: { row: 0, column: 0 } };
    expect(applyTranscriptSearch(buffer, initial, 'needle', 1, navigationRows).state.cursor.row).toBe(1);
    expect(navigationRows.map((sourceRow, index) => transcriptGutterLabel(sourceRow, 1, index, 1))).toEqual(['1', '0', '1']);
    const visual = { ...initial, cursor: { row: 4, column: 0 }, anchor: { row: 0, column: 0 }, visualMode: 'line' as const };
    expect(selectedTranscriptText(buffer, visual, navigationRows)).toBe('Before\n<details><summary>Sources</summary>\nAfter');
    const expanded = rowsFor(text, 'assistant', new Set([collapsed[1]!.foldKey!]));
    expect(applyTranscriptSearch(buffer, initial, 'needle', 1, transcriptNavigationSourceRows(expanded)).state.cursor.row).toBe(2);
  });
});

it('retains mounted render rows when only convergence authority changes', () => {
  const before: WorkspaceMessage = { id: 'live-chat-r', role: 'assistant', text: 'answer', source: 'live', state: 'complete',
    sessionKey: 's', runId: 'r', chatCumulativeText: 'first\n\nanswer', claudeNativeFullText: 'first\n\nanswer' };
  const after = { ...before, chatCumulativeText: 'second\n\nanswer', claudeNativeFullText: 'second\n\nanswer' };
  const previous = buildVisibleTranscriptRenderRows([before], new Set());
  const next = buildVisibleTranscriptRenderRows([after], new Set());
  expect(retainStableTranscriptRenderRows(previous, next)).toBe(previous);
});
