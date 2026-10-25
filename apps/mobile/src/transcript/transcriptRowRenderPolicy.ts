import type { TranscriptRenderRow } from './transcriptRenderRows';
import { transcriptSearchRanges } from './transcriptSearch';
import { transcriptLineHighlight, type TranscriptVimState } from './transcriptVim';

/**
 * Navigation is passed through FlashList as extra data, but a cursor step must
 * only repaint the rows whose visible selection/cursor/timestamp changed. A
 * full visible-window repaint on every 30 ms key repeat is enough to make the
 * gutter advance while text appears frozen on a physical iPad.
 */
export function transcriptSourceRowNavigationChanged(
  row: TranscriptRenderRow,
  previous: TranscriptVimState,
  next: TranscriptVimState,
  previouslyFocused: boolean,
  nextFocused: boolean,
) {
  if (previous.searchQuery !== next.searchQuery) return true;
  const previousHighlight = transcriptLineHighlight(previous, row.sourceRow, row.compiled.source.length);
  const nextHighlight = transcriptLineHighlight(next, row.sourceRow, row.compiled.source.length);
  if (!equalHighlight(previousHighlight, nextHighlight)) return true;
  if ((previouslyFocused && previous.cursor.row === row.sourceRow) !== (nextFocused && next.cursor.row === row.sourceRow)) return true;
  if (row.firstInMessage) {
    const previousMessageFocus = previouslyFocused && messageContains(row, previous.cursor.row);
    const nextMessageFocus = nextFocused && messageContains(row, next.cursor.row);
    if (previousMessageFocus !== nextMessageFocus) return true;
  }
  return false;
}

/**
 * The outer row must repaint its relative gutter number after every cursor
 * step. The formatted body must not: rebuilding every Markdown glyph in the
 * mounted window is the expensive path that made the gutter advance while
 * the transcript appeared frozen. Keep body invalidation row-local.
 */
export function transcriptMarkdownLineNavigationChanged(
  source: string,
  row: number,
  previous: TranscriptVimState,
  next: TranscriptVimState,
  previousCursorVisible: boolean,
  nextCursorVisible: boolean,
) {
  const previousHighlight = transcriptLineHighlight(previous, row, source.length);
  const nextHighlight = transcriptLineHighlight(next, row, source.length);
  const previousVisibleHighlight = visibleCursorHighlight(previousHighlight, previousCursorVisible);
  const nextVisibleHighlight = visibleCursorHighlight(nextHighlight, nextCursorVisible);
  if (!equalHighlight(previousVisibleHighlight, nextVisibleHighlight)) return true;
  if (previous.searchQuery === next.searchQuery) return false;
  return !equalSearchRanges(
    transcriptSearchRanges(source, previous.searchQuery),
    transcriptSearchRanges(source, next.searchQuery),
  );
}

function visibleCursorHighlight(
  highlight: ReturnType<typeof transcriptLineHighlight>,
  cursorVisible: boolean,
) {
  if (cursorVisible || highlight.cursorColumn === undefined) return highlight;
  const { cursorColumn: _hiddenCursor, ...visible } = highlight;
  return visible;
}

function messageContains(row: TranscriptRenderRow, sourceRow: number) {
  return sourceRow >= row.firstSourceRowInMessage && sourceRow <= row.lastSourceRowInMessage;
}

function equalHighlight(
  left: ReturnType<typeof transcriptLineHighlight>,
  right: ReturnType<typeof transcriptLineHighlight>,
) {
  return left.lineSelected === right.lineSelected
    && left.cursorColumn === right.cursorColumn
    && left.selection?.start === right.selection?.start
    && left.selection?.end === right.selection?.end;
}

function equalSearchRanges(
  left: ReturnType<typeof transcriptSearchRanges>,
  right: ReturnType<typeof transcriptSearchRanges>,
) {
  return left.length === right.length
    && left.every((range, index) => range.start === right[index]?.start && range.end === right[index]?.end);
}
