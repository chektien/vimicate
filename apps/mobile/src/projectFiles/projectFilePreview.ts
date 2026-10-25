import { compileTranscriptMarkdown, type CompiledMarkdownLine } from '../transcript/transcriptMarkdown';
import type { TranscriptBuffer } from '../transcript/transcriptBuffer';
import { createTranscriptVimState, focusTranscriptMessage, type TranscriptVimState } from '../transcript/transcriptVim';

export const PROJECT_FILE_PREVIEW_MAX_LINES = 600;
export const PROJECT_FILE_PREVIEW_MAX_CHARACTERS = 120_000;

export function boundedProjectFilePreviewSource(source: string) {
  const characterBounded = source.length > PROJECT_FILE_PREVIEW_MAX_CHARACTERS ? source.slice(0, PROJECT_FILE_PREVIEW_MAX_CHARACTERS) : source;
  const lines = characterBounded.split('\n');
  const bounded = lines.length > PROJECT_FILE_PREVIEW_MAX_LINES ? lines.slice(0, PROJECT_FILE_PREVIEW_MAX_LINES).join('\n') : characterBounded;
  return { source: bounded, truncated: bounded.length < source.length };
}

// A source preview is not a transcript message: transcript's machine-output
// folding leaves all but its first row sparse, which breaks word motions.
export function projectFilePreviewBuffer(source: string, path: string): TranscriptBuffer {
  const lines = source.split('\n').map((text, row) => ({ messageId: path, messageIndex: 0, lineInMessage: row, role: 'workspace' as const, text }));
  return { lines, firstRowByMessage: [0], lastRowByMessage: [lines.length - 1] };
}

export function createTopPreviewNavigation(source: string, line = 1) {
  const buffer = projectFilePreviewBuffer(source, 'project-file-preview');
  const requestedLine = Number.isFinite(line) ? Math.floor(line) : 1;
  const row = Math.max(0, Math.min(buffer.lines.length - 1, requestedLine - 1));
  return focusTranscriptMessage(buffer, createTranscriptVimState(buffer), 0, row);
}

export function restorePreviewNavigation(source: string, current: TranscriptVimState) {
  const buffer = projectFilePreviewBuffer(source, 'project-file-preview');
  const focused = focusTranscriptMessage(buffer, current, 0, current.cursor.row);
  const line = buffer.lines[focused.cursor.row];
  const column = Math.max(0, Math.min(current.cursor.column, Math.max(0, (line?.text.length ?? 1) - 1)));
  return { ...focused, cursor: { ...focused.cursor, column }, desiredColumn: column };
}

export function compiledProjectFilePreview(source: string, mimeType: string, path: string) {
  const markdown = mimeType === 'text/markdown' || /\.(?:md|markdown|mdown|mkd)$/iu.test(path);
  return markdown ? compileTranscriptMarkdown(source).map(disableLocalProjectLinks) : plainTextLines(source);
}

function disableLocalProjectLinks(line: CompiledMarkdownLine): CompiledMarkdownLine {
  const withoutLocalLink = (glyph: CompiledMarkdownLine['glyphs'][number]) => {
    if (glyph.link?.kind !== 'local-file') return glyph;
    const { link: _link, ...plain } = glyph;
    return plain;
  };
  const glyphs = line.glyphs.map(withoutLocalLink);
  const table = line.table ? { ...line.table, cells: line.table.cells.map((cell) => ({ ...cell, glyphs: cell.glyphs.map(withoutLocalLink) })) } : undefined;
  return { ...line, glyphs, ...(table ? { table } : {}) };
}

function plainTextLines(source: string): CompiledMarkdownLine[] {
  return source.split('\n').map((line) => {
    let offset = 0;
    return { source: line, kind: line ? 'paragraph' : 'blank', glyphs: [...line].map((char) => {
      const sourceIndex = offset; offset += char.length;
      return { char, sourceIndex, marks: [] };
    }) };
  });
}
