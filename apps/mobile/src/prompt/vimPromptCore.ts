import { normalizedHardwareKey } from '../keyboard/hardwareKey';
import { promptControlEffect } from './promptControlEffect';
import { textObjectRange } from '../editor/vimTextObjects';
import { isPromptFindMotion, promptFindDestination, promptFindOperatorMotion } from './vimPromptCharacterMotion';
import { promptKeyIsCount, promptOperator, type PromptOperator, type PromptPending } from './promptCommand';

export type VimMode = 'normal' | 'insert';
export type PromptVisualMode = 'character' | 'line' | 'block';
export type Selection = { start: number; end: number };
type Snapshot = { text: string; selection: Selection };
type PromptRegisterKind = 'character' | 'line';

export type PromptState = Snapshot & {
  authority: number;
  mode: VimMode;
  pending: PromptPending;
  count: string;
  operatorCount: number;
  register: string;
  registerKind: PromptRegisterKind;
  registerRevision: number;
  undo: Snapshot[];
  redo: Snapshot[];
  visualMode: PromptVisualMode | null;
  visualAnchor: number | null;
  visualCursor: number | null;
};

export type VimKey = { key: string; shift?: boolean; control?: boolean; option?: boolean; command?: boolean };
export type PromptEffect = 'none' | 'submit' | 'history-previous' | 'history-next' | 'focus-transcript' | 'half-page-up' | 'half-page-down';
export type PromptResult = { state: PromptState; effect: PromptEffect };

export function createPromptState(text = ''): PromptState {
  return { text, selection: collapsed(text.length), authority: 0, mode: 'normal', pending: '', count: '', operatorCount: 1, register: '', registerKind: 'character', registerRevision: 0, undo: [], redo: [], visualMode: null, visualAnchor: null, visualCursor: null };
}

export function movePromptSearchCursor(state: PromptState, cursor: number): PromptState {
  return state.visualMode ? moveVisual(state, cursor) : move(state, cursor);
}

export function promptClipboardText(previous: PromptState, next: PromptState) {
  return next.registerRevision !== previous.registerRevision && next.register ? next.register : null;
}

export function acceptNativeText(state: PromptState, text: string, selection: Selection, textAuthority = state.authority): PromptState {
  // Native text callbacks are queued independently from controlled Vim
  // commits. A paste callback can therefore arrive after a later `u`. Only
  // the native text generation that still owns this JS buffer may edit it.
  if (textAuthority !== state.authority) return state;
  if (state.text === text && equalSelection(state.selection, selection)) return state;
  if (state.text === text) return { ...state, selection: clampSelection(text, selection) };
  return { ...state, text, selection: clampSelection(text, selection), pending: '', count: '', operatorCount: 1, undo: [...state.undo.slice(-99), snapshot(state)], redo: [] };
}

export function setNativeSelection(state: PromptState, selection: Selection): PromptState {
  const next = clampSelection(state.text, selection);
  // UIKit may acknowledge the same controlled selection more than once while
  // focus is settling or the prompt is cleared after Send. Returning a fresh
  // state for that acknowledgement republishes the same selection back over
  // the bridge and can form a native <-> React update cycle. Identity is part
  // of the bridge contract: unchanged selection means unchanged state.
  if (equalSelection(state.selection, next)) return state;
  return { ...state, selection: next };
}

export function acceptNativeSelection(state: PromptState, selection: Selection, userInitiated: boolean): PromptState {
  // UIKit may emit passive caret corrections after layout, focus, or a
  // controlled text assignment. Those callbacks must never outrank the Vim
  // cursor in Normal/Visual mode. Insert editing and a real touch-selection
  // window remain native-owned so selection handles continue to work.
  if (state.mode !== 'insert' && !userInitiated) return state;
  return setNativeSelection(state, selection);
}

export function enterPromptInsertMode(state: PromptState): PromptState {
  if (state.mode === 'insert' && !state.pending && !state.count && !state.visualMode) return state;
  const cursor = promptCursor(state);
  return { ...state, mode: 'insert', selection: collapsed(cursor), pending: '', count: '', operatorCount: 1, visualMode: null, visualAnchor: null, visualCursor: null };
}

