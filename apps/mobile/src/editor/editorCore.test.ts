import { describe, expect, it } from 'vitest';
import { applyNormalKey, createEditorState } from './editorCore';

describe('editorCore', () => {
  it('moves by lines while retaining the desired column', () => {
    const state = { ...createEditorState('one\ntwenty\nend'), mode: 'NORMAL' as const, selection: { start: 2, end: 2 } };
    expect(applyNormalKey(state, 'j').selection.end).toBe(6);
  });
  it('enters append at the line end without mutating text', () => {
    const state = { ...createEditorState('one\ntwo'), mode: 'NORMAL' as const, selection: { start: 1, end: 1 } };
    expect(applyNormalKey(state, 'A')).toMatchObject({ mode: 'INSERT', text: 'one\ntwo', selection: { start: 3, end: 3 } });
  });
});
