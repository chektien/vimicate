import type { HardwareKeyEvent } from '../../modules/vimicate-editor';
import { textObjectRange } from '../editor/vimTextObjects';
import { normalizedHardwareKey } from '../keyboard/hardwareKey';
import { transcriptLineAt, type TranscriptBuffer, type TranscriptLine } from './transcriptBuffer';
import { transcriptHorizontalMotion, type TranscriptRenderedLineAt } from './transcriptHorizontalMotion';
import { nextTranscriptSearchCursor } from './transcriptMessageSearch';
import { compileTranscriptMarkdown, transcriptProseSelectionText } from './transcriptMarkdown';

export {
  createTranscriptBuffer,
  transcriptLineAt,
  updatedTranscriptBuffer,
  type TranscriptBuffer,
  type TranscriptLine,
} from './transcriptBuffer';
export { transcriptSearchRanges } from './transcriptSearch';

export type TranscriptCursor = { row: number; column: number };
export type TranscriptVisualMode = 'character' | 'line' | 'block';
export type TranscriptHandoffVariant = 'i' | 'I' | 'a' | 'A' | 'o' | 'O';
export type TranscriptTextObjectPrefix = 'yi' | 'ya' | 'vi' | 'va';
export type TranscriptVimState = {
  cursor: TranscriptCursor;
  desiredColumn: number;
  followTail: boolean;
  visualMode: TranscriptVisualMode | null;
  anchor: TranscriptCursor | null;
  pending: '' | 'g' | 'y' | 'yg' | TranscriptTextObjectPrefix | 'z' | '[' | ']';
  count: string;
  searchQuery: string;
  searchDirection: 1 | -1;
};
export type TranscriptKeyEffect =
  | { type: 'none' }
  | { type: 'start-search' }
  | { type: 'yank'; text: string }
  | { type: 'toggle-fold'; messageId: string }
  | { type: 'handoff'; variant: TranscriptHandoffVariant };
export type TranscriptKeyResult = { state: TranscriptVimState; effect: TranscriptKeyEffect; handled: boolean };
export type TranscriptLineHighlight = {
  cursorColumn?: number;
  selection?: { start: number; end: number };
  lineSelected?: boolean;
};

export function createTranscriptVimState(buffer: TranscriptBuffer): TranscriptVimState {
  const row = Math.max(0, buffer.lines.length - 1);
  return { cursor: { row, column: 0 }, desiredColumn: 0, followTail: true, visualMode: null, anchor: null, pending: '', count: '', searchQuery: '', searchDirection: 1 };
}

export function revealTranscriptTailVimState(buffer: TranscriptBuffer, state: TranscriptVimState): TranscriptVimState {
  const row = Math.max(0, buffer.lines.length - 1);
  return {
    ...state,
    cursor: { row, column: 0 },
    desiredColumn: 0,
    followTail: true,
    visualMode: null,
    anchor: null,
    pending: '',
    count: '',
  };
}

export function reconcileTranscriptVimState(state: TranscriptVimState, previous: TranscriptBuffer, next: TranscriptBuffer, navigationRows?: readonly number[]): TranscriptVimState {
  const finish = (candidate: TranscriptVimState) => unchangedTranscriptVimState(state, navigationRows ? projectTranscriptVimState(candidate, next, navigationRows) : candidate);
  if (!next.lines.length) return finish({ ...state, cursor: { row: 0, column: 0 }, desiredColumn: 0, visualMode: null, anchor: null, pending: '', count: '' });
  if (!previous.lines.length) return finish({ ...state, cursor: { row: next.lines.length - 1, column: 0 }, desiredColumn: 0 });
  // Tail ownership is explicit. Inferring it from the cursor being in the
  // final two rows lets a new streaming frame reclaim the first k/j motion
  // before that review state paints. G/new submission creates a fresh
  // tail-owned state; any motion or touch-selected row owns review instead.
  const cursor = state.followTail ? { row: next.lines.length - 1, column: 0 } : remapCursor(state.cursor, previous, next);
  const anchor = state.anchor ? remapCursor(state.anchor, previous, next) : null;
  return finish({ ...state, cursor, anchor, desiredColumn: cursor.column });
}

