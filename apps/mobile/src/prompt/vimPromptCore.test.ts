import { describe, expect, it } from 'vitest';
import { acceptNativeSelection, acceptNativeText, applyBridgedNativeInsert, createPromptState, enterPromptInsertMode, handlePromptKey, insertPromptHandoff, promptClipboardText, type PromptState } from './vimPromptCore';

function normal(text: string, cursor = 0): PromptState { return { ...createPromptState(text), mode: 'normal', selection: { start: cursor, end: cursor } }; }
function keys(text: string, sequence: string[]) { return sequence.reduce<PromptState>((state, key) => handlePromptKey(state, { key }).state, normal(text)); }
function keysAt(text: string, cursor: number, sequence: string[]) { return sequence.reduce<PromptState>((state, key) => handlePromptKey(state, { key }).state, normal(text, cursor)); }

describe('Vim prompt core', () => {
  it('enters insert mode immediately when the prompt surface is tapped', () => {
    const state = { ...createPromptState('hello'), pending: 'g' as const, count: '3' };
    expect(enterPromptInsertMode(state)).toMatchObject({ mode: 'insert', pending: '', count: '', text: 'hello' });
  });

  it('does not lose the first key while UIKit is receiving the Insert mode prop', () => {
    const inserting = handlePromptKey(createPromptState(''), { key: 'i' }).state;
    const first = applyBridgedNativeInsert(inserting, { key: 'e' });
    expect(first?.text).toBe('e');
    expect(first?.selection).toEqual({ start: 1, end: 1 });
    expect(applyBridgedNativeInsert(inserting, { key: '6', shift: true })?.text).toBe('^');
    expect(applyBridgedNativeInsert(inserting, { key: 'escape' })).toBeNull();
  });
  it('supports counted word and line motions', () => {
    expect(keys('one two three', ['2', 'w']).selection.end).toBe(8);
    expect(keys('a\nbb\nccc', ['G']).selection.end).toBe(5);
    expect(keys('a\nbb\nccc', ['g', 'g']).selection.end).toBe(0);
  });
  it('supports line operators and undo/redo', () => {
    const deleted = keys('one\ntwo\n', ['d', 'd']);
    expect(deleted.text).toBe('two\n');
    const undone = handlePromptKey(deleted, { key: 'u' }).state;
    expect(undone.text).toBe('one\ntwo\n');
    expect(handlePromptKey(undone, { key: 'r', control: true }).state.text).toBe('two\n');
  });
  it('supports operator motions, counts, and text objects', () => {
    expect(keys('one two three', ['d', 'w']).text).toBe('two three');
    expect(keys('one two three', ['2', 'd', 'w']).text).toBe('three');
    expect(keys('one [two three] four', ['w', 'y', 'i', '[']).register).toBe('two three');
    const changed = keys('one [two three] four', ['w', 'c', 'a', '[']);
    expect(changed).toMatchObject({ text: 'one  four', mode: 'insert', register: '[two three]' });
    expect(keys('one two', ['y', 'i', 'w']).register).toBe('one');
    expect(keys('one two three four five six seven', ['2', 'd', '3', 'w'])).toMatchObject({ text: 'seven', register: 'one two three four five six ' });
    expect(keys('one\ntwo\nthree\nfour', ['2', 'd', '2', 'd'])).toMatchObject({ text: '', register: 'one\ntwo\nthree\nfour' });
  });

  it('supports standalone and operator find/till character motions', () => {
    const text = 'alpha,beta,gamma';
    const pendingYank = handlePromptKey(normal(text), { key: 'y' }).state;
    expect(handlePromptKey(pendingYank, { key: '', shift: true }).state.pending).toBe('y');
    expect(keysAt(text, 0, ['f', ',']).selection.end).toBe(5);
    expect(keysAt(text, 0, ['t', ',']).selection.end).toBe(4);
    expect(keysAt(text, 0, ['2', 'f', ',']).selection.end).toBe(10);
    expect(keysAt(text, 0, ['2', 't', ',']).selection.end).toBe(9);
    expect(keysAt(text, text.length - 1, ['F', ',']).selection.end).toBe(10);
    expect(keysAt(text, text.length - 1, ['T', ',']).selection.end).toBe(11);

    expect(keysAt(text, 0, ['d', 't', ','])).toMatchObject({ text: ',beta,gamma', register: 'alpha' });
    expect(keysAt(text, 0, ['d', 'f', ','])).toMatchObject({ text: 'beta,gamma', register: 'alpha,' });
    expect(keysAt(text, 0, ['2', 'd', 't', ','])).toMatchObject({ text: ',gamma', register: 'alpha,beta' });
    expect(keysAt(text, 0, ['c', 't', ','])).toMatchObject({ text: ',beta,gamma', register: 'alpha', mode: 'insert' });
    expect(keysAt(text, 0, ['y', 'f', ','])).toMatchObject({ text, register: 'alpha,' });
    expect(keysAt(text, text.length - 1, ['y', 'T', ','])).toMatchObject({ text, register: 'gamma' });
    expect(keysAt(text, text.length - 1, ['d', 'F', ','])).toMatchObject({ text: 'alpha,beta', register: ',gamma' });
    expect(keysAt(text, text.length - 1, ['d', 'T', ','])).toMatchObject({ text: 'alpha,beta,', register: 'gamma' });

    expect(keysAt('alpha beta', 0, ['d', 't', ','])).toMatchObject({ text: 'alpha beta', pending: '', register: '' });
    expect(keysAt('alpha beta', 0, ['f', ','])).toMatchObject({ selection: { start: 0, end: 0 }, pending: '' });
  });

  it('supports common replacement, substitute, join, reverse-delete and case commands', () => {
    expect(keys('abc', ['r', 'x']).text).toBe('xbc');
    expect(keys('abc', ['l', 'X']).text).toBe('bc');
    expect(keys('abc', ['s'])).toMatchObject({ text: 'bc', mode: 'insert', register: 'a' });
    expect(keys('one\n  two', ['J']).text).toBe('one two');
    expect(keys('Ab', ['2', '~']).text).toBe('aB');
  });
  it('switches insert entry points without losing the draft', () => {
    const state = normal('  hello', 4);
    expect(handlePromptKey(state, { key: 'I' }).state.selection.end).toBe(2);
    expect(handlePromptKey(state, { key: 'A' }).state.selection.end).toBe(7);
    expect(handlePromptKey(state, { key: 'escape' }).state.text).toBe('  hello');
  });
  it('keeps ordinary vertical motion inside the draft and reserves explicit control keys for history', () => {
    expect(handlePromptKey(normal('hi'), { key: 'enter' }).effect).toBe('submit');
    for (const key of ['up', 'down', 'k', 'j']) {
      expect(handlePromptKey(normal('hi'), { key })).toMatchObject({ effect: 'none', state: { text: 'hi', selection: { start: 0, end: 0 } } });
    }
    expect(handlePromptKey(normal('hi'), { key: 'p', control: true }).effect).toBe('history-previous');
    expect(handlePromptKey(normal('hi'), { key: 'n', control: true }).effect).toBe('history-next');
  });

  it('treats an immediate Escape then Enter as submit rather than an inserted newline', () => {
    const inserting = { ...normal('send this', 9), mode: 'insert' as const };
    const escaped = handlePromptKey(inserting, { key: 'escape' });
    expect(escaped.state).toMatchObject({ mode: 'normal', text: 'send this' });
    const entered = handlePromptKey(escaped.state, { key: 'enter' });
    expect(entered.effect).toBe('submit');
    expect(entered.state.text).toBe('send this');
  });

  it('supports character, vertical, line, and shifted document motions', () => {
    const text = '  one two\nthree four\nfive';
    expect(handlePromptKey(normal(text, 3), { key: 'h' }).state.selection.end).toBe(2);
    expect(handlePromptKey(normal(text, 3), { key: 'l' }).state.selection.end).toBe(4);
    expect(handlePromptKey(normal(text, 3), { key: 'j' }).state.selection.end).toBe(13);
    expect(handlePromptKey(normal(text, 13), { key: 'k' }).state.selection.end).toBe(3);
    expect(handlePromptKey(normal(text, 7), { key: '0' }).state.selection.end).toBe(0);
    expect(handlePromptKey(normal(text, 7), { key: '^' }).state.selection.end).toBe(2);
    expect(handlePromptKey(normal(text, 3), { key: '$' }).state.selection.end).toBe(8);
    expect(handlePromptKey(normal(text, 3), { key: 'g', shift: true }).state.selection.end).toBe(21);
  });

  it('supports word motions and counts in both directions', () => {
    const text = 'one two three four';
    expect(handlePromptKey(normal(text), { key: 'w' }).state.selection.end).toBe(4);
    expect(keys(text, ['3', 'w']).selection.end).toBe(14);
    expect(handlePromptKey(normal(text, 14), { key: 'b' }).state.selection.end).toBe(8);
    expect(handlePromptKey(normal(text), { key: 'e' }).state.selection.end).toBe(2);
    expect(keys('abcde', ['3', 'l']).selection.end).toBe(3);
    expect(keys('abcde', ['2', 'h']).selection.end).toBe(0);
  });

  it('matches Vim change-word semantics and keeps the insert caret at the changed range start', () => {
    const screenshotText = 'last slide , what do you think about update that part to human purpose';
    const cursor = screenshotText.indexOf('update') + 'update'.length - 1;
    const changedLastCharacter = keysAt(screenshotText, cursor, ['c', 'w']);
    expect(changedLastCharacter).toMatchObject({
      text: screenshotText.slice(0, cursor) + screenshotText.slice(cursor + 1),
      mode: 'insert',
      selection: { start: cursor, end: cursor },
      register: 'e',
      registerRevision: 1,
    });

    expect(keysAt('one two three', 1, ['c', 'w'])).toMatchObject({ text: 'o two three', mode: 'insert', selection: { start: 1, end: 1 }, register: 'ne' });
    expect(keysAt('one two three', 1, ['c', '2', 'w'])).toMatchObject({ text: 'o three', mode: 'insert', selection: { start: 1, end: 1 }, register: 'ne two' });
    expect(keysAt('one   two', 3, ['c', 'w'])).toMatchObject({ text: 'onetwo', mode: 'insert', selection: { start: 3, end: 3 }, register: '   ' });
  });

  it('audits advertised operator-motion and line-change behavior', () => {
    expect(keysAt('one two three', 1, ['d', 'w'])).toMatchObject({ text: 'otwo three', selection: { start: 1, end: 1 }, register: 'ne ' });
    expect(keysAt('one two three', 4, ['d', 'b'])).toMatchObject({ text: 'two three', selection: { start: 0, end: 0 }, register: 'one ' });
    expect(keysAt('one two three', 1, ['d', '$'])).toMatchObject({ text: 'o', register: 'ne two three' });
    expect(keysAt('one two three', 4, ['c', '0'])).toMatchObject({ text: 'two three', mode: 'insert', selection: { start: 0, end: 0 }, register: 'one ' });
    expect(keysAt('one\ntwo\nthree', 4, ['d', 'd'])).toMatchObject({ text: 'one\nthree', register: 'two\n' });
    expect(keysAt('one\ntwo\nthree', 4, ['c', 'c'])).toMatchObject({ text: 'one\n\nthree', mode: 'insert', selection: { start: 4, end: 4 }, register: 'two\n' });
    expect(keysAt('one\ntwo\nthree', 4, ['2', 'c', 'c'])).toMatchObject({ text: 'one\n', mode: 'insert', selection: { start: 4, end: 4 }, register: 'two\nthree' });
  });

  it('distinguishes small-word motions from whitespace-delimited WORD motions', () => {
    const text = 'foo.bar baz';
    expect(keys(text, ['w']).selection.end).toBe(3);
    expect(keys(text, ['W']).selection.end).toBe(8);
    expect(keys(text, ['e']).selection.end).toBe(2);
    expect(keys(text, ['E']).selection.end).toBe(6);
    expect(keysAt(text, 8, ['b']).selection.end).toBe(4);
    expect(keysAt(text, 8, ['B']).selection.end).toBe(0);
  });

  it('publishes successful prompt register writes for the system clipboard', () => {
    const before = normal('one\ntwo');
    const deleted = handlePromptKey(handlePromptKey(before, { key: 'd' }).state, { key: 'd' }).state;
    expect(promptClipboardText(before, deleted)).toBe('one\n');
    expect(promptClipboardText(deleted, handlePromptKey(deleted, { key: 'd' }).state)).toBeNull();

    let visual = handlePromptKey(normal('abcdef', 1), { key: 'v' }).state;
    visual = handlePromptKey(visual, { key: '2' }).state;
    visual = handlePromptKey(visual, { key: 'l' }).state;
    const visualDeleted = handlePromptKey(visual, { key: 'd' }).state;
    expect(promptClipboardText(visual, visualDeleted)).toBe('bcd');

    const yankPending = handlePromptKey(normal('one two'), { key: 'y' }).state;
    const yanked = handlePromptKey(yankPending, { key: 'i' }).state;
    const wordYanked = handlePromptKey(yanked, { key: 'w' }).state;
    expect(promptClipboardText(yanked, wordYanked)).toBe('one');
  });

  it('preserves characterwise and linewise register shape for p and P', () => {
    const deletedLine = keysAt('one\ntwo', 0, ['d', 'd']);
    expect(deletedLine).toMatchObject({ text: 'two', register: 'one\n', registerKind: 'line' });
    expect(handlePromptKey(deletedLine, { key: 'p' }).state).toMatchObject({ text: 'two\none', selection: { start: 4, end: 4 } });
    expect(handlePromptKey(deletedLine, { key: 'P', shift: true }).state).toMatchObject({ text: 'one\ntwo', selection: { start: 0, end: 0 } });

    const deletedWord = keysAt('one two', 0, ['d', 'w']);
    expect(deletedWord).toMatchObject({ text: 'two', register: 'one ', registerKind: 'character' });
    expect(handlePromptKey(deletedWord, { key: 'p' }).state).toMatchObject({ text: 'tone wo', selection: { start: 4, end: 4 } });
  });

  it('pastes a linewise register into an empty prompt without a phantom first line', () => {
    const copiedInAnotherThread = keysAt('slide 6 architecture callout\nand the architecture term', 0, ['d', 'd']);
    const emptyThread = { ...normal(''), register: copiedInAnotherThread.register, registerKind: copiedInAnotherThread.registerKind };
    const pasted = handlePromptKey(emptyThread, { key: 'p' }).state;
    expect(pasted).toMatchObject({ text: 'slide 6 architecture callout', selection: { start: 0, end: 0 } });
    expect(pasted.text.startsWith('\n')).toBe(false);
    expect(handlePromptKey(pasted, { key: 'k' }).state.selection).toEqual({ start: 0, end: 0 });

    const repeated = handlePromptKey({ ...emptyThread, count: '2' }, { key: 'p' }).state;
    expect(repeated).toMatchObject({ text: 'slide 6 architecture callout\nslide 6 architecture callout', selection: { start: 0, end: 0 } });

    const blankSecondLine = { ...normal('\n', 0), register: copiedInAnotherThread.register, registerKind: copiedInAnotherThread.registerKind };
    const pastedOverBlankLines = handlePromptKey(blankSecondLine, { key: 'p' }).state;
    expect(pastedOverBlankLines).toMatchObject({ text: 'slide 6 architecture callout', selection: { start: 0, end: 0 } });
    expect(pastedOverBlankLines.text.startsWith('\n')).toBe(false);
  });

  it('keeps one undo transaction authoritative after a transcript-register paste', () => {
    const before = { ...normal('draft', 0), register: 'copied from transcript', registerKind: 'character' as const };
    const pasted = handlePromptKey(before, { key: 'p' }).state;
    const escaped = handlePromptKey(pasted, { key: 'escape' }).state;
    const undone = handlePromptKey(escaped, { key: 'u' }).state;

    expect(pasted.text).toBe('dcopied from transcriptraft');
    expect(undone.text).toBe('draft');

    // A delayed UITextView callback for the already-accepted paste must not
    // resurrect the pasted buffer after the later Vim undo transaction.
    const delayedPasteEcho = acceptNativeText(undone, pasted.text, pasted.selection, pasted.authority);
    expect(delayedPasteEcho).toBe(undone);
  });

  it('keeps a held h/l stream monotonic instead of oscillating between native cursor revisions', () => {
    const text = 'abcdefghijklmnopqrstuvwxyz';
    const right = Array.from({ length: text.length - 1 }).reduce<PromptState[]>((states) => {
      const next = handlePromptKey(states.at(-1)!, { key: 'l' }).state;
      return [...states, next];
    }, [normal(text)]);
    expect(right.map((state) => state.selection.end)).toEqual(Array.from({ length: text.length }, (_, index) => index));

    const left = Array.from({ length: text.length - 1 }).reduce<PromptState[]>((states) => {
      const next = handlePromptKey(states.at(-1)!, { key: 'h' }).state;
      return [...states, next];
    }, [right.at(-1)!]);
    expect(left.map((state) => state.selection.end)).toEqual(Array.from({ length: text.length }, (_, index) => text.length - 1 - index));
  });

  it('flows h/l directly across line boundaries without an invisible newline stop', () => {
    expect(handlePromptKey(normal('ab\ncd', 1), { key: 'l' }).state.selection.end).toBe(3);
    expect(handlePromptKey(normal('ab\ncd', 3), { key: 'h' }).state.selection.end).toBe(1);
    expect(keysAt('ab\ncd\nef', 0, ['6', 'l']).selection.end).toBe(7);
  });

  it('supports visible characterwise selection in both directions and visual operators', () => {
    let selected = handlePromptKey(normal('abcdef', 2), { key: 'v' }).state;
    expect(selected).toMatchObject({ visualMode: 'character', visualAnchor: 2, visualCursor: 2, selection: { start: 2, end: 3 } });
    selected = handlePromptKey(selected, { key: 'l' }).state;
    selected = handlePromptKey(selected, { key: 'l' }).state;
    expect(selected).toMatchObject({ visualCursor: 4, selection: { start: 2, end: 5 } });
    expect(handlePromptKey(selected, { key: 'y' }).state).toMatchObject({ register: 'cde', visualMode: null, selection: { start: 2, end: 2 } });

    let backwards = handlePromptKey(normal('abcdef', 4), { key: 'v' }).state;
    backwards = handlePromptKey(backwards, { key: '2' }).state;
    backwards = handlePromptKey(backwards, { key: 'h' }).state;
    expect(backwards).toMatchObject({ visualCursor: 2, selection: { start: 2, end: 5 } });
    expect(handlePromptKey(backwards, { key: 'd' }).state).toMatchObject({ text: 'abf', register: 'cde', visualMode: null });
  });

  it('supports visual-line, visual-block fallback, replacement, and escape', () => {
    let line = handlePromptKey(normal('one\ntwo\nthree', 5), { key: 'V', shift: true }).state;
    expect(line).toMatchObject({ visualMode: 'line', selection: { start: 4, end: 8 } });
    line = handlePromptKey(line, { key: 'j' }).state;
    expect(handlePromptKey(line, { key: 'c' }).state).toMatchObject({ text: 'one\n', mode: 'insert', register: 'two\nthree', visualMode: null });

    let block = handlePromptKey(normal('abcd', 1), { key: 'v', control: true }).state;
    expect(block.visualMode).toBe('block');
    block = handlePromptKey(block, { key: 'l' }).state;
    expect(handlePromptKey(block, { key: 'escape' }).state).toMatchObject({ visualMode: null, selection: { start: 2, end: 2 } });
  });

  it('keeps native text entry in insert mode and returns to a normal cursor with Escape or Ctrl-[', () => {
    const insert = { ...normal('abc', 3), mode: 'insert' as const };
    expect(handlePromptKey(insert, { key: 'j' }).state).toEqual(insert);
    expect(handlePromptKey(insert, { key: 'escape' }).state).toMatchObject({ mode: 'normal', selection: { start: 2, end: 2 } });
    expect(handlePromptKey(insert, { key: '[', control: true }).state.mode).toBe('normal');
  });

  it('rejects passive UIKit caret drift in Normal mode but preserves insert and intentional touch selection', () => {
    const state = normal('one\ntwo\nthree', 5);
    expect(acceptNativeSelection(state, { start: 12, end: 12 }, false)).toBe(state);
    expect(acceptNativeSelection({ ...state, mode: 'insert' }, { start: 12, end: 12 }, false).selection).toEqual({ start: 12, end: 12 });
    expect(acceptNativeSelection(state, { start: 4, end: 7 }, true).selection).toEqual({ start: 4, end: 7 });
  });

  it('treats repeated native selection publication as an idempotent bridge acknowledgement', () => {
    const insert = { ...normal('send this', 9), mode: 'insert' as const };

    expect(acceptNativeSelection(insert, { start: 9, end: 9 }, false)).toBe(insert);
    expect(acceptNativeSelection(insert, { start: 9, end: 9 }, true)).toBe(insert);
  });

  it('records native insert-mode edits for undo and redo', () => {
    const insert = { ...normal('abc', 3), mode: 'insert' as const };
    const edited = acceptNativeText(insert, 'abcd', { start: 4, end: 4 });
    const normalAfterEscape = handlePromptKey(edited, { key: 'escape' }).state;
    const undone = handlePromptKey(normalAfterEscape, { key: 'u' }).state;
    expect(undone.text).toBe('abc');
    expect(handlePromptKey(undone, { key: 'r', control: true }).state.text).toBe('abcd');
  });

  it('inserts a transcript handoff at the existing draft cursor and preserves the register', () => {
    const state = { ...normal('before after', 7), register: 'yanked' };
    const inserted = insertPromptHandoff(state, 'BODY', 2);
    expect(inserted).toMatchObject({ text: 'before BODYafter', mode: 'insert', selection: { start: 9, end: 9 }, register: 'yanked' });
    expect(handlePromptKey({ ...inserted, mode: 'normal' }, { key: 'u' }).state.text).toBe('before after');
  });
});