export function insertPromptHandoff(state: PromptState, text: string, caretOffset: number): PromptState {
  if (!text) return state;
  const selection = clampSelection(state.text, state.selection);
  const nextText = state.text.slice(0, selection.start) + text + state.text.slice(selection.end);
  const caret = selection.start + Math.max(0, Math.min(text.length, caretOffset));
  return {
    ...state,
    authority: state.authority + 1,
    text: nextText,
    selection: collapsed(caret),
    mode: 'insert',
    pending: '',
    count: '',
    operatorCount: 1,
    undo: [...state.undo.slice(-99), snapshot(state)],
    redo: [],
    visualMode: null,
    visualAnchor: null,
    visualCursor: null,
  };
}

/**
 * Covers the single-key window where JS has entered Insert but UIKit has not
 * received the new mode prop yet. In steady Insert mode UIKit owns text input,
 * so plain keys never arrive through the hardware-key event channel.
 */
export function applyBridgedNativeInsert(state: PromptState, input: VimKey): PromptState | null {
  if (state.mode !== 'insert' || input.control || input.command || input.option) return null;
  const key = normalizedHardwareKey(input);
  if (key === 'backspace') {
    const selection = clampSelection(state.text, state.selection);
    const start = selection.start === selection.end ? Math.max(0, selection.start - 1) : selection.start;
    return replaceRangeWithUndo(state, start, selection.end, '');
  }
  if (key === 'delete') {
    const selection = clampSelection(state.text, state.selection);
    const end = selection.start === selection.end ? Math.min(state.text.length, selection.end + 1) : selection.end;
    return replaceRangeWithUndo(state, selection.start, end, '');
  }
  const value = key === 'enter' ? '\n' : key === 'tab' ? '\t' : key.length === 1 ? key : '';
  if (!value) return null;
  const selection = clampSelection(state.text, state.selection);
  return replaceRangeWithUndo(state, selection.start, selection.end, value);
}

