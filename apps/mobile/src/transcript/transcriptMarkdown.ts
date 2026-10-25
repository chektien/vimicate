import { parseCodexFileCitation } from './transcriptFileCitation';

export type MarkdownMark = 'strong' | 'emphasis' | 'code' | 'strike' | 'link';
export type TranscriptLinkTarget =
  | { kind: 'web'; url: string }
  | { kind: 'local-file'; path: string; rawTarget?: string; line?: number };
export type MarkdownGlyph = { char: string; sourceIndex: number; marks: MarkdownMark[]; link?: TranscriptLinkTarget };
export type MarkdownLineKind = 'blank' | 'paragraph' | 'heading' | 'bullet' | 'ordered' | 'task' | 'quote' | 'code' | 'fence' | 'rule' | 'table' | 'image';
export type CompiledMarkdownLine = {
  source: string;
  kind: MarkdownLineKind;
  glyphs: MarkdownGlyph[];
  marker?: string;
  indent?: number;
  headingLevel?: number;
  table?: {
    cells: { source: string; glyphs: MarkdownGlyph[] }[];
    columnWeights: number[];
    header: boolean;
    first: boolean;
    last: boolean;
  };
};

const MAX_CACHE_ENTRIES = 128;
const MAX_CACHE_SOURCE_BYTES = 1_000_000;
const MAX_CACHEABLE_SOURCE_BYTES = 64_000;
const cache = new Map<string, { compiled: CompiledMarkdownLine[]; sourceBytes: number }>();
let cacheSourceBytes = 0;