// Same-line streaming must retain navigation identity. Publishing an equal
// object schedules another parent/list render and amplifies FlashList layout.
function unchangedTranscriptVimState(current: TranscriptVimState, candidate: TranscriptVimState) {
  return current.cursor.row === candidate.cursor.row
    && current.cursor.column === candidate.cursor.column
    && current.desiredColumn === candidate.desiredColumn
    && current.followTail === candidate.followTail
    && current.visualMode === candidate.visualMode
    && current.anchor?.row === candidate.anchor?.row
    && current.anchor?.column === candidate.anchor?.column
    && current.pending === candidate.pending
    && current.count === candidate.count
    && current.searchQuery === candidate.searchQuery
    && current.searchDirection === candidate.searchDirection
    ? current
    : candidate;
}

/**
 * Reconcile canonical Vim ownership with the rows the presentation can
 * actually stop on. A cumulative response can cross the bounded-presentation
 * ceiling while the cursor is inside it; leaving that now-hidden source row
 * authoritative makes the status line advance while the folded body appears
 * frozen. Project both cursor and visual anchor to the fold's stable visible
 * source row as soon as the presentation contracts.
 */
export function projectTranscriptVimState(state: TranscriptVimState, buffer: TranscriptBuffer, navigationRows: readonly number[]): TranscriptVimState {
  const rows = validNavigationRows(navigationRows, buffer.lines.length);
  if (!rows.length || !buffer.lines.length) return state;
  const cursorRow = projectedDocumentRow(state.cursor.row, rows, buffer.lines.length);
  const anchorRow = state.anchor ? projectedDocumentRow(state.anchor.row, rows, buffer.lines.length) : null;
  if (cursorRow === state.cursor.row && (!state.anchor || anchorRow === state.anchor.row)) return state;
  const cursor = clampCursor(buffer, cursorRow === state.cursor.row ? state.cursor : { row: cursorRow, column: 0 });
  const anchor = state.anchor && anchorRow !== null
    ? clampCursor(buffer, anchorRow === state.anchor.row ? state.anchor : { row: anchorRow, column: 0 })
    : state.anchor;
  return { ...state, cursor, anchor, desiredColumn: cursor.column };
}

export function focusTranscriptMessage(buffer: TranscriptBuffer, state: TranscriptVimState, messageIndex: number, lineInMessage = 0): TranscriptVimState {
  const first = buffer.firstRowByMessage[messageIndex];
  const last = buffer.lastRowByMessage[messageIndex];
  if (first === undefined || last === undefined) return state;
  const cursor = clampCursor(buffer, { row: Math.min(last, first + Math.max(0, lineInMessage)), column: 0 });
  return { ...state, cursor, desiredColumn: cursor.column, followTail: false, visualMode: null, anchor: null, pending: '', count: '' };
}

export function transcriptMessageIndex(buffer: TranscriptBuffer, state: TranscriptVimState) {
  return transcriptLineAt(buffer, clampCursor(buffer, state.cursor).row)?.messageIndex ?? 0;
}

export function transcriptSourceLinesForMessage(buffer: TranscriptBuffer, messageIndex: number) {
  const first = buffer.firstRowByMessage[messageIndex];
  const last = buffer.lastRowByMessage[messageIndex];
  if (first === undefined || last === undefined) return [];
  const result: Array<TranscriptLine & { row: number }> = [];
  for (let row = first; row <= last; row += 1) {
    const line = transcriptLineAt(buffer, row);
    if (line) result.push({ ...line, row });
  }
  return result;
}

export function focusedTranscriptLine(buffer: TranscriptBuffer, state: TranscriptVimState) {
  return transcriptLineAt(buffer, clampCursor(buffer, state.cursor).row) ?? null;
}

