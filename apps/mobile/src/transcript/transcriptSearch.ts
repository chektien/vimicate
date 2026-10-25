import { compileTranscriptMarkdown, type CompiledMarkdownLine } from './transcriptMarkdown';

export function transcriptRoleIsSearchable(role: string): boolean { return role !== 'tool'; }

export type TranscriptSearchRange = { start: number; end: number };

export function transcriptSearchRanges(line: string, query: string, compiled = compileTranscriptMarkdown(line)[0]): TranscriptSearchRange[] {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) return [];
  // The transcript is a formatted read-only buffer. Search what the reader
  // can actually see, then map the visible glyph match back to the immutable
  // Markdown source coordinate used by Vim motion, selection and gutters.
  // This keeps `Updated standup.md` searchable when the source is
  // `Updated [standup.md](...)` without replacing the focused transcript with
  // raw Markdown or inventing a second navigation coordinate system.
  const glyphs = compiled?.glyphs ?? [];
  if (!glyphs.length) return [];
  const rendered = glyphs.map((glyph) => glyph.char).join('').toLocaleLowerCase();
  const sourceIndices = glyphs.flatMap((glyph) => Array<number>(glyph.char.toLocaleLowerCase().length).fill(glyph.sourceIndex));
  return literalSearchRanges(rendered, needle).flatMap((range) => {
    const start = sourceIndices[range.start];
    const end = sourceIndices[range.end];
    return start !== undefined && end !== undefined ? [{ start, end }] : [];
  });
}

function literalSearchRanges(source: string, needle: string): TranscriptSearchRange[] {
  const ranges: TranscriptSearchRange[] = [];
  let offset = 0;
  while (offset <= source.length - needle.length) {
    const start = source.indexOf(needle, offset);
    if (start < 0) break;
    ranges.push({ start, end: start + needle.length - 1 });
    offset = start + Math.max(1, needle.length);
  }
  return ranges;
}
