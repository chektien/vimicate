import type { CompiledMarkdownLine, MarkdownGlyph, TranscriptLinkTarget } from './transcriptMarkdown';
import type { TranscriptRenderRow } from './transcriptRenderRows';

/** Source coordinates may fall on hidden Markdown syntax; use the glyph painted under the block cursor. */
export function transcriptRenderedCursorIndex(glyphs: readonly MarkdownGlyph[], sourceColumn: number | undefined) {
  if (sourceColumn === undefined || !glyphs.length) return -1;
  const exact = glyphs.findIndex((glyph) => glyph.sourceIndex === sourceColumn);
  if (exact >= 0) return exact;
  const following = glyphs.findIndex((glyph) => glyph.sourceIndex > sourceColumn);
  return following >= 0 ? following : glyphs.length - 1;
}

export function transcriptRenderedCursorSourceIndex(glyphs: readonly MarkdownGlyph[], sourceColumn: number | undefined) {
  const index = transcriptRenderedCursorIndex(glyphs, sourceColumn);
  return index >= 0 ? glyphs[index]?.sourceIndex : undefined;
}

function linkAtCursor(line: CompiledMarkdownLine, sourceColumn: number): TranscriptLinkTarget | null {
  if (line.kind === 'code' || line.kind === 'fence') return null;
  const glyphs = line.kind === 'table' && line.table
    ? line.table.cells.flatMap((cell) => cell.glyphs)
    : line.glyphs;
  const index = transcriptRenderedCursorIndex(glyphs, sourceColumn);
  return index >= 0 ? glyphs[index]?.link ?? null : null;
}

/** Only an exact, committed visible row can own Enter; never borrow a fold/neighbor fallback. */
export function transcriptLinkAtVisibleSourceCursor(rows: readonly TranscriptRenderRow[], sourceRow: number, sourceColumn: number): TranscriptLinkTarget | null {
  const row = rows.find((candidate) => candidate.sourceRow === sourceRow);
  return row ? linkAtCursor(row.compiled, sourceColumn) : null;
}
