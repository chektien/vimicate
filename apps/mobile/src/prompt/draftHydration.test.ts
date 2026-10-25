import { describe, expect, it } from 'vitest';
import { createPromptState, handlePromptKey } from './vimPromptCore';
import { draftHydrationDecision, SessionPromptDraftMemory } from './draftHydration';

describe('prompt draft hydration authority', () => {
  it('restores only when no edit occurred after the read began', () => {
    expect(draftHydrationDecision('', '', 'saved')).toEqual({ kind: 'restore', text: 'saved' });
    expect(draftHydrationDecision('', 'new key', 'saved')).toEqual({ kind: 'preserve-edit', text: 'new key' });
  });

  it('treats clearing a visible previous-session draft as a newer edit', () => {
    expect(draftHydrationDecision('previous draft', '', 'destination draft')).toEqual({ kind: 'preserve-edit', text: '' });
  });

  it('never stages the previous session draft into an unvisited destination', () => {
    const memory = new SessionPromptDraftMemory();
    expect(memory.enter('thread-a', '', false)).toEqual({ sessionKey: 'thread-a', text: '', source: 'empty' });
    memory.remember('thread-a', 'draft owned by a');

    expect(memory.enter('thread-b', 'draft owned by a', true)).toEqual({ sessionKey: 'thread-b', text: '', source: 'empty' });
  });

  it('restores each visited destination synchronously without cross-thread bleed', () => {
    const memory = new SessionPromptDraftMemory();
    memory.enter('thread-a', '', false);
    memory.remember('thread-a', 'draft a');
    memory.enter('thread-b', 'draft a', true);
    memory.remember('thread-b', 'draft b');

    expect(memory.enter('thread-a', 'draft b', true)).toEqual({ sessionKey: 'thread-a', text: 'draft a', source: 'memory' });
    expect(memory.enter('thread-b', 'draft a', true)).toEqual({ sessionKey: 'thread-b', text: 'draft b', source: 'memory' });
  });

  it('does not promote an untouched hydration placeholder into memory', () => {
    const memory = new SessionPromptDraftMemory();
    memory.enter('thread-a', '', false);
    expect(memory.enter('thread-b', '', false)).toEqual({ sessionKey: 'thread-b', text: '', source: 'empty' });
    expect(memory.enter('thread-a', '', false)).toEqual({ sessionKey: 'thread-a', text: '', source: 'empty' });
  });

  it('evicts the least recently used process draft after the bounded session lifetime', () => {
    const memory = new SessionPromptDraftMemory(2);
    memory.remember('thread-a', 'a'.repeat(120_000));
    memory.remember('thread-b', 'draft b');
    expect(memory.enter('thread-a', '', false).source).toBe('memory');
    memory.remember('thread-c', 'draft c');

    expect(memory.enter('thread-b', '', false)).toEqual({ sessionKey: 'thread-b', text: '', source: 'empty' });
    expect(memory.enter('thread-a', '', false).source).toBe('memory');
    expect(memory.enter('thread-c', '', false).source).toBe('memory');
  });

  it('merges a loaded update against a newer process edit without growing a second cache', () => {
    const memory = new SessionPromptDraftMemory();
    memory.remember('thread-a', 'text before read');
    const snapshot = memory.capture('thread-a');
    memory.remember('thread-a', 'newer process edit');

    expect(memory.mergeLoaded(snapshot, 'older durable text', (latest) => `rejected\n${latest}`))
      .toBe('rejected\nnewer process edit');
    expect(memory.enter('thread-a', '', false).text).toBe('rejected\nnewer process edit');
  });
  it('keeps parked editor history on text acknowledgement, but invalidates it on a changed off-route draft', () => {
    const memory = new SessionPromptDraftMemory();
    const original = { ...createPromptState('alpha beta'), selection: { start: 0, end: 0 } };
    const editor = handlePromptKey(original, { key: 'x' }).state;
    memory.enter('a', '', false);
    memory.enter('b', editor.text, true, editor);
    memory.remember('a', editor.text);
    expect(memory.enter('a', '', false).editor).toBe(editor);
    memory.remember('a', 'rejected submission plus new text');
    expect(memory.enter('a', '', false).editor).toBeUndefined();
  });

  it('bounds aggregate parked undo/redo while retaining text, cursor and mode', () => {
    const memory = new SessionPromptDraftMemory(64, 25);
    const editor = handlePromptKey(createPromptState('abcdefghij'), { key: 'x' }).state;
    memory.remember('a', editor.text, editor);
    memory.remember('b', editor.text, editor);
    memory.enter('a', '', false);
    memory.remember('c', editor.text, { ...editor, undo: [], redo: editor.undo });
    expect(memory.enter('a', '', false).editor).toBe(editor);
    expect(memory.enter('b', '', false).editor).toEqual({ ...editor, undo: [], redo: [] });
    expect(memory.enter('c', '', false).editor?.redo).toEqual(editor.undo);
  });

  it('drops oversized history and releases budget after draft eviction or replacement', () => {
    const memory = new SessionPromptDraftMemory(2, 15);
    const editor = handlePromptKey(createPromptState('abcdefghij'), { key: 'x' }).state;
    memory.remember('oversized', editor.text, { ...editor, undo: [...editor.undo, ...editor.undo] });
    expect(memory.enter('oversized', '', false).editor?.undo).toEqual([]);
    memory.remember('a', editor.text, editor);
    memory.remember('b', 'plain');
    memory.remember('c', editor.text, editor);
    expect(memory.enter('c', '', false).editor).toBe(editor);
    memory.remember('c', 'changed');
    memory.remember('d', editor.text, editor);
    expect(memory.enter('d', '', false).editor).toBe(editor);
  });

});
