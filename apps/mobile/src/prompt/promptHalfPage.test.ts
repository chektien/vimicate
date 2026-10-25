import { describe, expect, it } from 'vitest';
import { createPromptState, handlePromptKey } from './vimPromptCore';

describe('prompt half-page keyboard routing', () => {
  it.each([['u', 'half-page-up'], ['d', 'half-page-down']] as const)('routes Ctrl-%s without editing or changing undo history', (key, effect) => {
    const changed = handlePromptKey({ ...createPromptState('long draft'), selection: { start: 0, end: 0 } }, { key: 'x' }).state;
    const result = handlePromptKey(changed, { key, control: true });
    expect(result.effect).toBe(effect);
    expect(result.state).toEqual(changed);
    expect(result.state.undo).toBe(changed.undo);
    expect(result.state.redo).toBe(changed.redo);
  });

  it.each(['u', 'd'])('cancels pending operators and count before Ctrl-%s without applying them', (key) => {
    const state = { ...createPromptState('keep this draft'), pending: 'd' as const, count: '3', operatorCount: 2 };
    const result = handlePromptKey(state, { key, control: true });
    expect(result.state).toEqual({ ...state, pending: '', count: '', operatorCount: 1 });
    expect(result.effect).toBe(key === 'u' ? 'half-page-up' : 'half-page-down');
  });

  it.each(['u', 'd', 'x', 'w'])('does not treat Ctrl-%s as a destructive ordinary Visual command', (key) => {
    const visual = handlePromptKey(createPromptState('keep selected text'), { key: 'v' }).state;
    const result = handlePromptKey(visual, { key, control: true });
    expect(result.state).toBe(visual);
    expect(result.effect).toBe('none');
  });

  it.each(['command', 'option'] as const)('does not treat %s-modified Visual keys as ordinary deletion', (modifier) => {
    const initial = { ...createPromptState('keep selected text'), selection: { start: 0, end: 0 } };
    const visual = handlePromptKey(initial, { key: 'v' }).state;
    for (const key of ['u', 'd', 'x']) expect(handlePromptKey(visual, { key, [modifier]: true })).toEqual({ state: visual, effect: 'none' });
  });

  it('does not run unknown Ctrl keys through a pending Normal-mode replacement', () => {
    const pending = { ...createPromptState('keep draft'), pending: 'r' as const, selection: { start: 0, end: 0 } };
    expect(handlePromptKey(pending, { key: 'x', control: true })).toEqual({ state: pending, effect: 'none' });
  });

  it('preserves Insert handling and plain undo/delete keys', () => {
    const initial = { ...createPromptState('abc'), selection: { start: 0, end: 0 } };
    const inserting = { ...initial, mode: 'insert' as const };
    for (const key of ['u', 'd']) expect(handlePromptKey(inserting, { key, control: true })).toEqual({ state: inserting, effect: 'none' });
    const deleted = handlePromptKey(initial, { key: 'x' }).state;
    expect(handlePromptKey(deleted, { key: 'u' }).state.text).toBe('abc');
    expect(handlePromptKey(initial, { key: 'd' }).state.pending).toBe('d');
  });
  it('keeps Ctrl-[ available to cancel a pending Normal operator', () => {
    const state = { ...createPromptState('keep this draft'), pending: 'd' as const, count: '3', operatorCount: 2 };
    expect(handlePromptKey(state, { key: '[', control: true }).state).toEqual({ ...state, pending: '', count: '', operatorCount: 1 });
  });

});