export function handlePromptKey(state: PromptState, input: VimKey): PromptResult {
  const key = normalizedHardwareKey(input);
  if (!key) return done(state);
  if (state.mode === 'insert') {
    if (key === 'escape' || (input.control && key === '[')) {
      return done({ ...state, mode: 'normal', selection: collapsed(Math.max(0, state.selection.end - 1)), pending: '', count: '', operatorCount: 1, visualMode: null, visualAnchor: null, visualCursor: null });
    }
    return done(state);
  }

  const effect = promptControlEffect(input, key, Boolean(state.visualMode));
  if (effect === 'ignore') return done(state);
  if (effect) return { state: effect === 'half-page-up' || effect === 'half-page-down' ? { ...state, pending: '', count: '', operatorCount: 1 } : state, effect };
  if (state.visualMode) return handlePromptVisualKey(state, input, key);
  if (key === 'escape' || (input.control && key === '[')) return done({ ...state, pending: '', count: '', operatorCount: 1 });
  if (input.control && key.toLowerCase() === 'r') return done(redo(state));
  if (input.control && key.toLowerCase() === 'v') return done(enterVisual(state, 'block'));
  if (key === 'enter') return { state: { ...state, pending: '', count: '', operatorCount: 1 }, effect: 'submit' };

  if (promptKeyIsCount(state, key)) return done({ ...state, count: `${state.count}${key}` });
  const repetitions = Math.max(1, Number(state.count || '1'));
  const clean = (next: PromptState) => ({ ...next, count: '', operatorCount: 1, pending: '' as const });

  if (state.pending) {
    if (state.pending === 'g' && key === 'g') return done(clean(move(state, firstNonBlank(state.text, 0))));
    if (state.pending === 'r') {
      if (key.length !== 1 || state.selection.end >= state.text.length) return done(clean(state));
      const end = Math.min(lineBounds(state.text, state.selection.end).end, state.selection.end + repetitions);
      const next = replaceRangeWithUndo(state, state.selection.end, end, key.repeat(end - state.selection.end));
      return done(clean({ ...next, selection: collapsed(Math.max(state.selection.end, end - 1)) }));
    }
    if (isPromptFindMotion(state.pending)) {
      const destination = promptFindDestination(state.text, state.selection.end, key, state.pending, repetitions);
      return done(clean(destination === null ? state : move(state, destination)));
    }
    const operator = promptOperator(state.pending);
    const operatorRepetitions = repetitions * state.operatorCount;
    if (operator && state.pending.length === 2) {
      const suffix = state.pending[1] ?? '';
      if (isPromptFindMotion(suffix)) {
        const range = promptFindOperatorMotion(state.text, state.selection.end, key, suffix, operatorRepetitions);
        return done(clean(range ? applyPromptOperator(state, operator, range.start, range.end) : state));
      }
      if (suffix === 'g' && key === 'g') {
        const current = lineBounds(state.text, state.selection.end);
        return done(clean(applyPromptLineOperator(state, operator, 0, current.end < state.text.length ? current.end + 1 : current.end)));
      }
      if (suffix === 'i' || suffix === 'a') {
        const object = promptTextObject(state.text, state.selection.end, key, suffix === 'a');
        return done(clean(object ? applyPromptOperator(state, operator, object.start, object.end + 1) : state));
      }
      return done(clean(state));
    }
    if (operator && state.pending === key) {
      const bounds = lineRange(state.text, state.selection.end, operatorRepetitions);
      return done(clean(applyPromptLineOperator(state, operator, bounds.start, bounds.end)));
    }
    if (operator && (key === 'i' || key === 'a' || key === 'g')) {
      return done({ ...state, pending: `${operator}${key}` as PromptPending });
    }
    if (operator && isPromptFindMotion(key)) return done({ ...state, pending: `${operator}${key}`, count: state.count });
    if (operator) {
      const range = promptOperatorMotion(state, key, operatorRepetitions);
      if (!range) return done(clean(state));
      if (operator === 'c' && (key === 'w' || key === 'W') && !/\s/.test(state.text[state.selection.end] ?? '')) {
        const changeRange = promptChangeWordRange(state, operatorRepetitions, key === 'W');
        return done(clean(applyPromptOperator(state, operator, changeRange.start, changeRange.end)));
      }
      return done(clean(range.linewise
        ? applyPromptLineOperator(state, operator, range.start, range.end)
        : applyPromptOperator(state, operator, range.start, range.end)));
    }
    return done({ ...state, pending: '', count: '', operatorCount: 1 });
  }

  if (key === 'g') return done({ ...state, pending: key, count: state.count });
  if (isPromptFindMotion(key)) return done({ ...state, pending: key, count: state.count });
  if (key === 'd' || key === 'c' || key === 'y') return done({ ...state, pending: key, count: '', operatorCount: repetitions });
  if (key === 'v') return done(enterVisual(state, 'character'));
  if (key === 'V') return done(enterVisual(state, 'line'));
  if (key === 'r') return done({ ...state, pending: 'r', count: state.count });
  if (key === 'u') return done(clean(undo(state)));
  if (key === ':') return done(clean(replaceRangeWithUndo({ ...state, mode: 'insert' }, state.text.length, state.text.length, state.text ? '\n:' : ':')));
  if (key === 'i') return done(clean({ ...state, mode: 'insert' }));
  if (key === 'a') return done(clean({ ...state, mode: 'insert', selection: collapsed(Math.min(lineBounds(state.text, state.selection.end).end, state.selection.end + 1)) }));
  if (key === 'I') return done(clean({ ...state, mode: 'insert', selection: collapsed(firstNonBlank(state.text, state.selection.end)) }));
  if (key === 'A') return done(clean({ ...state, mode: 'insert', selection: collapsed(lineBounds(state.text, state.selection.end).end) }));
  if (key === 'o' || key === 'O') {
    const bounds = lineBounds(state.text, state.selection.end);
    const at = key === 'o' ? bounds.end : bounds.start;
    const insertion = key === 'o' ? '\n' : '\n';
    const next = replaceRangeWithUndo({ ...state, mode: 'insert' }, at, at, insertion);
    return done(clean({ ...next, selection: collapsed(key === 'o' ? at + 1 : at) }));
  }
  if (key === '0') return done(clean(move(state, lineBounds(state.text, state.selection.end).start)));
  if (key === '^') return done(clean(move(state, firstNonBlank(state.text, state.selection.end))));
  if (key === '$') return done(clean(move(state, lineLastCursor(lineBounds(state.text, state.selection.end)))));
  if (key === 'G') return done(clean(move(state, firstNonBlank(state.text, state.text.length))));
  if (key === 'h' || key === 'left') return done(clean(repeatMove(state, repetitions, (s) => horizontal(s, -1))));
  if (key === 'l' || key === 'right') return done(clean(repeatMove(state, repetitions, (s) => horizontal(s, 1))));
  if (key === 'j' || key === 'down') {
    if (lineBounds(state.text, state.selection.end).end === state.text.length) return done(clean(state));
    return done(clean(repeatMove(state, repetitions, (s) => vertical(s, 1))));
  }
  if (key === 'k' || key === 'up') {
    if (lineBounds(state.text, state.selection.end).start === 0) return done(clean(state));
    return done(clean(repeatMove(state, repetitions, (s) => vertical(s, -1))));
  }
  if (key === 'w' || key === 'W') return done(clean(repeatMove(state, repetitions, key === 'W' ? WORDForward : wordForward)));
  if (key === 'b' || key === 'B') return done(clean(repeatMove(state, repetitions, key === 'B' ? WORDBackward : wordBackward)));
  if (key === 'e' || key === 'E') return done(clean(repeatMove(state, repetitions, key === 'E' ? WORDEnd : wordEnd)));
  if (key === 'x' || key === 'delete') {
    const end = Math.min(lineBounds(state.text, state.selection.end).end, state.selection.end + repetitions);
    const register = state.text.slice(state.selection.end, end);
    const next = replaceRangeWithUndo(state, state.selection.end, end, '');
    return done(clean(register ? publishRegister(next, register) : next));
  }
  if (key === 'X') {
    const start = Math.max(lineBounds(state.text, state.selection.end).start, state.selection.end - repetitions);
    const register = state.text.slice(start, state.selection.end);
    const next = replaceRangeWithUndo(state, start, state.selection.end, '');
    return done(clean(register ? publishRegister(next, register) : next));
  }
  if (key === 's') {
    const end = Math.min(lineBounds(state.text, state.selection.end).end, state.selection.end + repetitions);
    return done(clean(applyPromptOperator(state, 'c', state.selection.end, end)));
  }
  if (key === 'S') {
    const bounds = lineRange(state.text, state.selection.end, repetitions);
    return done(clean(applyPromptLineOperator(state, 'c', bounds.start, bounds.end)));
  }
  if (key === 'Y') {
    const bounds = lineRange(state.text, state.selection.end, repetitions);
    return done(clean(applyPromptLineOperator(state, 'y', bounds.start, bounds.end)));
  }
  if (key === 'J') {
    const bounds = lineBounds(state.text, state.selection.end);
    if (bounds.end >= state.text.length) return done(clean(state));
    const following = lineBounds(state.text, bounds.end + 1);
    const whitespaceEnd = firstNonBlank(state.text, following.start);
    return done(clean(replaceRangeWithUndo(state, bounds.end, whitespaceEnd, ' ')));
  }
  if (key === '~') {
    const end = Math.min(lineBounds(state.text, state.selection.end).end, state.selection.end + repetitions);
    const source = state.text.slice(state.selection.end, end);
    const swapped = [...source].map((character) => character === character.toUpperCase() ? character.toLowerCase() : character.toUpperCase()).join('');
    return done(clean(replaceRangeWithUndo(state, state.selection.end, end, swapped)));
  }
  if (key === 'D' || key === 'C') {
    const end = lineBounds(state.text, state.selection.end).end;
    return done(clean(applyPromptOperator(state, key === 'C' ? 'c' : 'd', state.selection.end, end)));
  }
  if (key === 'p' || key === 'P') {
    if (!state.register) return done(clean(state));
    if (state.registerKind === 'line') {
      const bounds = lineBounds(state.text, state.selection.end);
      const content = state.register.replace(/\n$/, '');
      // A byte-empty buffer and a draft containing only empty/whitespace rows
      // are the same user-visible empty prompt. Prefixing the usual "paste
      // below" newline in either case creates a phantom first row, so pasted
      // content starts at 2:1 and `k` appears unable to reach useful text.
      if (!state.text.trim()) {
        const insertion = Array.from({ length: repetitions }, () => content).join('\n');
        const next = replaceRangeWithUndo(state, 0, state.text.length, insertion);
        return done(clean({ ...next, selection: collapsed(0) }));
      }
      const at = key === 'P' ? bounds.start : bounds.end;
      const insertion = key === 'P'
        ? `${content}\n`
        : bounds.end < state.text.length ? `\n${content}` : `\n${content}`;
      const next = replaceRangeWithUndo(state, at, at, insertion.repeat(repetitions));
      const cursor = key === 'P' ? at : at + 1;
      return done(clean({ ...next, selection: collapsed(cursor) }));
    }
    const at = key === 'p' ? Math.min(state.text.length, state.selection.end + 1) : state.selection.end;
    const next = replaceRangeWithUndo(state, at, at, state.register.repeat(repetitions));
    return done(clean({ ...next, selection: collapsed(Math.max(at, at + state.register.length * repetitions - 1)) }));
  }
  return done({ ...state, count: '', operatorCount: 1 });
}

