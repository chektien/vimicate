export type VimMode = 'NORMAL' | 'INSERT';
export type Selection = { start: number; end: number };
export type EditorState = { text: string; mode: VimMode; selection: Selection };

function lineBounds(text: string, cursor: number) {
  const safe = Math.max(0, Math.min(cursor, text.length));
  const start = text.lastIndexOf('\n', Math.max(0, safe - 1)) + 1;
  const next = text.indexOf('\n', safe);
  return { start, end: next === -1 ? text.length : next };
}

export function createEditorState(text = ''): EditorState {
  return { text, mode: 'INSERT', selection: { start: text.length, end: text.length } };
}

export function applyNormalKey(state: EditorState, key: string): EditorState {
  const cursor = state.selection.end;
  const bounds = lineBounds(state.text, cursor);
  if (key === 'i') return { ...state, mode: 'INSERT', selection: { start: cursor, end: cursor } };
  if (key === 'a') { const next = Math.min(bounds.end, cursor + 1); return { ...state, mode: 'INSERT', selection: { start: next, end: next } }; }
  if (key === 'I') { const first = bounds.start + (state.text.slice(bounds.start, bounds.end).match(/^\s*/)?.[0].length ?? 0); return { ...state, mode: 'INSERT', selection: { start: first, end: first } }; }
  if (key === 'A') return { ...state, mode: 'INSERT', selection: { start: bounds.end, end: bounds.end } };
  if (key === 'h') { const next = Math.max(bounds.start, cursor - 1); return { ...state, selection: { start: next, end: next } }; }
  if (key === 'l') { const next = Math.min(bounds.end, cursor + 1); return { ...state, selection: { start: next, end: next } }; }
  if (key === '0') return { ...state, selection: { start: bounds.start, end: bounds.start } };
  if (key === '$') return { ...state, selection: { start: bounds.end, end: bounds.end } };
  if (key === 'G') return { ...state, selection: { start: state.text.length, end: state.text.length } };
  if (key === 'j' || key === 'k') {
    const column = cursor - bounds.start;
    const targetProbe = key === 'j' ? Math.min(state.text.length, bounds.end + 1) : Math.max(0, bounds.start - 1);
    const target = lineBounds(state.text, targetProbe);
    const next = Math.min(target.end, target.start + column);
    return { ...state, selection: { start: next, end: next } };
  }
  if (key === 'x' && cursor < state.text.length) {
    const text = state.text.slice(0, cursor) + state.text.slice(cursor + 1);
    return { ...state, text, selection: { start: Math.min(cursor, text.length), end: Math.min(cursor, text.length) } };
  }
  return state;
}

export function applyTextChange(state: EditorState, text: string, selection: Selection): EditorState {
  return { ...state, text, selection };
}
