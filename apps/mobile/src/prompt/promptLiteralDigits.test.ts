import { describe, expect, it } from 'vitest';
import { createPromptState, handlePromptKey, type PromptState } from './vimPromptCore';

function at(text: string, cursor = 0): PromptState {
  return { ...createPromptState(text), selection: { start: cursor, end: cursor } };
}
function type(state: PromptState, keys: string) {
  return [...keys].reduce((current, key) => handlePromptKey(current, { key }).state, state);
}

describe('literal digit arguments in the prompt', () => {
  it.each([...'0123456789'])('replaces the screenshot digit with %s, then supports undo and redo', digit => {
    const initial = at('images at 80% width', 10);
    const changed = type(initial, `r${digit}`);
    expect(changed).toMatchObject({ text: `images at ${digit}0% width`, pending: '', count: '', mode: 'normal', selection: initial.selection });
    const undone = type(changed, 'u');
    expect(undone.text).toBe(initial.text);
    expect(handlePromptKey(undone, { key: 'r', control: true }).state.text).toBe(changed.text);
  });

  it('keeps counts before r separate from the replacement digit', () => {
    expect(type(at('abc tail'), '3r7')).toMatchObject({ text: '777 tail', pending: '', count: '', selection: { start: 2, end: 2 } });
    expect(type(at('abc tail'), '3r0')).toMatchObject({ text: '000 tail', pending: '', count: '' });
    expect(type(at('abc'), 'r7x').text).toBe('bc');
  });

  it.each(['f', 't', 'F', 'T'])('uses a numeric %s target after a repetition count', motion => {
    const backward = motion === 'F' || motion === 'T';
    const initial = at('a7b7c', backward ? 4 : 0);
    const destination = { f: 3, t: 2, F: 1, T: 2 }[motion];
    expect(type(initial, `2${motion}7`)).toMatchObject({ text: initial.text, selection: { start: destination, end: destination }, pending: '', count: '' });
  });

  it('keeps operator and motion counts separate from numeric find targets', () => {
    expect(type(at('a7b7tail'), 'd2f7')).toMatchObject({ text: 'tail', register: 'a7b7', pending: '', count: '' });
    expect(type(at('a0b0tail'), '2dt0')).toMatchObject({ text: '0tail', register: 'a0b', pending: '', count: '' });
    expect(type(at('a7tail'), 'cf7')).toMatchObject({ text: 'tail', register: 'a7', mode: 'insert' });
    expect(type(at('a7tail'), 'yt7')).toMatchObject({ text: 'a7tail', register: 'a' });
    expect(type(at('a7b7c7d7tail'), '2d2f7')).toMatchObject({ text: 'tail', register: 'a7b7c7d7' });
  });

  it('cancels a pending replacement with Escape without changing the draft', () => {
    const pending = type(at('80%'), 'r');
    const cancelled = handlePromptKey(pending, { key: 'escape' }).state;
    expect(cancelled).toMatchObject({ text: '80%', pending: '', count: '' });
    expect(type(cancelled, '7')).toMatchObject({ text: '80%', pending: '', count: '7' });
  });
});
