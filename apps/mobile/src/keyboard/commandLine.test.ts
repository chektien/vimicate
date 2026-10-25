import { describe, expect, it } from 'vitest';
import type { HardwareKeyEvent } from '../../modules/vimicate-editor';
import { appendCommandLinePaste, handleCommandLineKey } from './commandLine';

const key = (value: string, extra: Partial<HardwareKeyEvent> = {}): HardwareKeyEvent => ({ key: value, shift: false, control: false, option: false, command: false, ...extra });

describe('keyboard command line', () => {
  it('accepts rapid text, shifted punctuation, deletion, and Ctrl-U', () => {
    let state = { query: '' };
    for (const event of [key('a'), key('/', { shift: true }), key('b')]) state = handleCommandLineKey(state, event).state;
    expect(state.query).toBe('a?b');
    state = handleCommandLineKey(state, key('backspace')).state;
    expect(state.query).toBe('a?');
    state = handleCommandLineKey(state, key('u', { control: true })).state;
    expect(state.query).toBe('');
  });

  it('reports submit and both Vim cancel keys without mutating the query', () => {
    const state = { query: 'needle' };
    expect(handleCommandLineKey(state, key('enter')).action).toBe('submit');
    expect(handleCommandLineKey(state, key('escape')).action).toBe('cancel');
    expect(handleCommandLineKey(state, key('[', { control: true })).action).toBe('cancel');
  });

  it('appends a copied Vimicate command without executing pasted newlines', () => {
    expect(appendCommandLinePaste({ query: 'model ' }, 'opencode-go/qwen3.7-max\n')).toEqual({ query: 'model opencode-go/qwen3.7-max ' });
    expect(appendCommandLinePaste({ query: '' }, 'status\r\nnow')).toEqual({ query: 'status now' });
  });
});
