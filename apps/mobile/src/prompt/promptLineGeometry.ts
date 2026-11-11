/** Logical lines are independent of UIKit's wrapped display rows. */
export function lineBounds(text: string, cursor: number) {
  const safe = Math.max(0, Math.min(cursor, text.length));
  const start = safe === 0 ? 0 : text.lastIndexOf('\n', safe - 1) + 1;
  const next = text.indexOf('\n', safe);
  return { start, end: next === -1 ? text.length : next };
}

export function lineRange(text: string, cursor: number, count: number) {
  const first = lineBounds(text, cursor);
  let end = first.end;
  for (let i = 1; i < count && end < text.length; i += 1) end = lineBounds(text, end + 1).end;
  // A delimiter at EOF and the empty logical line after it share an offset.
  // Retain which line was selected before including its trailing delimiter.
  return { start: first.start, end: end < text.length ? end + 1 : end, includesFinalLine: end === text.length };
}

export function firstNonBlank(text: string, cursor: number) {
  const bounds = lineBounds(text, cursor);
  return bounds.start + (text.slice(bounds.start, bounds.end).match(/^\s*/)?.[0].length ?? 0);
}

export function lineLastCursor(bounds: { start: number; end: number }) {
  return bounds.end > bounds.start ? bounds.end - 1 : bounds.start;
}

export function horizontalCursor(text: string, cursor: number, direction: -1 | 1) {
  const bounds = lineBounds(text, cursor);
  if (direction < 0) {
    if (cursor > bounds.start) return cursor - 1;
    if (bounds.start <= 0) return 0;
    return lineLastCursor(lineBounds(text, bounds.start - 1));
  }
  const last = lineLastCursor(bounds);
  if (cursor < last) return cursor + 1;
  if (bounds.end >= text.length) return last;
  return lineBounds(text, bounds.end + 1).start;
}
