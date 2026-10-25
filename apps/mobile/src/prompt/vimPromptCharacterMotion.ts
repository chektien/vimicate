export type PromptFindMotion = 'f' | 'F' | 't' | 'T';

export function isPromptFindMotion(value: string): value is PromptFindMotion {
  return value === 'f' || value === 'F' || value === 't' || value === 'T';
}

export function promptFindDestination(text: string, cursor: number, target: string, motion: PromptFindMotion, count: number) {
  const found = promptFindCharacter(text, cursor, target, motion, count);
  if (found === null) return null;
  if (motion === 't') return found - 1;
  if (motion === 'T') return found + 1;
  return found;
}

export function promptFindOperatorMotion(text: string, cursor: number, target: string, motion: PromptFindMotion, count: number) {
  const found = promptFindCharacter(text, cursor, target, motion, count);
  if (found === null) return null;
  if (motion === 'f') return { start: cursor, end: found + 1 };
  if (motion === 't') return { start: cursor, end: found };
  if (motion === 'F') return { start: found, end: cursor + 1 };
  return { start: found + 1, end: cursor + 1 };
}

function promptFindCharacter(text: string, cursor: number, target: string, motion: PromptFindMotion, count: number) {
  if (target.length !== 1) return null;
  const bounds = lineBounds(text, cursor); const forward = motion === 'f' || motion === 't';
  let found = cursor;
  for (let index = 0; index < count; index += 1) {
    found = forward ? text.indexOf(target, found + 1) : text.lastIndexOf(target, found - 1);
    if (found < bounds.start || found >= bounds.end) return null;
  }
  return found;
}

function lineBounds(text: string, cursor: number) {
  const safe = Math.max(0, Math.min(cursor, text.length)); const start = text.lastIndexOf('\n', Math.max(0, safe - 1)) + 1;
  const next = text.indexOf('\n', safe); return { start, end: next === -1 ? text.length : next };
}