export function handleTranscriptKey(buffer: TranscriptBuffer, state: TranscriptVimState, input: HardwareKeyEvent, navigationRows?: readonly number[], renderedLineAt?: TranscriptRenderedLineAt): TranscriptKeyResult {
  const key = normalizedKey(input);
  const controlKey = input.control ? input.key.toLowerCase() : '';
  const noEffect: TranscriptKeyEffect = { type: 'none' };
  const result = (next: TranscriptVimState, handled = true, effect: TranscriptKeyEffect = noEffect): TranscriptKeyResult => ({ state: next, effect, handled });
  const clean = (next: TranscriptVimState) => ({ ...next, pending: '' as const, count: '' });

  if (key === 'escape' || (input.control && input.key === '[')) {
    return result({ ...state, visualMode: null, anchor: null, pending: '', count: '' });
  }
  if (key === '/' && !input.control && !input.command && !input.option) return result(state, true, { type: 'start-search' });
  if (input.control && controlKey === 'v') return result(toggleVisual(state, 'block'));
  if (input.control && ['f', 'b', 'd', 'u'].includes(controlKey)) {
    const delta = controlKey === 'f' ? 10 : controlKey === 'b' ? -10 : controlKey === 'd' ? 5 : -5;
    return result(clean(moveRows(buffer, state, delta, navigationRows)));
  }

  if (/^[1-9]$/.test(key) || (key === '0' && state.count)) return result({ ...state, count: `${state.count}${key}` });
  const count = Math.max(1, Number(state.count || '1'));

  if (state.pending === 'g') {
    if (key === 'g') return result(clean(moveToRow(buffer, state, projectedDocumentRow(state.count ? count - 1 : 0, navigationRows, buffer.lines.length), 0)));
    return result({ ...state, pending: '', count: '' }, false);
  }
  if (state.pending === 'yg') {
    if (key === 'g') return yankMotion(buffer, state, { row: projectedDocumentRow(state.count ? count - 1 : 0, navigationRows, buffer.lines.length), column: 0 }, 'line');
    return result({ ...state, pending: '', count: '' }, false);
  }
  if (state.pending === 'yi' || state.pending === 'ya') {
    const range = transcriptTextObject(buffer, state.cursor, key, state.pending === 'ya');
    if (!range) return result({ ...state, pending: '', count: '' }, false);
    return result({ ...state, pending: '', count: '' }, true, { type: 'yank', text: extractSelection(buffer, range.start, range.end, 'character') });
  }
  if (state.pending === 'vi' || state.pending === 'va') {
    const range = transcriptTextObject(buffer, state.cursor, key, state.pending === 'va');
    if (!range) return result({ ...state, pending: '', count: '' }, false);
    return result({ ...state, anchor: range.start, cursor: range.end, desiredColumn: range.end.column, pending: '', count: '' });
  }
  if (state.pending === '[' || state.pending === ']') {
    if (key !== state.pending) return result({ ...state, pending: '', count: '' }, false);
    const destination = adjacentMessageRow(buffer, state.cursor.row, state.pending === '[' ? -count : count);
    return result(clean(moveToRow(buffer, state, destination, 0)));
  }
  if (state.pending === 'z') {
    if (key !== 'a') return result({ ...state, pending: '', count: '' }, false);
    const messageId = transcriptLineAt(buffer, clampCursor(buffer, state.cursor).row)?.messageId;
    return result(
      { ...state, pending: '', count: '' },
      true,
      messageId ? { type: 'toggle-fold', messageId } : noEffect,
    );
  }
  if (state.pending === 'y') {
    if (key === 'g') return result({ ...state, pending: 'yg' });
    if (key === 'i' || key === 'a') return result({ ...state, pending: key === 'i' ? 'yi' : 'ya' });
    if (key === 'y') return yankRows(buffer, state, state.cursor.row, state.cursor.row + count - 1);
    const target = motionTarget(buffer, state, key, count, navigationRows, renderedLineAt);
    if (target) return yankMotion(buffer, state, target.cursor, target.linewise ? 'line' : 'character');
    return result({ ...state, pending: '', count: '' }, false);
  }

  if (key === 'v') return result(toggleVisual(state, 'character'));
  if (key === 'V') return result(toggleVisual(state, 'line'));
  if (key === 'y' || key === 'Y') {
    if (state.visualMode && state.anchor) {
      const text = selectedTranscriptText(buffer, state, navigationRows);
      return result({ ...state, visualMode: null, anchor: null, pending: '', count: '' }, true, { type: 'yank', text });
    }
    if (key === 'Y') return yankRows(buffer, state, state.cursor.row, state.cursor.row + count - 1);
    return result({ ...state, pending: 'y' });
  }
  if (state.visualMode && (key === 'i' || key === 'a')) return result({ ...state, pending: key === 'i' ? 'vi' : 'va' });
  if (['i', 'I', 'a', 'A', 'o', 'O'].includes(key) && !state.visualMode && !state.pending && !state.count) {
    return result(state, true, { type: 'handoff', variant: key as TranscriptHandoffVariant });
  }
  if (key === 'g') return result({ ...state, pending: 'g' });
  if (key === 'z' || key === '[' || key === ']') return result({ ...state, pending: key });
  if (key === 'G') {
    const next = clean(moveToRow(buffer, state, projectedDocumentRow(state.count ? count - 1 : buffer.lines.length - 1, navigationRows, buffer.lines.length, !state.count), 0));
    return result({ ...next, followTail: !state.count });
  }

  const target = motionTarget(buffer, state, key, count, navigationRows, renderedLineAt);
  if (target) return result(clean(moveToCursor(buffer, state, target.cursor)));
  return result({ ...state, pending: '', count: '' }, false);

  function yankMotion(source: TranscriptBuffer, current: TranscriptVimState, cursor: TranscriptCursor, style: 'character' | 'line'): TranscriptKeyResult {
    const text = style === 'line'
      ? extractSelection(source, current.cursor, cursor, 'line', navigationRows)
      : extractSelection(source, current.cursor, cursor, 'character', navigationRows);
    return result({ ...current, pending: '', count: '' }, true, { type: 'yank', text });
  }

  function yankRows(source: TranscriptBuffer, current: TranscriptVimState, start: number, end: number): TranscriptKeyResult {
    const text = extractSelection(source, { row: start, column: 0 }, { row: end, column: 0 }, 'line', navigationRows);
    return result({ ...current, pending: '', count: '' }, true, { type: 'yank', text });
  }
}

