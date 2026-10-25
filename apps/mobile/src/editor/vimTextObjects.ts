export type TextObjectRange = { start: number; end: number };

export function textObjectRange(text: string, cursor: number, object: string, around: boolean): TextObjectRange | null {
  if (!text) return null;
  const safe = Math.max(0, Math.min(text.length - 1, cursor));
  if (object === 'w' || object === 'W') {
    const words = object === 'W' ? [...text.matchAll(/\S+/g)] : [...text.matchAll(/\w+|[^\w\s]+/g)];
    const match = words.find((candidate) => {
      const start = candidate.index ?? 0;
      return safe >= start && safe < start + candidate[0].length;
    }) ?? words.find((candidate) => (candidate.index ?? 0) > safe);
    if (!match) return null;
    let start = match.index ?? 0;
    let end = start + match[0].length - 1;
    if (around) {
      const trailing = text.slice(end + 1).match(/^\s+/)?.[0].length ?? 0;
      if (trailing) end += trailing;
      else start -= text.slice(0, start).match(/\s+$/)?.[0].length ?? 0;
    }
    return { start, end };
  }
  const pair = delimiterPair(object);
  if (!pair) return null;
  const bounds = pair.open === pair.close
    ? enclosingQuote(text, safe, pair.open)
    : enclosingDelimiters(text, safe, pair.open, pair.close);
  if (!bounds) return null;
  const start = around ? bounds.start : bounds.start + 1;
  const end = around ? bounds.end : bounds.end - 1;
  return end < start ? null : { start, end };
}

function delimiterPair(object: string) {
  if (object === '[' || object === ']') return { open: '[', close: ']' };
  if (object === '(' || object === ')' || object === 'b') return { open: '(', close: ')' };
  if (object === '{' || object === '}' || object === 'B') return { open: '{', close: '}' };
  if (object === '<' || object === '>') return { open: '<', close: '>' };
  if (object === '"' || object === "'" || object === '`') return { open: object, close: object };
  return null;
}

function enclosingQuote(text: string, cursor: number, quote: string) {
  const start = text.lastIndexOf(quote, cursor);
  const end = text.indexOf(quote, Math.max(cursor + 1, start + 1));
  return start >= 0 && end > start ? { start, end } : null;
}

function enclosingDelimiters(text: string, cursor: number, open: string, close: string) {
  let depth = 0;
  let start = -1;
  for (let index = Math.min(cursor, text.length - 1); index >= 0; index -= 1) {
    if (text[index] === close) depth += 1;
    else if (text[index] === open) {
      if (depth === 0) { start = index; break; }
      depth -= 1;
    }
  }
  if (start < 0) return null;
  depth = 0;
  for (let index = start; index < text.length; index += 1) {
    if (text[index] === open) depth += 1;
    else if (text[index] === close) {
      depth -= 1;
      if (depth === 0) return index >= cursor ? { start, end: index } : null;
    }
  }
  return null;
}
