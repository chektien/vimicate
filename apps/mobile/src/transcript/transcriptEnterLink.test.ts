import { describe, expect, it } from 'vitest';
import { buildVisibleTranscriptRenderRows } from './transcriptVisibleRows';
import { transcriptLinkAtVisibleSourceCursor } from './transcriptRenderedCursor';
import type { WorkspaceMessage } from '../workspace/workspaceTypes';

function rows(text: string) {
  const message: WorkspaceMessage = { id: 'reply', role: 'assistant', text };
  return buildVisibleTranscriptRenderRows([message], new Set());
}

describe('transcript Enter on a rendered link', () => {
  it('opens a sentence-final bare URL without activating its full stop', () => {
    const url = 'https://sandbox.example.test/why';
    const source = `The rewrite is live on sandbox at ${url}.`;
    const visible = rows(source);
    expect(transcriptLinkAtVisibleSourceCursor(visible, 0, source.indexOf(url)))
      .toEqual({ kind: 'web', url });
    expect(transcriptLinkAtVisibleSourceCursor(visible, 0, source.length - 1)).toBeNull();
  });

  it.each([
    ['relative path', '- [Teaching Philosophy](notes/Teaching%20Philosophy.md)', 'Teaching', { kind: 'local-file', path: 'notes/Teaching Philosophy.md', rawTarget: 'notes/Teaching%20Philosophy.md' }],
    ['absolute path', '- [Research Strategy](</fixture/example-notes/Research Strategy.md>)', 'Research', { kind: 'local-file', path: '/fixture/example-notes/Research Strategy.md' }],
    ['home path', '- [Change summary](<~/notes/Change summary.md>)', 'Change', { kind: 'local-file', path: '~/notes/Change summary.md' }],
  ])('resolves the %s under the visible block cursor', (_name, source, label, target) => {
    expect(transcriptLinkAtVisibleSourceCursor(rows(source), 0, source.indexOf(label))).toEqual(target);
    // On a list row, the source cursor can stand on the hidden marker while
    // the visible block cursor is on the first link glyph.
    expect(transcriptLinkAtVisibleSourceCursor(rows(source), 0, 0)).toEqual(target);
  });

  it('selects only the link under the cursor on a line with multiple links', () => {
    const source = 'See [first](a.md), [second](b%20file.md), and [web](https://example.com).';
    const visible = rows(source);
    expect(transcriptLinkAtVisibleSourceCursor(visible, 0, source.indexOf('first'))).toEqual({ kind: 'local-file', path: 'a.md' });
    expect(transcriptLinkAtVisibleSourceCursor(visible, 0, source.indexOf('second'))).toEqual({ kind: 'local-file', path: 'b file.md', rawTarget: 'b%20file.md' });
    expect(transcriptLinkAtVisibleSourceCursor(visible, 0, source.indexOf('web'))).toEqual({ kind: 'web', url: 'https://example.com/' });
    expect(transcriptLinkAtVisibleSourceCursor(visible, 0, source.indexOf('See'))).toBeNull();
    expect(transcriptLinkAtVisibleSourceCursor(visible, 0, source.indexOf('and'))).toBeNull();
  });

  it('does not activate source text in a code block or a hidden/fallback row', () => {
    const source = '~~~\n[not a link](notes/hidden.md)\n~~~\n[real](notes/real.md)';
    const visible = rows(source);
    expect(visible.map((row) => row.compiled.kind)).toEqual(['fence', 'code', 'fence', 'paragraph']);
    expect(transcriptLinkAtVisibleSourceCursor(visible, 1, 2)).toBeNull();
    expect(transcriptLinkAtVisibleSourceCursor(visible, 2, 0)).toBeNull();
    expect(transcriptLinkAtVisibleSourceCursor(visible, 3, 1)).toEqual({ kind: 'local-file', path: 'notes/real.md' });
    expect(transcriptLinkAtVisibleSourceCursor(visible, 4, 0)).toBeNull();
  });

  it('preserves table-cell and wrapped-label source coordinates', () => {
    const source = '| Item | Notes |\n| --- | --- |\n| [A very long readable name](<docs/long name.md>) | [other](b.md) |';
    const visible = rows(source);
    expect(transcriptLinkAtVisibleSourceCursor(visible, 2, source.split('\n')[2]!.indexOf('readable'))).toEqual({ kind: 'local-file', path: 'docs/long name.md' });
    expect(transcriptLinkAtVisibleSourceCursor(visible, 2, source.split('\n')[2]!.indexOf('other'))).toEqual({ kind: 'local-file', path: 'b.md' });
  });
});