export function applyTranscriptSearch(buffer: TranscriptBuffer, state: TranscriptVimState, query: string, direction: 1 | -1, navigationRows?: readonly number[]): { state: TranscriptVimState; matched: boolean } {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle || !buffer.lines.length) return { state: { ...state, searchQuery: query, searchDirection: direction }, matched: false };
  const current = clampCursor(buffer, state.cursor);
  const next = nextTranscriptSearchCursor(buffer, needle, current, direction, navigationRows);
  if (!next) return { state: { ...state, searchQuery: query, searchDirection: direction }, matched: false };
  return { state: { ...moveToCursor(buffer, state, next), searchQuery: query, searchDirection: direction, pending: '', count: '' }, matched: true };
}

export function repeatTranscriptSearch(buffer: TranscriptBuffer, state: TranscriptVimState, reverse = false) {
  const direction = (reverse ? -state.searchDirection : state.searchDirection) as 1 | -1;
  return applyTranscriptSearch(buffer, state, state.searchQuery, direction);
}

export function clearTranscriptSearch(state: TranscriptVimState): TranscriptVimState {
  return { ...state, searchQuery: '' };
}

export function transcriptLineHighlight(state: TranscriptVimState, row: number, lineLength: number): TranscriptLineHighlight {
  const cursor = state.cursor.row === row ? { cursorColumn: Math.min(state.cursor.column, lineLength) } : {};
  if (!state.visualMode || !state.anchor) return cursor;
  const [start, end] = ordered(state.anchor, state.cursor);
  if (row < start.row || row > end.row) return cursor;
  if (state.visualMode === 'line') return { ...cursor, lineSelected: true };
  const lower = state.visualMode === 'block' ? Math.min(state.anchor.column, state.cursor.column) : row === start.row ? start.column : 0;
  const upper = state.visualMode === 'block' ? Math.max(state.anchor.column, state.cursor.column) : row === end.row ? end.column : Math.max(0, lineLength - 1);
  if (!lineLength || lower >= lineLength) return cursor;
  return { ...cursor, selection: { start: Math.max(0, Math.min(lower, lineLength - 1)), end: Math.max(0, Math.min(Math.max(lower, upper), lineLength - 1)) } };
}