export function compileTranscriptMarkdown(source: string) {
  const existing = cache.get(source); if (existing) return existing.compiled;
  const lines = source.split('\n'); let fence = '';
  const tables = tableLayouts(lines);
  const compiled = lines.map((line, index) => {
    const trimmed = line.trim();
    if (fence) {
      if (trimmed.startsWith(fence)) { fence = ''; return lineResult(line, 'fence', []); }
      return lineResult(line, 'code', inlineGlyphs(line, 0, ['code']));
    }
    const fenceMatch = line.match(/^\s*(```|~~~)\s*([^`]*)$/);
    if (fenceMatch?.[1]) {
      fence = fenceMatch[1]; const label = fenceMatch[2]?.trim() ?? '';
      const offset = label ? line.indexOf(label) : line.length;
      return lineResult(line, 'fence', inlineGlyphs(label, offset, ['code']));
    }
    if (!trimmed || /^(?:\s*<br\s*\/?>)+\s*$/i.test(line)) return lineResult(line, 'blank', inlineGlyphs(line, 0));
    if (/^\s{0,3}(?:-{3,}|\*{3,}|_{3,})\s*$/.test(line)) return lineResult(line, 'rule', []);
    if (isTableSeparator(trimmed)) return lineResult(line, 'rule', []);
    const tableSeparatorIndex = tables.separatorByLine[index] ?? -1;
    if (tableSeparatorIndex >= 0) {
      const widths = tables.widthsBySeparator.get(tableSeparatorIndex) ?? [];
      const bounds = tables.boundsBySeparator.get(tableSeparatorIndex);
      const cells = tableCells(line);
      return {
        ...lineResult(line, 'table', tableGlyphsFromCells(cells, widths)),
        table: {
          cells: cells.map((cell) => ({ source: cell.value, glyphs: inlineGlyphs(cell.value, cell.sourceIndex) })),
          columnWeights: tableColumnWeights(widths),
          header: index < tableSeparatorIndex,
          first: index === bounds?.first,
          last: index === bounds?.last,
        },
      };
    }
    const image = line.match(/^\s*!\[([^\]]*)\]\(\s*(?:<([^>]+)>|([^\s)]+))(?:\s+["'][^)]*["'])?\s*\)\s*$/);
    if (image) {
      const alt = image[1]?.trim() || 'image'; const at = Math.max(0, line.indexOf(image[1] ?? ''));
      return lineResult(line, 'image', inlineGlyphs(`▣ ${alt}`, at, []));
    }
    const heading = line.match(/^\s{0,3}(#{1,6})\s+(.+)$/);
    if (heading?.[1] && heading[2] !== undefined) return { ...lineResult(line, 'heading', inlineGlyphs(heading[2], line.indexOf(heading[2]))), headingLevel: heading[1].length };
    const task = line.match(/^(\s*)[-+*]\s+\[([ xX])\]\s+(.+)$/);
    if (task?.[3] !== undefined) return { ...lineResult(line, 'task', inlineGlyphs(task[3], line.indexOf(task[3]))), marker: task[2]?.toLowerCase() === 'x' ? '[x]' : '[ ]', indent: task[1]?.length ?? 0 };
    const ordered = line.match(/^(\s*)(\d+)[.)]\s+(.+)$/);
    if (ordered?.[3] !== undefined) return { ...lineResult(line, 'ordered', inlineGlyphs(ordered[3], line.indexOf(ordered[3]))), marker: `${ordered[2]}.`, indent: ordered[1]?.length ?? 0 };
    const bullet = line.match(/^(\s*)[-+*]\s+(.+)$/);
    if (bullet?.[2] !== undefined) return { ...lineResult(line, 'bullet', inlineGlyphs(bullet[2], line.indexOf(bullet[2]))), marker: '•', indent: bullet[1]?.length ?? 0 };
    const quote = line.match(/^(\s*)>\s?(.*)$/);
    if (quote?.[2] !== undefined) return { ...lineResult(line, 'quote', inlineGlyphs(quote[2], line.lastIndexOf(quote[2]))), indent: quote[1]?.length ?? 0 };
    return lineResult(line, 'paragraph', inlineGlyphs(line, 0));
  });
  const sourceBytes = approximateSourceBytes(source);
  if (sourceBytes <= MAX_CACHEABLE_SOURCE_BYTES) {
    cache.set(source, { compiled, sourceBytes }); cacheSourceBytes += sourceBytes;
    while (cache.size > MAX_CACHE_ENTRIES || cacheSourceBytes > MAX_CACHE_SOURCE_BYTES) {
      const oldest = cache.keys().next().value;
      if (oldest === undefined) break;
      const removed = cache.get(oldest); cache.delete(oldest); cacheSourceBytes -= removed?.sourceBytes ?? 0;
    }
  }
  return compiled;
}

export function transcriptMarkdownCacheSnapshot() {
  return { entries: cache.size, sourceBytes: cacheSourceBytes };
}

export function resetTranscriptMarkdownCache() {
  cache.clear(); cacheSourceBytes = 0;
}

function approximateSourceBytes(value: string) { return value.length * 2; }

export function plainTranscriptMarkdownLine(source: string) {
  return lineResult(source, source ? 'paragraph' : 'blank', inlineGlyphs(source, 0));
}

export function machineDetailTranscriptLine(source: string) {
  return source ? lineResult(source, 'code', inlineGlyphs(source, 0, ['code'])) : lineResult(source, 'blank', []);
}

export function transcriptProseSelectionText(line: CompiledMarkdownLine, start: number, end: number) {
  const source = line.source;
  if (line.kind === 'code' || line.kind === 'fence') return source.slice(start, end);
  const breaks = line.glyphs.filter((glyph) => glyph.char === '\n').map((glyph) => glyph.sourceIndex);
  let result = '';
  let cursor = start;
  for (const at of breaks) {
    const length = source.slice(at).match(/^<br\s*\/?>/i)?.[0].length ?? 0;
    if (!length || at < cursor || at + length > end) continue;
    result += source.slice(cursor, at) + '\n';
    cursor = at + length;
  }
  return result + source.slice(cursor, end);
}

export function safeTranscriptLink(value: string) {
  try { const parsed = new URL(value); return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? parsed.toString() : ''; }
  catch { return ''; }
}

export function transcriptLinkTarget(value: string, source: 'markdown' | 'literal-path' = 'markdown'): TranscriptLinkTarget | null {
  const trimmed = value.trim();
  const web = safeTranscriptLink(trimmed);
  if (web) return { kind: 'web', url: web };
  if (source === 'literal-path') return literalFileTarget(trimmed);
  if (/^file:/i.test(trimmed)) {
    try {
      const parsed = new URL(trimmed);
      if (parsed.protocol !== 'file:' || parsed.hostname || parsed.username || parsed.password || parsed.port || parsed.search) return null;
      const path = decodeURIComponent(parsed.pathname);
      if (!path.startsWith('/') || unsupportedFilePath(path)) return null;
      const line = transcriptLineFragment(parsed.hash);
      return { kind: 'local-file', path, ...(trimmed.includes('%') || parsed.hash ? { rawTarget: trimmed } : {}), ...(line ? { line } : {}) };
    } catch { return null; }
  }
  const separated = transcriptFileReference(trimmed);
  if (!separated || /^[a-z][a-z\d+.-]*:/i.test(separated.path)) return null;
  try {
    const path = decodeURIComponent(separated.path);
    if (!path || unsupportedFilePath(path)) return null;
    return { kind: 'local-file', path, ...(trimmed.includes('%') || separated.hadSuffix ? { rawTarget: trimmed } : {}), ...(separated.line ? { line: separated.line } : {}) };
  } catch { return null; }
}

function literalFileTarget(value: string): TranscriptLinkTarget | null {
  const separated = transcriptFileReference(value);
  if (!separated || !separated.path || unsupportedFilePath(separated.path)) return null;
  return { kind: 'local-file', path: separated.path, ...(separated.hadSuffix ? { rawTarget: value } : {}), ...(separated.line ? { line: separated.line } : {}) };
}

function transcriptFileReference(value: string) {
  const hash = value.indexOf('#');
  if (hash >= 0) {
    const line = transcriptLineFragment(value.slice(hash));
    return { path: value.slice(0, hash), line, hadSuffix: true };
  }
  const suffix = value.match(/:(\d+)(?::\d+)?$/);
  if (!suffix) return { path: value, line: 0, hadSuffix: false };
  const line = Number(suffix[1]);
  return Number.isSafeInteger(line) && line > 0
    ? { path: value.slice(0, -suffix[0].length), line, hadSuffix: true }
    : null;
}

function transcriptLineFragment(fragment: string) {
  const match = fragment.match(/^#L(\d+)$/i);
  const line = match ? Number(match[1]) : 0;
  return Number.isSafeInteger(line) && line > 0 ? line : 0;
}

function unsupportedFilePath(path: string) {
  return path.includes('\0') || path.includes('\\') || path.includes('?') || path.includes('#');
}

function lineResult(source: string, kind: MarkdownLineKind, glyphs: MarkdownGlyph[]): CompiledMarkdownLine { return { source, kind, glyphs }; }
function isTableSeparator(line: string) { return /^\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?$/.test(line); }
function tableGlyphsFromCells(cells: ReturnType<typeof tableCells>, widths: number[]) {
  const glyphs: MarkdownGlyph[] = [];
  cells.forEach((cell, index) => {
    glyphs.push(...inlineGlyphs(cell.value, cell.sourceIndex));
    if (index >= cells.length - 1) return;
    const padding = ' '.repeat(Math.max(2, (widths[index] ?? cell.value.length) - cell.value.length + 2));
    glyphs.push(...[...padding].map((char) => ({ char, sourceIndex: cell.separatorIndex, marks: [] as MarkdownMark[] })));
  });
  return glyphs;
}

export function tableColumnWeights(widths: number[]) {
  return widths.map((width) => Math.max(4, Math.min(32, width || 4)));
}

function tableCandidate(line: string) { return Boolean(line.trim()) && line.includes('|'); }

function tableLayouts(lines: string[]) {
  const separatorByLine = Array.from({ length: lines.length }, () => -1);
  const widthsBySeparator = new Map<number, number[]>();
  const boundsBySeparator = new Map<number, { first: number; last: number }>();
  let cursor = 0;
  while (cursor < lines.length) {
    if (!tableCandidate(lines[cursor] ?? '')) { cursor += 1; continue; }
    const start = cursor;
    while (cursor + 1 < lines.length && tableCandidate(lines[cursor + 1] ?? '')) cursor += 1;
    const end = cursor;
    let separatorIndex = -1;
    for (let row = start; row <= end; row += 1) {
      if (isTableSeparator((lines[row] ?? '').trim())) { separatorIndex = row; break; }
    }
    if (separatorIndex >= 0) {
      const widths: number[] = [];
      for (let row = start; row <= end; row += 1) {
        if (row === separatorIndex) continue;
        separatorByLine[row] = separatorIndex;
        tableCells(lines[row] ?? '').forEach((cell, column) => { widths[column] = Math.max(widths[column] ?? 0, cell.value.length); });
      }
      widthsBySeparator.set(separatorIndex, widths);
      const contentRows = Array.from({ length: end - start + 1 }, (_, offset) => start + offset)
        .filter((row) => row !== separatorIndex);
      if (contentRows.length) boundsBySeparator.set(separatorIndex, {
        first: contentRows[0] ?? start,
        last: contentRows.at(-1) ?? end,
      });
    }
    cursor += 1;
  }
  return { separatorByLine, widthsBySeparator, boundsBySeparator };
}

function tableCells(line: string) {
  const cells: { value: string; sourceIndex: number; separatorIndex: number }[] = [];
  const raw = line.replace(/^\s*\|/, '').replace(/\|\s*$/, '');
  const offset = line.indexOf(raw);
  let cursor = 0;
  for (const part of raw.split('|')) {
    const value = part.trim();
    const local = part.indexOf(value);
    cells.push({ value, sourceIndex: Math.max(0, offset + cursor + Math.max(0, local)), separatorIndex: Math.max(0, offset + cursor + part.length) });
    cursor += part.length + 1;
  }
  return cells;
}

function inlineGlyphs(text: string, sourceOffset: number, inherited: MarkdownMark[] = [], citationBudget = { remaining: Math.min(text.length * 4, 256_000) }): MarkdownGlyph[] {
  const glyphs: MarkdownGlyph[] = []; let index = 0;
  const append = (value: string, at: number, marks = inherited, link: TranscriptLinkTarget | null = null) => {
    [...value].forEach((char, offset) => glyphs.push({ char, sourceIndex: sourceOffset + at + offset, marks, ...(link ? { link } : {}) }));
  };
  while (index < text.length) {
    if (text[index] === '\\' && index + 1 < text.length) { append(text[index + 1] ?? '', index + 1); index += 2; continue; }
    const image = tokenAt(text, index, /^!\[([^\]]*)\]\(\s*(?:<([^>]+)>|([^\s)]+))[^)]*\)/);
    if (image) { const label = image.match[1] || 'image'; append(`▣ ${label}`, index + 2); index += image.full.length; continue; }
    const link = tokenAt(text, index, /^\[([^\]]+)\]\(\s*(?:<([^>]+)>|([^\s)]+))[^)]*\)/);
    if (link) {
      const destination = transcriptLinkTarget(link.match[2] || link.match[3] || '');
      const label = link.match[1] ?? ''; glyphs.push(...inlineGlyphs(label, sourceOffset + index + 1, [...inherited, 'link'], citationBudget).map((glyph) => destination ? { ...glyph, link: destination } : glyph));
      index += link.full.length; continue;
    }
    const code = tokenAt(text, index, /^`([^`]+)`/);
    if (code) { const value = code.match[1] ?? ''; append(value, index + 1, [...inherited, 'code']); index += code.full.length; continue; }
    if (!inherited.includes('code')) {
      const lineBreak = text.slice(index).match(/^<br\s*\/?>/i)?.[0];
      if (lineBreak) { glyphs.push({ char: '\n', sourceIndex: sourceOffset + index, marks: inherited }); index += lineBreak.length; continue; }
    }
    if (!inherited.includes('code') && !inherited.includes('link')) {
      const parsed = parseCodexFileCitation(text, index, citationBudget);
      if (parsed?.kind === 'literal') {
        append(text.slice(index, index + parsed.rawLength), index);
        index += parsed.rawLength; continue;
      }
      if (parsed?.kind === 'citation') {
        const { path, pathSourceOffset, rawLength } = parsed.citation;
        const destination = transcriptLinkTarget(path, 'literal-path');
        const target = destination?.kind === 'local-file' ? destination : null;
        const displayPath = target?.path ?? path;
        const filename = fileCitationName(displayPath);
        const label = `${target ? 'file' : 'file unavailable'} · ${filename}`;
        const filenameOffset = Math.max(0, path.lastIndexOf(filename));
        literalGlyphs(label, sourceOffset + index, [...inherited, 'link'], target).forEach((glyph) => {
          const labelOffset = glyph.sourceIndex - sourceOffset - index;
          if (labelOffset >= label.length - filename.length) glyph.sourceIndex = sourceOffset + pathSourceOffset + filenameOffset + labelOffset - (label.length - filename.length);
          glyphs.push(glyph);
        });
        index += rawLength; continue;
      }
    }
    const strong = tokenAt(text, index, /^(?:\*\*([^*]+)\*\*|__([^_]+)__)/);
    if (strong) { const value = strong.match[1] ?? strong.match[2] ?? ''; glyphs.push(...inlineGlyphs(value, sourceOffset + index + 2, [...inherited, 'strong'], citationBudget)); index += strong.full.length; continue; }
    const strike = tokenAt(text, index, /^~~([^~]+)~~/);
    if (strike) { const value = strike.match[1] ?? ''; glyphs.push(...inlineGlyphs(value, sourceOffset + index + 2, [...inherited, 'strike'], citationBudget)); index += strike.full.length; continue; }
    const emphasis = tokenAt(text, index, /^(?:\*([^*]+)\*|_([^_]+)_)/);
    if (emphasis) { const value = emphasis.match[1] ?? emphasis.match[2] ?? ''; glyphs.push(...inlineGlyphs(value, sourceOffset + index + 1, [...inherited, 'emphasis'], citationBudget)); index += emphasis.full.length; continue; }
    // Prose punctuation is not part of an auto-detected URL. Leave it for
    // the next iteration so its text/source position survives without a link.
    const bare = text.slice(index).match(/^https?:\/\/[^\s<>()]+/)?.[0].replace(/[.,!?;:]+$/, '');
    if (bare) { const destination = transcriptLinkTarget(bare); append(bare, index, [...inherited, 'link'], destination); index += bare.length; continue; }
    append(text[index] ?? '', index); index += 1;
  }
  return glyphs;
}

function literalGlyphs(text: string, sourceOffset: number, marks: MarkdownMark[], link: TranscriptLinkTarget | null = null) {
  let offset = 0;
  return [...text].map((char) => {
    const glyph = { char, sourceIndex: sourceOffset + offset, marks, ...(link ? { link } : {}) };
    offset += char.length;
    return glyph;
  });
}

function fileCitationName(path: string) {
  const trimmed = path.replace(/[\\/]+$/, '');
  return trimmed.split(/[\\/]/).at(-1) || 'file';
}

function tokenAt(text: string, index: number, pattern: RegExp) {
  const match = text.slice(index).match(pattern); return match ? { full: match[0], match } : null;
}
