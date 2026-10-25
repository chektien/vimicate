import { transcriptLineAt, type TranscriptBuffer } from './transcriptBuffer';
import type { CompiledMarkdownLine } from './transcriptMarkdown';
import { transcriptRenderedCursorIndex } from './transcriptRenderedCursor';

export type TranscriptRenderedLineAt = (sourceRow: number) => CompiledMarkdownLine | undefined;
type Cursor = { row: number; column: number };

function visibleGlyphs(line: CompiledMarkdownLine) {
  return line.kind === 'table' && line.table ? line.table.cells.flatMap((cell) => cell.glyphs) : line.glyphs;
}

/** Move through the committed painted glyphs, retaining immutable source coordinates. */
function renderedHorizontalTarget(
  buffer: TranscriptBuffer, cursor: Cursor,
  direction: 1 | -1,
  lineAt: TranscriptRenderedLineAt | undefined,
  adjacentRow: (row: number) => number,
): Cursor | null {
  const line = lineAt?.(cursor.row);
  if (!line || line.source !== transcriptLineAt(buffer, cursor.row)?.text) return null;
  const glyphs = visibleGlyphs(line);
  const index = transcriptRenderedCursorIndex(glyphs, cursor.column);
  const next = glyphs[index + direction];
  if (index >= 0 && next) return { row: cursor.row, column: next.sourceIndex };
  const row = adjacentRow(cursor.row);
  if (row === cursor.row) return { row, column: glyphs[index]?.sourceIndex ?? 0 };
  const destination = lineAt?.(row);
  if (!destination || destination.source !== transcriptLineAt(buffer, row)?.text) {
    return { row, column: direction === 1 ? 0 : Math.max(0, (transcriptLineAt(buffer, row)?.text.length ?? 0) - 1) };
  }
  const destinationGlyphs = visibleGlyphs(destination);
  return { row, column: (direction === 1 ? destinationGlyphs[0] : destinationGlyphs.at(-1))?.sourceIndex ?? 0 };
}

export function transcriptHorizontalMotion(
  buffer: TranscriptBuffer, start: Cursor, count: number, direction: 1 | -1,
  projectedRow: (row: number, delta: number) => number, lineAt?: TranscriptRenderedLineAt,
) {
  let cursor = start;
  const adjacentRow = (row: number) => Math.max(0, Math.min(buffer.lines.length - 1, projectedRow(row, direction)));
  for (let step = 0; step < count; step += 1) {
    const visible = renderedHorizontalTarget(buffer, cursor, direction, lineAt, adjacentRow);
    if (visible) { cursor = visible; continue; }
    const last = Math.max(0, (transcriptLineAt(buffer, cursor.row)?.text.length ?? 0) - 1);
    if ((direction === 1 && cursor.column < last) || (direction === -1 && cursor.column > 0)) {
      cursor = { ...cursor, column: cursor.column + direction };
    } else {
      const row = adjacentRow(cursor.row);
      cursor = { row, column: direction === 1 ? 0 : Math.max(0, (transcriptLineAt(buffer, row)?.text.length ?? 0) - 1) };
    }
  }
  return cursor;
}