export function selectedTranscriptText(buffer: TranscriptBuffer, state: TranscriptVimState, navigationRows?: readonly number[]) {
  if (!state.visualMode || !state.anchor) return '';
  return extractSelection(buffer, state.anchor, state.cursor, state.visualMode, navigationRows);
}

function normalizedKey(input: HardwareKeyEvent) {
  return normalizedHardwareKey(input);
}

function remapCursor(cursor: TranscriptCursor, previous: TranscriptBuffer, next: TranscriptBuffer) {
  const oldLine = transcriptLineAt(previous, clampCursor(previous, cursor).row);
  if (!oldLine) return clampCursor(next, cursor);
  const sameMessageFirst = next.firstRowByMessage[oldLine.messageIndex];
  const sameMessageRow = sameMessageFirst === undefined ? -1 : sameMessageFirst + oldLine.lineInMessage;
  const row = sameMessageRow >= 0
    && transcriptLineAt(next, sameMessageRow)?.messageId === oldLine.messageId
    && transcriptLineAt(next, sameMessageRow)?.lineInMessage === oldLine.lineInMessage
    ? sameMessageRow
    : messageRowForIdentity(next, oldLine.messageId, oldLine.lineInMessage);
  return clampCursor(next, { row: row >= 0 ? row : cursor.row, column: cursor.column });
}

function messageRowForIdentity(buffer: TranscriptBuffer, messageId: string, lineInMessage: number) {
  const messageIndex = buffer.messages?.findIndex((message) => message.id === messageId) ?? -1;
  if (messageIndex < 0) return -1;
  const first = buffer.firstRowByMessage[messageIndex];
  const last = buffer.lastRowByMessage[messageIndex];
  if (first === undefined || last === undefined) return -1;
  const row = first + lineInMessage;
  return row <= last ? row : -1;
}

function clampCursor(buffer: TranscriptBuffer, cursor: TranscriptCursor): TranscriptCursor {
  if (!buffer.lines.length) return { row: 0, column: 0 };
  const row = Math.max(0, Math.min(buffer.lines.length - 1, cursor.row));
  return { row, column: Math.max(0, Math.min(transcriptLineAt(buffer, row)?.text.length ?? 0, cursor.column)) };
}

function moveToCursor(buffer: TranscriptBuffer, state: TranscriptVimState, cursor: TranscriptCursor): TranscriptVimState {
  const next = clampCursor(buffer, cursor);
  return { ...state, cursor: next, desiredColumn: next.column, followTail: false };
}

function moveToRow(buffer: TranscriptBuffer, state: TranscriptVimState, row: number, column = state.desiredColumn): TranscriptVimState {
  const next = clampCursor(buffer, { row, column });
  return { ...state, cursor: next, desiredColumn: column, followTail: false };
}

function moveRows(buffer: TranscriptBuffer, state: TranscriptVimState, delta: number, navigationRows?: readonly number[]) {
  const row = projectedVerticalRow(state.cursor.row, delta, navigationRows, buffer.lines.length);
  return moveToRow(buffer, state, row, state.desiredColumn);
}

