import { transcriptRoleIsSearchable, transcriptSearchRanges, type TranscriptSearchRange } from './transcriptSearch';
import { compileTranscriptMarkdown, plainTranscriptMarkdownLine, type CompiledMarkdownLine } from './transcriptMarkdown';
import { transcriptLineAt, type TranscriptBuffer } from './transcriptBuffer';

type MatchVisitor = (line: number, column: number) => void;
type RenderedRanges = (line: string, query: string, compiled?: CompiledMarkdownLine) => TranscriptSearchRange[];
export type TranscriptSearchCursor = { row: number; column: number };

// Only lines whose rendered glyphs can differ from their literal source need
// the Markdown fallback. Plain tool output can otherwise contain tens of
// thousands of hidden lines that must not each enter the Markdown compiler.
const renderedSearchCandidate = /\[[^\]\n]+\]\([^)\n]+\)|\*\*[^*\n]+\*\*|__[^_\n]+__|~~[^~\n]+~~|`[^`\n]+`|\\[*_~`[\]()]/g;

export function visitTranscriptMessageSearchMatches(
  source: string,
  query: string,
  visit: MatchVisitor,
  renderedRanges: RenderedRanges = transcriptSearchRanges,
  normalizedSource = source.toLocaleLowerCase(),
  proseBreaks = true,
) {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle || needle.includes('\n')) return;
  const hiddenBreaks: { start: number; end: number }[] = [];
  if (proseBreaks && /<br\s*\/?>/i.test(source)) {
    let offset = 0;
    compileTranscriptMarkdown(source).forEach((line) => {
      line.glyphs.forEach((glyph) => {
        if (glyph.char !== '\n') return;
        const length = line.source.slice(glyph.sourceIndex).match(/^<br\s*\/?>/i)?.[0].length ?? 0;
        if (length) hiddenBreaks.push({ start: offset + glyph.sourceIndex, end: offset + glyph.sourceIndex + length - 1 });
      });
      offset += line.source.length + 1;
    });
  }
  const renderedRows = visitRenderedMarkdownMatches(source, needle, visit, renderedRanges, proseBreaks);
  visitLiteralMatches(normalizedSource, needle, visit, hiddenBreaks, renderedRows);
}

/** Finds only the next/wrapped match without allocating every hidden result. */
export function nextTranscriptSearchCursor(
  buffer: TranscriptBuffer,
  query: string,
  current: TranscriptSearchCursor,
  direction: 1 | -1,
  navigationRows?: readonly number[],
): TranscriptSearchCursor | null {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle || !buffer.lines.length) return null;
  const projectedRows = validNavigationRows(navigationRows, buffer.lines.length);
  let firstRow = -1; let firstColumn = 0;
  let lastRow = -1; let lastColumn = 0;
  let forwardRow = -1; let forwardColumn = 0;
  let backwardRow = -1; let backwardColumn = 0;
  const admit = (sourceRow: number, sourceColumn: number) => {
    const row = projectedRows.length ? projectedSearchRow(sourceRow, projectedRows) : sourceRow;
    const column = row === sourceRow ? sourceColumn : 0;
    if (firstRow < 0 || comparePosition(row, column, firstRow, firstColumn) < 0) {
      firstRow = row; firstColumn = column;
    }
    if (lastRow < 0 || comparePosition(row, column, lastRow, lastColumn) > 0) {
      lastRow = row; lastColumn = column;
    }
    const relative = comparePosition(row, column, current.row, current.column);
    if (relative > 0 && (forwardRow < 0 || comparePosition(row, column, forwardRow, forwardColumn) < 0)) {
      forwardRow = row; forwardColumn = column;
    }
    if (relative < 0 && (backwardRow < 0 || comparePosition(row, column, backwardRow, backwardColumn) > 0)) {
      backwardRow = row; backwardColumn = column;
    }
  };

  if (buffer.messages?.length) {
    const normalizedSources = new Map<string, string>();
    buffer.messages.forEach((message, messageIndex) => {
      if (!transcriptRoleIsSearchable(message.role)) return;
      const first = buffer.firstRowByMessage[messageIndex] ?? 0;
      let normalizedSource = normalizedSources.get(message.text);
      if (normalizedSource === undefined) {
        normalizedSource = message.text.toLocaleLowerCase();
        normalizedSources.set(message.text, normalizedSource);
      }
      visitTranscriptMessageSearchMatches(
        message.text,
        needle,
        (line, column) => admit(first + line, column),
        transcriptSearchRanges,
        normalizedSource,
        message.role === 'assistant' || message.role === 'narration' || message.role === 'user' || message.role === 'command',
      );
    });
  } else {
    Object.keys(buffer.lines).map(Number).sort((left, right) => left - right).forEach((row) => {
      const line = transcriptLineAt(buffer, row);
      if (!line || !transcriptRoleIsSearchable(line.role)) return;
      transcriptSearchRanges(line.text, needle).forEach((range) => admit(row, range.start));
    });
  }

  const row = direction === 1
    ? (forwardRow >= 0 ? forwardRow : firstRow)
    : (backwardRow >= 0 ? backwardRow : lastRow);
  if (row < 0) return null;
  const column = direction === 1
    ? (forwardRow >= 0 ? forwardColumn : firstColumn)
    : (backwardRow >= 0 ? backwardColumn : lastColumn);
  return { row, column };
}