function done(state: PromptState): PromptResult { return { state, effect: 'none' }; }
function collapsed(value: number): Selection { return { start: value, end: value }; }
function equalSelection(a: Selection, b: Selection) { return a.start === b.start && a.end === b.end; }
function clampSelection(text: string, selection: Selection) { const start = Math.max(0, Math.min(selection.start, text.length)); const end = Math.max(start, Math.min(selection.end, text.length)); return { start, end }; }
function move(state: PromptState, cursor: number): PromptState { return { ...state, selection: collapsed(Math.max(0, Math.min(cursor, state.text.length))) }; }
function promptCursor(state: PromptState) { return state.visualCursor ?? state.selection.end; }
function snapshot(state: PromptState): Snapshot { return { text: state.text, selection: state.selection }; }
function replaceRangeWithUndo(state: PromptState, start: number, end: number, value: string): PromptState {
  const text = state.text.slice(0, start) + value + state.text.slice(end);
  return { ...state, authority: state.authority + 1, text, selection: collapsed(start + value.length), undo: [...state.undo.slice(-99), snapshot(state)], redo: [] };
}
function undo(state: PromptState): PromptState { const previous = state.undo.at(-1); return previous ? { ...state, ...previous, authority: state.authority + 1, undo: state.undo.slice(0, -1), redo: [...state.redo, snapshot(state)] } : state; }
function redo(state: PromptState): PromptState { const next = state.redo.at(-1); return next ? { ...state, ...next, authority: state.authority + 1, undo: [...state.undo, snapshot(state)], redo: state.redo.slice(0, -1) } : state; }
function lineBounds(text: string, cursor: number) { const safe = Math.max(0, Math.min(cursor, text.length)); const start = safe === 0 ? 0 : text.lastIndexOf('\n', safe - 1) + 1; const next = text.indexOf('\n', safe); return { start, end: next === -1 ? text.length : next }; }
function lineRange(text: string, cursor: number, count: number) { const first = lineBounds(text, cursor); let end = first.end; for (let i = 1; i < count && end < text.length; i += 1) end = lineBounds(text, end + 1).end; if (end < text.length) end += 1; return { start: first.start, end }; }
function firstNonBlank(text: string, cursor: number) { const bounds = lineBounds(text, cursor); return bounds.start + (text.slice(bounds.start, bounds.end).match(/^\s*/)?.[0].length ?? 0); }
function horizontal(state: PromptState, delta: number) { return move(state, horizontalCursor(state.text, state.selection.end, delta < 0 ? -1 : 1)); }
function horizontalCursor(text: string, cursor: number, direction: -1 | 1) {
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
function vertical(state: PromptState, delta: number) { const bounds = lineBounds(state.text, state.selection.end); const column = state.selection.end - bounds.start; const probe = delta > 0 ? Math.min(state.text.length, bounds.end + 1) : Math.max(0, bounds.start - 1); const target = lineBounds(state.text, probe); return move(state, Math.min(lineLastCursor(target), target.start + column)); }
function repeatMove(state: PromptState, count: number, motion: (value: PromptState) => PromptState) { let next = state; for (let index = 0; index < count; index += 1) next = motion(next); return next; }
function lineLastCursor(bounds: { start: number; end: number }) { return bounds.end > bounds.start ? bounds.end - 1 : bounds.start; }
function wordRanges(text: string, big = false) { return [...text.matchAll(big ? /\S+/g : /\w+|[^\w\s]+/g)].map((match) => ({ start: match.index, end: match.index + match[0].length - 1 })); }
function nextWordStart(text: string, cursor: number, big = false) { return wordRanges(text, big).find((word) => word.start > cursor)?.start; }
function wordForwardBy(state: PromptState, big: boolean) { return move(state, nextWordStart(state.text, state.selection.end, big) ?? Math.max(0, state.text.length - 1)); }
function wordBackwardBy(state: PromptState, big: boolean) { return move(state, wordRanges(state.text, big).filter((word) => word.start < state.selection.end).at(-1)?.start ?? 0); }
function wordEndBy(state: PromptState, big: boolean) { return move(state, wordRanges(state.text, big).find((word) => word.end > state.selection.end)?.end ?? Math.max(0, state.text.length - 1)); }
function wordForward(state: PromptState) { return wordForwardBy(state, false); }
function WORDForward(state: PromptState) { return wordForwardBy(state, true); }
function wordBackward(state: PromptState) { return wordBackwardBy(state, false); }
function WORDBackward(state: PromptState) { return wordBackwardBy(state, true); }
function wordEnd(state: PromptState) { return wordEndBy(state, false); }
function WORDEnd(state: PromptState) { return wordEndBy(state, true); }

function applyPromptOperator(state: PromptState, operator: PromptOperator, rawStart: number, rawEnd: number): PromptState {
  const start = Math.max(0, Math.min(rawStart, rawEnd, state.text.length));
  const end = Math.max(start, Math.min(Math.max(rawStart, rawEnd), state.text.length));
  const register = state.text.slice(start, end);
  if (!register) return operator === 'c' ? { ...state, mode: 'insert' } : state;
  if (operator === 'y') return publishRegister({ ...state, selection: collapsed(Math.min(state.selection.end, state.text.length)) }, register);
  const next = replaceRangeWithUndo(state, start, end, '');
  return { ...publishRegister(next, register), mode: operator === 'c' ? 'insert' : 'normal' };
}

function applyPromptLineOperator(state: PromptState, operator: PromptOperator, start: number, end: number): PromptState {
  if (operator !== 'c') {
    const next = applyPromptOperator(state, operator, start, end);
    return next.registerRevision === state.registerRevision ? next : { ...next, registerKind: 'line' };
  }
  const register = state.text.slice(start, end);
  if (!register) return { ...state, mode: 'insert' };
  const replacement = end < state.text.length || register.endsWith('\n') ? '\n' : '';
  const next = replaceRangeWithUndo(state, start, end, replacement);
  return { ...publishRegister(next, register, 'line'), mode: 'insert', selection: collapsed(start) };
}

function publishRegister(state: PromptState, register: string, registerKind: PromptRegisterKind = 'character'): PromptState {
  return { ...state, register, registerKind, registerRevision: state.registerRevision + 1 };
}

function promptChangeWordRange(state: PromptState, count: number, big: boolean) {
  const cursor = state.selection.end;
  let end = cursor;
  let remaining = count;
  for (const word of wordRanges(state.text, big)) {
    if (word.end < cursor) continue;
    end = word.end + 1;
    remaining -= 1;
    if (remaining === 0) break;
  }
  return { start: cursor, end };
}

function promptOperatorMotion(state: PromptState, key: string, count: number): { start: number; end: number; linewise?: boolean } | null {
  const cursor = state.selection.end;
  const bounds = lineBounds(state.text, cursor);
  if (key === 'h' || key === 'left') return { start: Math.max(bounds.start, cursor - count), end: cursor };
  if (key === 'l' || key === 'right') return { start: cursor, end: Math.min(bounds.end, cursor + count) };
  if (key === '0') return { start: bounds.start, end: cursor };
  if (key === '^') return { start: firstNonBlank(state.text, cursor), end: cursor };
  if (key === '$') return { start: cursor, end: bounds.end };
  if (key === 'G') return { start: bounds.start, end: state.text.length, linewise: true };
  if (key === 'w' || key === 'W') {
    const big = key === 'W';
    let destination = cursor;
    for (let index = 0; index < count; index += 1) {
      const next = nextWordStart(state.text, destination, big);
      if (next === undefined) { destination = state.text.length; break; }
      destination = next;
    }
    if (count === 1 && destination > bounds.end) destination = bounds.end;
    return { start: cursor, end: destination };
  }
  if (key === 'e' || key === 'E') return { start: cursor, end: Math.min(state.text.length, repeatMove(state, count, key === 'E' ? WORDEnd : wordEnd).selection.end + 1) };
  if (key === 'b' || key === 'B') return { start: repeatMove(state, count, key === 'B' ? WORDBackward : wordBackward).selection.end, end: cursor };
  if (key === 'j' || key === 'down') {
    let end = bounds.end;
    for (let index = 0; index < count && end < state.text.length; index += 1) end = lineBounds(state.text, end + 1).end;
    return { start: bounds.start, end: end < state.text.length ? end + 1 : end, linewise: true };
  }
  if (key === 'k' || key === 'up') {
    let start = bounds.start;
    for (let index = 0; index < count && start > 0; index += 1) start = lineBounds(state.text, start - 1).start;
    return { start, end: bounds.end < state.text.length ? bounds.end + 1 : bounds.end, linewise: true };
  }
  return null;
}

function promptTextObject(text: string, cursor: number, object: string, around: boolean) {
  const bounds = lineBounds(text, cursor);
  const local = textObjectRange(text.slice(bounds.start, bounds.end), cursor - bounds.start, object, around);
  return local ? { start: bounds.start + local.start, end: bounds.start + local.end } : null;
}

function handlePromptVisualKey(state: PromptState, input: VimKey, key: string): PromptResult {
  const clean = (next: PromptState) => ({ ...next, count: '', operatorCount: 1, pending: '' as const });
  if (key === 'escape' || (input.control && key === '[')) return done(clean(exitVisual(state)));
  if (input.control && key.toLowerCase() === 'v') return done(clean(state.visualMode === 'block' ? exitVisual(state) : enterVisual(state, 'block')));
  if (key === 'v') return done(clean(state.visualMode === 'character' ? exitVisual(state) : enterVisual(state, 'character')));
  if (key === 'V') return done(clean(state.visualMode === 'line' ? exitVisual(state) : enterVisual(state, 'line')));
  if (/^[1-9]$/.test(key) || (key === '0' && state.count)) return done({ ...state, count: `${state.count}${key}` });
  const repetitions = Math.max(1, Number(state.count || '1'));
  if (state.pending === 'g') {
    if (key === 'g') return done(clean(moveVisual(state, 0)));
    return done(clean(state));
  }
  if (key === 'g') return done({ ...state, pending: 'g' });
  if (key === 'o') {
    const anchor = state.visualAnchor ?? promptCursor(state); const cursor = promptCursor(state);
    return done(clean(withVisualSelection({ ...state, visualAnchor: cursor, visualCursor: anchor })));
  }
  if (key === 'y' || key === 'd' || key === 'x' || key === 'c' || key === 's') {
    const range = clampSelection(state.text, state.selection); const register = state.text.slice(range.start, range.end);
    if (!register) return done(clean(exitVisual(state)));
    if (key === 'y') return done(clean(publishRegister({ ...exitVisual(state), selection: collapsed(range.start) }, register, state.visualMode === 'line' ? 'line' : 'character')));
    if ((key === 'c' || key === 's') && state.visualMode === 'line') {
      return done(clean(applyPromptLineOperator(exitVisual(state), 'c', range.start, range.end)));
    }
    const next = publishRegister(replaceRangeWithUndo(exitVisual(state), range.start, range.end, ''), register, state.visualMode === 'line' ? 'line' : 'character');
    return done(clean({ ...next, mode: key === 'c' || key === 's' ? 'insert' : 'normal' }));
  }
  if (key === 'p' || key === 'P') {
    const range = clampSelection(state.text, state.selection); const replaced = state.text.slice(range.start, range.end);
    const next = replaceRangeWithUndo(exitVisual(state), range.start, range.end, state.register.repeat(repetitions));
    return done(clean({ ...(replaced ? publishRegister(next, replaced, state.visualMode === 'line' ? 'line' : 'character') : next), selection: collapsed(Math.max(range.start, range.start + state.register.length * repetitions - 1)) }));
  }
  if (key === '~') {
    const range = clampSelection(state.text, state.selection); const source = state.text.slice(range.start, range.end);
    const swapped = [...source].map((character) => character === character.toUpperCase() ? character.toLowerCase() : character.toUpperCase()).join('');
    const next = replaceRangeWithUndo(exitVisual(state), range.start, range.end, swapped);
    return done(clean({ ...next, selection: collapsed(range.start) }));
  }
  const destination = visualMotionDestination(state, key, repetitions);
  return destination === null ? done({ ...state, count: '', pending: '', operatorCount: 1 }) : done(clean(moveVisual(state, destination)));
}

function enterVisual(state: PromptState, mode: PromptVisualMode) {
  const cursor = promptCursor(state); const anchor = state.visualAnchor ?? cursor;
  return withVisualSelection({ ...state, mode: 'normal' as const, visualMode: mode, visualAnchor: anchor, visualCursor: cursor, pending: '' as const, count: '', operatorCount: 1 });
}

function exitVisual(state: PromptState) {
  const cursor = promptCursor(state);
  return { ...state, selection: collapsed(Math.max(0, Math.min(cursor, state.text.length))), visualMode: null, visualAnchor: null, visualCursor: null };
}

function moveVisual(state: PromptState, cursor: number) {
  return withVisualSelection({ ...state, visualCursor: Math.max(0, Math.min(cursor, state.text.length)) });
}

function withVisualSelection(state: PromptState): PromptState {
  const anchor = state.visualAnchor ?? state.selection.end; const cursor = state.visualCursor ?? state.selection.end;
  if (state.visualMode === 'line') {
    const first = lineBounds(state.text, Math.min(anchor, cursor)); const last = lineBounds(state.text, Math.max(anchor, cursor));
    return { ...state, selection: { start: first.start, end: last.end < state.text.length ? last.end + 1 : last.end } };
  }
  const start = Math.min(anchor, cursor); const furthest = Math.max(anchor, cursor);
  return { ...state, selection: { start, end: Math.min(state.text.length, furthest + (state.text.length ? 1 : 0)) } };
}

function visualMotionDestination(state: PromptState, key: string, count: number) {
  const cursor = promptCursor(state); const base = { ...state, selection: collapsed(cursor), visualMode: null, visualAnchor: null, visualCursor: null };
  if (key === 'h' || key === 'left') return repeatMove(base, count, (value) => horizontal(value, -1)).selection.end;
  if (key === 'l' || key === 'right') return repeatMove(base, count, (value) => horizontal(value, 1)).selection.end;
  if (key === 'j' || key === 'down') return repeatMove(base, count, (value) => vertical(value, 1)).selection.end;
  if (key === 'k' || key === 'up') return repeatMove(base, count, (value) => vertical(value, -1)).selection.end;
  if (key === 'w' || key === 'W') return repeatMove(base, count, key === 'W' ? WORDForward : wordForward).selection.end;
  if (key === 'b' || key === 'B') return repeatMove(base, count, key === 'B' ? WORDBackward : wordBackward).selection.end;
  if (key === 'e' || key === 'E') return repeatMove(base, count, key === 'E' ? WORDEnd : wordEnd).selection.end;
  if (key === '0') return lineBounds(state.text, cursor).start;
  if (key === '^') return firstNonBlank(state.text, cursor);
  if (key === '$') return lineLastCursor(lineBounds(state.text, cursor));
  if (key === 'G') return firstNonBlank(state.text, state.text.length);
  return null;
}
