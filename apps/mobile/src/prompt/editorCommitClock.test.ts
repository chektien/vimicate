import { describe, expect, it, vi } from 'vitest';
import { EditorCommitClock } from './editorCommitClock';
import { createPromptState } from './vimPromptCore';

describe('controlled editor commit clock', () => {
  it('changes revision and scope when an identical prompt belongs to another session', () => {
    const clock = new EditorCommitClock();
    const state = createPromptState('same draft');
    const first = clock.commit(state, 'thread-a');
    expect(clock.commit(state, 'thread-a')).toBe(first);
    expect(clock.commit(state, 'thread-b')).toMatchObject({ scope: 'thread-b', revision: first.revision + 1 });
    expect(JSON.parse(clock.serialized(state, 'thread-b')).scope).toBe('thread-b');
  });

  it('stays stable for unrelated rerenders and advances for every cursor, text, or mode commit', () => {
    const clock = new EditorCommitClock();
    const initial = createPromptState('alpha\nbeta');
    const first = clock.commit(initial);
    expect(clock.commit({ ...initial })).toBe(first);

    const moved = clock.commit({ ...initial, selection: { start: 2, end: 2 } });
    const inserted = clock.commit({ ...initial, mode: 'insert', selection: { start: 2, end: 2 } });
    const changed = clock.commit({ ...initial, text: 'alpha!\nbeta', selection: { start: 6, end: 6 } });

    expect([first.revision, moved.revision, inserted.revision, changed.revision]).toEqual([1, 2, 3, 4]);
  });

  it('includes explicit text authority resets even when the visible buffer is unchanged', () => {
    const clock = new EditorCommitClock();
    const initial = createPromptState('draft');
    expect(clock.commit({ ...initial, authority: 4 }).revision).toBe(1);
    expect(clock.commit({ ...initial, authority: 5 }).revision).toBe(2);
  });

  it('serializes a large unchanged prompt only once across unrelated parent renders', () => {
    const clock = new EditorCommitClock();
    const initial = createPromptState('x'.repeat(120_000));
    const stringify = vi.spyOn(JSON, 'stringify');
    const first = clock.serialized(initial);

    for (let index = 0; index < 2_000; index += 1) {
      expect(clock.serialized({ ...initial })).toBe(first);
    }

    expect(stringify).toHaveBeenCalledTimes(1);
    stringify.mockRestore();
  });

  // Extending a Visual selection below the composer must reveal its moving end.
  // Revealing only the selection start leaves that end hidden.
  it('names the moving end of a Visual selection so the editor keeps it in view', () => {
    const clock = new EditorCommitClock();
    const text = 'one\ntwo\nthree\nfour';
    const down = clock.commit({ ...createPromptState(text), visualMode: 'line', visualAnchor: 0, visualCursor: 14, selection: { start: 0, end: 18 } });
    expect(down).toMatchObject({ selectionStart: 0, selectionEnd: 18, cursor: 14 });
    // In Visual line mode a motion within the last line leaves the range
    // unchanged but still moves the end the editor must follow.
    expect(clock.commit({ ...createPromptState(text), visualMode: 'line', visualAnchor: 0, visualCursor: 16, selection: { start: 0, end: 18 } }).revision).toBe(down.revision + 1);
    const up = clock.commit({ ...createPromptState(text), visualMode: 'character', visualAnchor: 14, visualCursor: 2, selection: { start: 2, end: 15 } });
    expect(up.cursor).toBe(2);
    expect(JSON.parse(clock.serialized({ ...createPromptState(text), visualMode: 'character', visualAnchor: 14, visualCursor: 2, selection: { start: 2, end: 15 } })).cursor).toBe(2);
    expect('cursor' in clock.commit({ ...createPromptState(text), selection: { start: 4, end: 4 } })).toBe(false);
  });
});