function visitLiteralMatches(source: string, needle: string, visit: MatchVisitor, hiddenBreaks: readonly TranscriptSearchRange[], renderedRows: ReadonlySet<number>) {
  let offset = 0;
  let line = 0;
  let lineStart = 0;
  let newline = source.indexOf('\n');
  while (offset <= source.length - needle.length) {
    const found = source.indexOf(needle, offset);
    if (found < 0) break;
    while (newline >= 0 && newline < found) {
      line += 1;
      lineStart = newline + 1;
      newline = source.indexOf('\n', lineStart);
    }
    // Vimicate's command line is single-line and the preceding implementation
    // searched one source row at a time, so never invent a cross-row match.
    if (!renderedRows.has(line) && (newline < 0 || found + needle.length <= newline)
      && hiddenBreaks.every((range) => found + needle.length - 1 < range.start || found > range.end)) visit(line, found - lineStart);
    offset = found + Math.max(1, needle.length);
  }
}

function visitRenderedMarkdownMatches(
  source: string,
  needle: string,
  visit: MatchVisitor,
  renderedRanges: RenderedRanges,
  conversation: boolean,
) {
  const renderedRows = new Set<number>();
  const needsContext = /^\s*(```|~~~)/m.test(source);
  let contextualLines: CompiledMarkdownLine[] | undefined;
  renderedSearchCandidate.lastIndex = 0;
  let line = 0;
  let lineStart = 0;
  let newline = source.indexOf('\n');
  let lastCandidateLineStart = -1;
  for (let candidate = renderedSearchCandidate.exec(source); candidate; candidate = renderedSearchCandidate.exec(source)) {
    while (newline >= 0 && newline < candidate.index) {
      line += 1;
      lineStart = newline + 1;
      newline = source.indexOf('\n', lineStart);
    }
    if (lineStart === lastCandidateLineStart) continue;
    lastCandidateLineStart = lineStart;
    const lineEnd = newline < 0 ? source.length : newline;
    const sourceLine = source.slice(lineStart, lineEnd);
    renderedRows.add(line);
    if (conversation && needsContext) contextualLines ??= compileTranscriptMarkdown(source);
    const compiled = conversation ? contextualLines?.[line] : plainTranscriptMarkdownLine(sourceLine);
    renderedRanges(sourceLine, needle, compiled).forEach((range) => visit(line, range.start));
  }
  return renderedRows;
}

function validNavigationRows(navigationRows: readonly number[] | undefined, lineCount: number) {
  if (!navigationRows?.length) return [];
  return navigationRows.filter((row, index) => row >= 0 && row < lineCount && (index === 0 || row > navigationRows[index - 1]!));
}

function projectedSearchRow(sourceRow: number, navigationRows: readonly number[]) {
  let lower = 0;
  let upper = navigationRows.length - 1;
  while (lower <= upper) {
    const middle = Math.floor((lower + upper) / 2);
    const candidate = navigationRows[middle] ?? sourceRow;
    if (candidate === sourceRow) return candidate;
    if (candidate < sourceRow) lower = middle + 1;
    else upper = middle - 1;
  }
  return navigationRows[Math.max(0, upper)] ?? navigationRows[0] ?? sourceRow;
}

function comparePosition(leftRow: number, leftColumn: number, rightRow: number, rightColumn: number) {
  return leftRow === rightRow ? leftColumn - rightColumn : leftRow - rightRow;
}