function motionTarget(buffer: TranscriptBuffer, state: TranscriptVimState, key: string, count: number, navigationRows?: readonly number[], renderedLineAt?: TranscriptRenderedLineAt): { cursor: TranscriptCursor; linewise?: boolean } | null {
  const cursor = clampCursor(buffer, state.cursor);
  if (key === 'j' || key === 'down') return { cursor: clampCursor(buffer, { row: projectedVerticalRow(cursor.row, count, navigationRows, buffer.lines.length), column: state.desiredColumn }), linewise: key === 'j' && state.pending === 'y' };
  if (key === 'k' || key === 'up') return { cursor: clampCursor(buffer, { row: projectedVerticalRow(cursor.row, -count, navigationRows, buffer.lines.length), column: state.desiredColumn }), linewise: key === 'k' && state.pending === 'y' };
  if (key === 'h' || key === 'left') return { cursor: transcriptHorizontalMotion(buffer, cursor, count, -1, (row, delta) => projectedVerticalRow(row, delta, navigationRows, buffer.lines.length), renderedLineAt) };
  if (key === 'l' || key === 'right') return { cursor: transcriptHorizontalMotion(buffer, cursor, count, 1, (row, delta) => projectedVerticalRow(row, delta, navigationRows, buffer.lines.length), renderedLineAt) };
  if (key === '0') return { cursor: { row: cursor.row, column: 0 } };
  if (key === '^') return { cursor: { row: cursor.row, column: firstNonBlank(transcriptLineAt(buffer, cursor.row)?.text ?? '') } };
  if (key === '$') return { cursor: { row: cursor.row, column: transcriptLineAt(buffer, cursor.row)?.text.length ?? 0 } };
  if (key === 'w' || key === 'W') return { cursor: repeatWord(buffer, cursor, count, 'forward', navigationRows, key === 'W') };
  if (key === 'b' || key === 'B') return { cursor: repeatWord(buffer, cursor, count, 'backward', navigationRows, key === 'B') };
  if (key === 'e' || key === 'E') return { cursor: repeatWord(buffer, cursor, count, 'end', navigationRows, key === 'E') };
  if (key === 'G') return { cursor: { row: state.count ? count - 1 : buffer.lines.length - 1, column: 0 }, linewise: state.pending === 'y' };
  return null;
}

function validNavigationRows(navigationRows: readonly number[] | undefined, lineCount: number) {
  if (!navigationRows?.length) return [];
  return navigationRows.filter((row, index) => row >= 0 && row < lineCount && (index === 0 || row > navigationRows[index - 1]!));
}

function projectedRowIndex(sourceRow: number, navigationRows: readonly number[]) {
  const exact = navigationRows.indexOf(sourceRow);
  if (exact >= 0) return exact;
  const following = navigationRows.findIndex((row) => row > sourceRow);
  return following < 0 ? navigationRows.length - 1 : Math.max(0, following - 1);
}

function projectedVerticalRow(sourceRow: number, delta: number, navigationRows: readonly number[] | undefined, lineCount: number) {
  const rows = validNavigationRows(navigationRows, lineCount);
  if (!rows.length) return sourceRow + delta;
  const index = projectedRowIndex(sourceRow, rows);
  return rows[Math.max(0, Math.min(rows.length - 1, index + delta))] ?? sourceRow;
}

function projectedDocumentRow(sourceRow: number, navigationRows: readonly number[] | undefined, lineCount: number, last = false) {
  const rows = validNavigationRows(navigationRows, lineCount);
  if (!rows.length) return sourceRow;
  if (last) return rows.at(-1) ?? sourceRow;
  return rows[projectedRowIndex(sourceRow, rows)] ?? sourceRow;
}

function wordPositions(buffer: TranscriptBuffer, ends = false, navigationRows?: readonly number[], big = false) {
  const rows = validNavigationRows(navigationRows, buffer.lines.length);
  const candidates = rows.length ? rows : Object.keys(buffer.lines).map(Number).sort((left, right) => left - right);
  return candidates.flatMap((row) => {
    const line = transcriptLineAt(buffer, row);
    return line ? [...line.text.matchAll(big ? /\S+/g : /\w+|[^\w\s]+/g)].map((match) => ({ row, column: (match.index ?? 0) + (ends ? match[0].length - 1 : 0) })) : [];
  });
}

function repeatWord(buffer: TranscriptBuffer, start: TranscriptCursor, count: number, direction: 'forward' | 'backward' | 'end', navigationRows?: readonly number[], big = false) {
  let cursor = start;
  for (let repetition = 0; repetition < count; repetition += 1) {
    const positions = wordPositions(buffer, direction === 'end', navigationRows, big);
    cursor = direction === 'backward'
      ? [...positions].reverse().find((position) => compareCursor(position, cursor) < 0) ?? { row: 0, column: 0 }
      : positions.find((position) => compareCursor(position, cursor) > 0) ?? {
        row: Math.max(0, validNavigationRows(navigationRows, buffer.lines.length).at(-1) ?? buffer.lines.length - 1),
        column: transcriptLineAt(buffer, validNavigationRows(navigationRows, buffer.lines.length).at(-1) ?? buffer.lines.length - 1)?.text.length ?? 0,
      };
  }
  return clampCursor(buffer, cursor);
}

