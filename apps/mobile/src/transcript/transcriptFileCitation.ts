const DIRECTIVE_NAME = 'codex-file-citation';
const MAX_DIRECTIVE_SOURCE = 4096;

export type CodexFileCitation = {
  rawLength: number;
  path: string;
  pathSourceOffset: number;
};

export type CodexFileCitationParse =
  | { kind: 'citation'; citation: CodexFileCitation }
  | { kind: 'literal'; rawLength: number }
  | null;

/**
 * Parses only a complete file-citation candidate at `start`. Malformed and
 * partial candidates are returned as one literal span so nested text cannot be
 * reinterpreted as another directive. Work is capped per candidate and by the
 * caller-owned budget.
 */
export function parseCodexFileCitation(
  source: string,
  start: number,
  budget: { remaining: number },
): CodexFileCitationParse {
  const prefixLength = citationPrefixLength(source, start);
  if (!prefixLength) return null;
  const limit = Math.min(source.length, start + MAX_DIRECTIVE_SOURCE);
  const closing = closingBrace(source, start + prefixLength, limit, budget);
  if (closing < 0) return { kind: 'literal', rawLength: source.length - start };
  const rawLength = closing + 1 - start;
  const attributes = parseAttributes(source, start + prefixLength, closing);
  const path = attributes?.get('path');
  if (!path?.value) return { kind: 'literal', rawLength };
  return {
    kind: 'citation',
    citation: { rawLength, path: path.value, pathSourceOffset: path.sourceOffset },
  };
}

function citationPrefixLength(source: string, start: number) {
  if (start > 0 && source[start - 1] === ':') return 0;
  let cursor = start;
  while (cursor < source.length && source[cursor] === ':' && cursor - start < 3) cursor += 1;
  if (cursor === start || source[cursor] === ':') return 0;
  const prefix = `${DIRECTIVE_NAME}{`;
  return source.startsWith(prefix, cursor) ? cursor - start + prefix.length : 0;
}

function closingBrace(source: string, start: number, limit: number, budget: { remaining: number }) {
  let quote = '';
  for (let cursor = start; cursor < limit; cursor += 1) {
    if (budget.remaining <= 0) return -1;
    budget.remaining -= 1;
    const character = source[cursor] ?? '';
    if (quote) {
      if (character === quote) quote = '';
      continue;
    }
    if (character === '"' || character === "'") quote = character;
    else if (character === '}') return cursor;
  }
  return -1;
}

function parseAttributes(source: string, start: number, end: number) {
  const attributes = new Map<string, { value: string; sourceOffset: number }>();
  let cursor = start;
  while (cursor < end) {
    while (cursor < end && isSpace(source[cursor])) cursor += 1;
    if (cursor >= end) break;
    const keyStart = cursor;
    while (cursor < end && isNameCharacter(source[cursor])) cursor += 1;
    const key = source.slice(keyStart, cursor);
    if (!key || attributes.has(key)) return null;
    while (cursor < end && isSpace(source[cursor])) cursor += 1;
    if (source[cursor] !== '=') return null;
    cursor += 1;
    while (cursor < end && isSpace(source[cursor])) cursor += 1;
    const quote = source[cursor] === '"' || source[cursor] === "'" ? source[cursor] : '';
    if (quote) cursor += 1;
    const valueStart = cursor;
    if (quote) {
      while (cursor < end && source[cursor] !== quote) cursor += 1;
      if (source[cursor] !== quote) return null;
    } else {
      while (cursor < end && !isSpace(source[cursor])) cursor += 1;
    }
    if (cursor === valueStart) return null;
    attributes.set(key, { value: source.slice(valueStart, cursor), sourceOffset: valueStart });
    if (quote) cursor += 1;
  }
  return attributes;
}

function isSpace(character: string | undefined) { return character === ' ' || character === '\t'; }
function isNameCharacter(character: string | undefined) { return Boolean(character && /[A-Za-z0-9_-]/.test(character)); }
