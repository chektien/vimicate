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
});