function firstNonBlank(line: string) { return line.match(/^\s*/)?.[0].length ?? 0; }

function toggleVisual(state: TranscriptVimState, mode: TranscriptVisualMode): TranscriptVimState {
  if (state.visualMode === mode) return { ...state, visualMode: null, anchor: null, pending: '', count: '' };
  return { ...state, followTail: false, visualMode: mode, anchor: state.cursor, pending: '', count: '' };
}

function extractSelection(buffer: TranscriptBuffer, from: TranscriptCursor, to: TranscriptCursor, style: TranscriptVisualMode, navigationRows?: readonly number[]) {
  if (!buffer.lines.length) return '';
  const [start, end] = ordered(clampCursor(buffer, from), clampCursor(buffer, to));
  const rows = selectedSourceRows(start.row, end.row, navigationRows, buffer.lines.length);
  const copy = (row: number, start = 0, end?: number) => {
    const line = transcriptLineAt(buffer, row);
    if (!line) return '';
    if (line.role !== 'assistant' && line.role !== 'narration' && line.role !== 'user' && line.role !== 'command') return line.text.slice(start, end);
    const message = buffer.messages?.[line.messageIndex];
    const compiled = message && compileTranscriptMarkdown(message.text)[line.lineInMessage];
    return compiled ? transcriptProseSelectionText(compiled, start, end ?? line.text.length) : line.text.slice(start, end);
  };
  if (style === 'line') return rows.map((row) => copy(row)).join('\n');
  if (style === 'block') {
    const lower = Math.min(from.column, to.column);
    const upper = Math.max(from.column, to.column);
    return rows.map((row) => copy(row, lower, upper + 1)).join('\n');
  }
  if (start.row === end.row) return copy(start.row, start.column, end.column + 1);
  const result = [copy(rows[0] ?? start.row, start.column)];
  rows.slice(1, -1).forEach((row) => result.push(copy(row)));
  result.push(copy(rows.at(-1) ?? end.row, 0, end.column + 1));
  return result.join('\n');
}

function selectedSourceRows(first: number, last: number, navigationRows: readonly number[] | undefined, lineCount: number) {
  const rows = validNavigationRows(navigationRows, lineCount).filter((row) => row >= first && row <= last);
  if (rows.length) return rows;
  return Array.from({ length: Math.max(0, last - first + 1) }, (_, index) => first + index);
}

function adjacentMessageRow(buffer: TranscriptBuffer, row: number, delta: number) {
  if (!buffer.lines.length) return 0;
  const currentMessage = transcriptLineAt(buffer, clampCursor(buffer, { row, column: 0 }).row)?.messageIndex ?? 0;
  const targetMessage = Math.max(0, Math.min(buffer.firstRowByMessage.length - 1, currentMessage + delta));
  return buffer.firstRowByMessage[targetMessage] ?? row;
}

function transcriptTextObject(buffer: TranscriptBuffer, cursor: TranscriptCursor, object: string, around: boolean): { start: TranscriptCursor; end: TranscriptCursor } | null {
  const safe = clampCursor(buffer, cursor);
  const line = transcriptLineAt(buffer, safe.row)?.text ?? '';
  const range = textObjectRange(line, safe.column, object, around);
  return range ? { start: { row: safe.row, column: range.start }, end: { row: safe.row, column: range.end } } : null;
}

function compareCursor(left: TranscriptCursor, right: TranscriptCursor) { return left.row === right.row ? left.column - right.column : left.row - right.row; }
function ordered(left: TranscriptCursor, right: TranscriptCursor): [TranscriptCursor, TranscriptCursor] { return compareCursor(left, right) <= 0 ? [left, right] : [right, left]; }
