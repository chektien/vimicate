import { describe, expect, it } from 'vitest';
import { compiledProjectFilePreview } from './projectFilePreview';
// @ts-expect-error Vitest's Node runtime provides this test-only module.
import { readFileSync } from 'node:fs';

it('retains UTF-16 source coordinates after emoji in plain text', () => {
  const lines = compiledProjectFilePreview('😀 **literal**', 'text/plain', 'notes.txt');
  expect(lines[0]?.glyphs.slice(0, 4).map(glyph => glyph.sourceIndex)).toEqual([0, 2, 3, 4]);
  expect(lines[0]?.glyphs.map(glyph => glyph.char).join('')).toBe('😀 **literal**');
});

describe('project file preview', () => {
  it('keeps the bounded preview in a virtualized list rather than mounting every row', () => {
    const pane = readFileSync(new URL('./ProjectFilesPane.tsx', import.meta.url), 'utf8');
    expect(pane).toMatch(/<FlatList[^>]*data={lines}/s);
    expect(pane).not.toContain('lines.map(');
  });
  it('renders Markdown while disabling only project-local link activation', () => {
    const lines = compiledProjectFilePreview('# Plan\n[inside](../secret.md) [web](https://example.com)', 'text/markdown', 'README.md');
    expect(lines[0]).toMatchObject({ kind: 'heading' });
    expect(lines[1]?.glyphs.some(glyph => glyph.link?.kind === 'local-file')).toBe(false);
    expect(lines[1]?.glyphs.some(glyph => glyph.link?.kind === 'web')).toBe(true);
  });

  it('keeps non-Markdown text literal', () => {
    const [line] = compiledProjectFilePreview('# literal **source**', 'text/plain', 'notes.txt');
    expect(line?.kind).toBe('paragraph');
    expect(line?.glyphs.map(glyph => glyph.char).join('')).toBe('# literal **source**');
    expect(line?.glyphs.every(glyph => glyph.marks.length === 0 && !glyph.link)).toBe(true);
  });
});

it('keeps gitignore patterns and comments literal in the Files preview', () => {
  const source = '# generated output\n**/build/\n!keep.txt\n[ab].log';
  const lines = compiledProjectFilePreview(source, 'text/plain', '.gitignore');
  expect(lines.map(line => line.glyphs.map(glyph => glyph.char).join('')).join('\n')).toBe(source);
  expect(lines.every(line => line.kind === 'paragraph')).toBe(true);
  expect(lines.flatMap(line => line.glyphs).every(glyph => glyph.marks.length === 0 && !glyph.link)).toBe(true);
});
