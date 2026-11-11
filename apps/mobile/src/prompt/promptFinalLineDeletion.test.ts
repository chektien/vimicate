import { describe, expect, it } from 'vitest';
import { acceptNativeSelection, acceptNativeText, createPromptState, handlePromptKey, promptClipboardText, type PromptState } from './vimPromptCore';

const apply = (state: PromptState, ...keys: string[]) => keys.reduce((current, key) => handlePromptKey(current, { key }).state, state);
const at = (text: string, cursor = text.length): PromptState => ({ ...createPromptState(text), selection: { start: cursor, end: cursor } });

describe('linewise deletion at the end of a prompt', () => {
  it('deletes the blank final line and returns to the prior logical line', () => {
    // A long final logical line can wrap over several displayed rows.
    const previous = 'intro\nhttps://example.invalid/authorize?' + 'parameter=value&'.repeat(30);
    const before = at(previous + '\n');
    const deleted = apply(before, 'd', 'd');
    expect(deleted).toMatchObject({
      text: previous, mode: 'normal', pending: '',
      selection: { start: 6, end: 6 }, register: '\n', registerKind: 'line',
      authority: before.authority + 1,
    });
    expect(promptClipboardText(before, deleted)).toBe('\n');
    expect(apply(deleted, 'p').text).toBe(before.text);
    expect(apply(deleted, 'u')).toMatchObject({ text: before.text, selection: before.selection });
    const redone = handlePromptKey(apply(deleted, 'u'), { key: 'r', control: true }).state;
    expect(redone).toMatchObject({ text: deleted.text, selection: deleted.selection });
    expect(acceptNativeText(deleted, before.text, before.selection, before.authority)).toBe(deleted);
    expect(acceptNativeSelection(deleted, before.selection, false)).toBe(deleted);
    expect(apply(deleted, 'k').selection.end).toBe(0);
    expect(apply(deleted, 'j').selection.end).toBe(6);
  });

  it('removes a nonempty final line without leaving a phantom blank line', () => {
    const before = at('intro\n  keep this\nremove this', 25);
    const deleted = apply(before, 'd', 'd');
    expect(deleted).toMatchObject({ text: 'intro\n  keep this', selection: { start: 8, end: 8 }, register: 'remove this', registerKind: 'line' });
    expect(apply(deleted, 'p').text).toBe(before.text);
    expect(deleted.undo).toHaveLength(1);
  });

  it('deletes consecutive blank final lines one at a time', () => {
    const before = at('keep\n\n');
    const first = apply(before, 'd', 'd');
    expect(first).toMatchObject({ text: 'keep\n', selection: { start: 5, end: 5 } });
    expect(apply(first, 'd', 'd')).toMatchObject({ text: 'keep', selection: { start: 0, end: 0 } });
    expect(apply(first, 'd', 'd', 'u', 'u')).toMatchObject({ text: before.text, selection: before.selection });
  });

  it.each([
    { command: '2dd', keys: ['2', 'd', 'd'] },
    { command: 'dG', keys: ['d', 'G'] },
    { command: 'dj', keys: ['d', 'j'] },
  ])('deletes a counted or motion-selected final suffix with $command', ({ keys }) => {
    const deleted = apply(at('keep\nremove\nlast', 5), ...keys);
    expect(deleted).toMatchObject({ text: 'keep', selection: { start: 0, end: 0 }, register: 'remove\nlast', registerKind: 'line' });
  });

  it('distinguishes the last line from a line whose delimiter ends the buffer', () => {
    const before = at('keep\nremove\n', 5);
    expect(apply(before, 'd', 'd')).toMatchObject({ text: 'keep\n', selection: { start: 5, end: 5 }, register: 'remove\n' });
    for (const keys of [['2', 'd', 'd'], ['d', 'G'], ['d', 'j']]) {
      const deleted = apply(before, ...keys);
      expect(deleted).toMatchObject({ text: 'keep', selection: { start: 0, end: 0 }, register: 'remove\n\n' });
      expect(apply(deleted, 'p').text).toBe(before.text);
    }
  });

  it('routes visual line deletion through the same final-line boundary', () => {
    for (const key of ['d', 'x']) {
      expect(apply(at('keep\n'), 'V', key)).toMatchObject({ text: 'keep', selection: { start: 0, end: 0 }, visualMode: null, register: '\n', registerKind: 'line' });
      expect(apply(at('keep\nlast'), 'V', key)).toMatchObject({ text: 'keep', selection: { start: 0, end: 0 }, register: 'last', registerKind: 'line' });
      expect(apply(at('keep\nremove\n', 5), 'V', key)).toMatchObject({ text: 'keep\n', selection: { start: 5, end: 5 }, register: 'remove\n' });
    }
  });

  it('preserves all selected blank lines in the register when deleting the whole buffer', () => {
    for (const text of ['only\n', '\n']) {
      for (const keys of [['g', 'g', '2', 'd', 'd'], ['d', 'g', 'g'], ['g', 'g', 'd', 'G']]) {
        const before = at(text);
        const deleted = apply(before, ...keys);
        expect(deleted).toMatchObject({ text: '', selection: { start: 0, end: 0 }, register: text + '\n', registerKind: 'line' });
        expect(apply(deleted, 'p').text).toBe(text);
      }
    }
  });

  it('retains middle-line, change-line, yank and empty-buffer behavior', () => {
    expect(apply(at('first\nsecond\nlast', 6), 'd', 'd')).toMatchObject({ text: 'first\nlast', selection: { start: 6, end: 6 }, register: 'second\n' });
    expect(apply(at('keep\nlast'), 'c', 'c')).toMatchObject({ text: 'keep\n', mode: 'insert', selection: { start: 5, end: 5 } });
    expect(apply(at('keep\nlast'), 'y', 'y')).toMatchObject({ text: 'keep\nlast', register: 'last', registerKind: 'line', undo: [] });
    const emptied = apply(at('only'), 'd', 'd');
    expect(emptied).toMatchObject({ text: '', selection: { start: 0, end: 0 }, register: 'only' });
    expect(apply(emptied, 'd', 'd')).toMatchObject({ text: '', undo: emptied.undo, registerRevision: emptied.registerRevision });
  });
});
