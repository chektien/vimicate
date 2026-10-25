import { describe, expect, it } from 'vitest';
import {
  acceptedPromptHistorySelection,
  closePromptHistoryBrowser,
  movePromptHistoryBrowser,
  openPromptHistoryBrowser,
  promptHistoryBrowserAction,
  promptHistorySelection,
  promptHistoryWindow,
} from './promptHistoryBrowser';
import { createPromptState, handlePromptKey } from './vimPromptCore';

describe('explicit prompt history browser', () => {
  const entries = ['first sent prompt', 'second sent prompt', 'latest sent prompt'];

  it('opens on the newest prompt without changing the current draft', () => {
    const state = openPromptHistoryBrowser(entries);
    expect(state).toMatchObject({ open: true, selectedIndex: 2 });
    expect(promptHistorySelection(state)).toBe('latest sent prompt');
  });

  it('renders chronological history from oldest at the top to newest at the bottom', () => {
    const rows = promptHistoryWindow(openPromptHistoryBrowser(entries), entries.length);
    expect(rows.map((row) => row.text)).toEqual(entries);
    expect(rows.map((row) => row.selected)).toEqual([false, false, true]);
  });

  it('moves within history and parks at both ends', () => {
    let state = openPromptHistoryBrowser(entries);
    state = movePromptHistoryBrowser(state, -1);
    expect(promptHistorySelection(state)).toBe('second sent prompt');
    state = movePromptHistoryBrowser(state, -9);
    expect(promptHistorySelection(state)).toBe('first sent prompt');
    state = movePromptHistoryBrowser(state, 9);
    expect(promptHistorySelection(state)).toBe('latest sent prompt');
  });

  it('provides a bounded visible window around the selected row', () => {
    const long = Array.from({ length: 12 }, (_, index) => `prompt ${index + 1}`);
    const state = movePromptHistoryBrowser(openPromptHistoryBrowser(long), -5);
    expect(promptHistoryWindow(state, 5).map((row) => row.index)).toEqual([4, 5, 6, 7, 8]);
  });

  it('closes without owning or mutating the draft', () => {
    expect(closePromptHistoryBrowser(openPromptHistoryBrowser(entries))).toEqual({ open: false, entries: [], selectedIndex: -1 });
  });

  it('accepts a selected prompt as one undoable replacement of the current draft', () => {
    const current = { ...createPromptState('unfinished current draft'), register: 'kept register' };
    const accepted = acceptedPromptHistorySelection(current, 'latest sent prompt');
    expect(accepted).toMatchObject({ text: 'latest sent prompt', register: 'kept register' });
    expect(handlePromptKey(accepted, { key: 'u' }).state.text).toBe('unfinished current draft');
  });

  it('owns explicit browser navigation, acceptance and cancellation keys', () => {
    const state = openPromptHistoryBrowser(entries);
    expect(promptHistoryBrowserAction(state, { key: 'p', control: true, shift: false, option: false, command: false, isRepeat: false })).toBe('older');
    expect(promptHistoryBrowserAction(state, { key: 'down', control: false, shift: false, option: false, command: false, isRepeat: false })).toBe('newer');
    expect(promptHistoryBrowserAction(state, { key: 'enter', control: false, shift: false, option: false, command: false, isRepeat: false })).toBe('accept');
    expect(promptHistoryBrowserAction(state, { key: 'escape', control: false, shift: false, option: false, command: false, isRepeat: false })).toBe('cancel');
    expect(promptHistoryBrowserAction(state, { key: 'x', control: false, shift: false, option: false, command: false, isRepeat: false })).toBe('block');
  });
});
