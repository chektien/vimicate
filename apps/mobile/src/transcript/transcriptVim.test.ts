import { describe, expect, it } from 'vitest';
import type { HardwareKeyEvent } from '../../modules/vimicate-editor';
import type { WorkspaceMessage } from '../workspace/workspaceTypes';
import { applyTranscriptSearch, createTranscriptBuffer, createTranscriptVimState, handleTranscriptKey, projectTranscriptVimState, reconcileTranscriptVimState, revealTranscriptTailVimState, selectedTranscriptText, transcriptLineAt, transcriptLineHighlight, transcriptSearchRanges, updatedTranscriptBuffer } from './transcriptVim';

const messages: WorkspaceMessage[] = [
  { id: 'one', role: 'assistant', text: 'one two\nthree four' },
  { id: 'two', role: 'tool', text: 'five\nsix seven' },
];
const input = (key: string, extra: Partial<HardwareKeyEvent> = {}): HardwareKeyEvent => ({ key, shift: false, control: false, option: false, command: false, ...extra });

describe('transcript Vim reducer', () => {
  it('appends an optimistic prompt without reconstructing existing source rows', () => {
    const existing: WorkspaceMessage[] = [{ id: 'large-tool', role: 'tool', text: Array.from({ length: 20_000 }, (_, index) => `raw ${index}`).join('\n') }];
    const previous = createTranscriptBuffer(existing);
    const optimistic: WorkspaceMessage = { id: 'local-send', role: 'user', text: 'the exact submitted prompt', source: 'local' };
    const next = updatedTranscriptBuffer(existing, previous, [...existing, optimistic]);

    expect(next.lines).toHaveLength(20_001);
    expect(next.lines[0]).toBe(previous.lines[0]);
    expect(next.lines[19_999]).toBe(previous.lines[19_999]);
    expect(next.lines[20_000]).toMatchObject({ messageId: 'local-send', lineInMessage: 0, text: 'the exact submitted prompt' });
    expect(previous.lines).toHaveLength(20_000);

    const replaced = updatedTranscriptBuffer([...existing, optimistic], next, [...existing, { ...optimistic, text: 'the exact submitted prompt\nstreamed reply' }]);
    expect(replaced.lines[0]).toBe(next.lines[0]);
    expect(replaced.lines).toHaveLength(20_002);
    expect(replaced.lines.slice(-2).map((line) => line.text)).toEqual(['the exact submitted prompt', 'streamed reply']);
  });

  it('does not allocate one Vim line object for every hidden row in a huge folded message', () => {
    const huge: WorkspaceMessage = {
      id: 'huge-tool',
      role: 'tool',
      text: Array.from({ length: 20_000 }, (_, index) => `hidden ${index}`).join('\n'),
    };
    const buffer = createTranscriptBuffer([huge]);

    expect(buffer.lines).toHaveLength(20_000);
    expect(buffer.lines.filter(Boolean)).toHaveLength(1);
    expect(buffer.lines[0]).toMatchObject({ messageId: 'huge-tool', lineInMessage: 0, text: 'hidden 0' });
    expect(buffer.lines[19_999]).toBeUndefined();
    expect(transcriptLineAt(buffer, 19_999)).toMatchObject({ messageId: 'huge-tool', lineInMessage: 19_999, text: 'hidden 19999' });
  });

  it('keeps a pathological folded-history window sparse across every admitted message', () => {
    const huge = Array.from({ length: 20_000 }, (_, index) => `hidden ${index}`).join('\n');
    const buffer = createTranscriptBuffer(Array.from({ length: 480 }, (_, index): WorkspaceMessage => ({
      id: `tool-${index}`,
      role: 'tool',
      text: huge,
    })));

    expect(buffer.lines).toHaveLength(9_600_000);
    expect(Object.keys(buffer.lines)).toHaveLength(480);
    expect(transcriptLineAt(buffer, 9_599_999)).toMatchObject({ messageId: 'tool-479', lineInMessage: 19_999 });
  });

  it('flows horizontal motion across visible fold stops without entering hidden source rows', () => {
    const huge: WorkspaceMessage = { id: 'tool', role: 'tool', text: Array.from({ length: 20_000 }, (_, index) => `hidden ${index}`).join('\n') };
    const answer: WorkspaceMessage = { id: 'answer', role: 'assistant', text: 'done' };
    const buffer = createTranscriptBuffer([huge, answer]);
    const navigationRows = [0, 20_000];
    let state = { ...createTranscriptVimState(buffer), cursor: { row: 0, column: 'hidden 0'.length - 1 }, desiredColumn: 'hidden 0'.length - 1, followTail: false };

    state = handleTranscriptKey(buffer, state, input('l'), navigationRows).state;
    expect(state.cursor).toEqual({ row: 20_000, column: 0 });
    state = handleTranscriptKey(buffer, state, input('h'), navigationRows).state;
    expect(state.cursor).toEqual({ row: 0, column: 'hidden 0'.length - 1 });
  });

  it('reuses stable source-line objects while a huge cumulative answer grows', () => {
    const first: WorkspaceMessage = { id: 'stream', role: 'assistant', text: Array.from({ length: 20_000 }, (_, index) => `line ${index}`).join('\n') };
    const previous = createTranscriptBuffer([first]);
    const nextMessage = { ...first, text: `${first.text} continued` };
    const next = updatedTranscriptBuffer([first], previous, [nextMessage]);

    expect(next.lines).toHaveLength(20_000);
    expect(next.lines[0]).toBe(previous.lines[0]);
    expect(next.lines[19_998]).toBe(previous.lines[19_998]);
    expect(next.lines.filter(Boolean)).toHaveLength(1);
    expect(transcriptLineAt(next, 19_999)?.text).toBe('line 19999 continued');

    const appendedMessage = { ...nextMessage, text: `${nextMessage.text}\nline 20000` };
    const appended = updatedTranscriptBuffer([nextMessage], next, [appendedMessage]);
    expect(appended.lines).toHaveLength(20_001);
    expect(appended.lines[19_998]).toBe(next.lines[19_998]);
    expect(appended.lines.filter(Boolean)).toHaveLength(1);
    expect(transcriptLineAt(appended, 20_000)?.text).toBe('line 20000');
  });

  it('keeps explicit tail ownership but never reclaims review after the first motion', () => {
    const previous = createTranscriptBuffer([{ id: 'stream', role: 'assistant', text: 'one\ntwo\nthree\nfour' }]);
    const next = createTranscriptBuffer([{ id: 'stream', role: 'assistant', text: 'one\ntwo\nthree\nfour\nfive' }]);
    const following = createTranscriptVimState(previous);
    expect(reconcileTranscriptVimState(following, previous, next).cursor).toEqual({ row: 4, column: 0 });

    const review = handleTranscriptKey(previous, following, input('k')).state;
    expect(review).toMatchObject({ cursor: { row: 2, column: 0 }, followTail: false });
    expect(reconcileTranscriptVimState(review, previous, next).cursor).toEqual({ row: 2, column: 0 });
  });

  it('reconciles a folded tail atomically and retains identity on replayed equal revisions', () => {
    const previous = createTranscriptBuffer([{ id: 'tool', role: 'tool', text: 'summary\ndetail' }]);
    const projected = projectTranscriptVimState(createTranscriptVimState(previous), previous, [0]);
    const next = createTranscriptBuffer([{ id: 'tool', role: 'tool', text: 'summary\ndetail\nmore' }]);
    expect(reconcileTranscriptVimState(projected, previous, next, [0])).toBe(projected);
    const appended = createTranscriptBuffer([...next.messages!, { id: 'later', role: 'tool', text: 'next\nbody' }]);
    const advanced = reconcileTranscriptVimState(projected, next, appended, [0, 3]);
    expect(advanced).toMatchObject({ cursor: { row: 3, column: 0 }, followTail: true });
    expect(reconcileTranscriptVimState(advanced, appended, createTranscriptBuffer([...appended.messages!]), [0, 3])).toBe(advanced);
  });

  it('preserves navigation identity while streaming changes text inside the same source row', () => {
    const first: WorkspaceMessage = { id: 'stream', role: 'assistant', text: 'partial' };
    const previous = createTranscriptBuffer([first]);
    const next = updatedTranscriptBuffer([first], previous, [{ ...first, text: 'partial extension' }]);
    const following = createTranscriptVimState(previous);

    expect(reconcileTranscriptVimState(following, previous, next)).toBe(following);

    const appended = updatedTranscriptBuffer([{ ...first, text: 'partial extension' }], next, [{ ...first, text: 'partial extension\nsecond line' }]);
    const moved = reconcileTranscriptVimState(following, next, appended);
    expect(moved).not.toBe(following);
    expect(moved.cursor).toEqual({ row: 1, column: 0 });
  });

  it('moves both viewport authority and the Vim cursor to the latest row', () => {
    const buffer = createTranscriptBuffer([{ id: 'stream', role: 'assistant', text: 'one\ntwo\nthree\nfour' }]);
    const review = { ...createTranscriptVimState(buffer), cursor: { row: 1, column: 2 }, desiredColumn: 2, followTail: false, visualMode: 'character' as const, anchor: { row: 0, column: 0 } };
    expect(revealTranscriptTailVimState(buffer, review)).toMatchObject({
      cursor: { row: 3, column: 0 },
      desiredColumn: 0,
      followTail: true,
      visualMode: null,
      anchor: null,
      pending: '',
      count: '',
    });
  });

  it('supports character, line, word, document, count, and page motions', () => {
    const buffer = createTranscriptBuffer(messages);
    let state = createTranscriptVimState(buffer);
    state = handleTranscriptKey(buffer, state, input('g')).state;
    state = handleTranscriptKey(buffer, state, input('g')).state;
    expect(state.cursor).toEqual({ row: 0, column: 0 });
    state = handleTranscriptKey(buffer, state, input('w')).state;
    expect(state.cursor).toEqual({ row: 0, column: 4 });
    state = handleTranscriptKey(buffer, state, input('2')).state;
    state = handleTranscriptKey(buffer, state, input('j')).state;
    expect(state.cursor.row).toBe(2);
    state = handleTranscriptKey(buffer, state, input('$')).state;
    expect(state.cursor.column).toBe(4);
    state = handleTranscriptKey(buffer, state, input('b', { control: true })).state;
    expect(state.cursor.row).toBe(0);
    state = handleTranscriptKey(buffer, state, input('g', { shift: true })).state;
    expect(state.cursor.row).toBe(3);
  });

  it('treats big-word motions as whitespace-delimited across source rows', () => {
    const buffer = createTranscriptBuffer([{ id: 'words', role: 'assistant', text: 'one,two three\nfour-five six' }]);
    let state = handleTranscriptKey(buffer, createTranscriptVimState(buffer), input('g')).state;
    state = handleTranscriptKey(buffer, state, input('g')).state;
    expect(handleTranscriptKey(buffer, state, input('w')).state.cursor).toEqual({ row: 0, column: 3 });
    expect(handleTranscriptKey(buffer, state, input('W')).state.cursor).toEqual({ row: 0, column: 8 });
    expect(handleTranscriptKey(buffer, state, input('E')).state.cursor).toEqual({ row: 0, column: 6 });
    state = handleTranscriptKey(buffer, state, input('2')).state;
    state = handleTranscriptKey(buffer, state, input('W')).state;
    expect(state.cursor).toEqual({ row: 1, column: 0 });
    expect(handleTranscriptKey(buffer, state, input('B')).state.cursor).toEqual({ row: 0, column: 8 });
  });

  it('flows h/l directly across source lines without an invisible end column', () => {
    const buffer = createTranscriptBuffer([{ id: 'flow', role: 'assistant', text: 'ab\ncd\nef' }]);
    let state = createTranscriptVimState(buffer);
    state = handleTranscriptKey(buffer, state, input('g')).state;
    state = handleTranscriptKey(buffer, state, input('g')).state;
    state = handleTranscriptKey(buffer, state, input('l')).state;
    expect(state.cursor).toEqual({ row: 0, column: 1 });
    state = handleTranscriptKey(buffer, state, input('l')).state;
    expect(state.cursor).toEqual({ row: 1, column: 0 });
    state = handleTranscriptKey(buffer, state, input('h')).state;
    expect(state.cursor).toEqual({ row: 0, column: 1 });
    state = handleTranscriptKey(buffer, state, input('3')).state;
    state = handleTranscriptKey(buffer, state, input('l')).state;
    expect(state.cursor).toEqual({ row: 2, column: 0 });
  });

  it('implements v, V, Ctrl-V, movement extension, Escape, and exact yank text', () => {
    const buffer = createTranscriptBuffer(messages);
    let state = createTranscriptVimState(buffer);
    state = handleTranscriptKey(buffer, state, input('g')).state;
    state = handleTranscriptKey(buffer, state, input('g')).state;
    state = handleTranscriptKey(buffer, state, input('v')).state;
    state = handleTranscriptKey(buffer, state, input('w')).state;
    expect(selectedTranscriptText(buffer, state)).toBe('one t');
    const yanked = handleTranscriptKey(buffer, state, input('y'));
    expect(yanked.effect).toEqual({ type: 'yank', text: 'one t' });
    expect(yanked.state.visualMode).toBeNull();

    state = handleTranscriptKey(buffer, yanked.state, input('V', { shift: true })).state;
    state = handleTranscriptKey(buffer, state, input('j')).state;
    expect(selectedTranscriptText(buffer, state)).toBe('one two\nthree four');
    expect(transcriptLineHighlight(state, 1, 10).lineSelected).toBe(true);

    state = createTranscriptVimState(buffer);
    state = handleTranscriptKey(buffer, state, input('g')).state;
    state = handleTranscriptKey(buffer, state, input('g')).state;
    state = handleTranscriptKey(buffer, state, input('v', { control: true })).state;
    state = handleTranscriptKey(buffer, state, input('l')).state;
    state = handleTranscriptKey(buffer, state, input('j')).state;
    expect(selectedTranscriptText(buffer, state)).toBe('on\nth');
  });

  it('supports yy and yank motions without moving the transcript cursor', () => {
    const buffer = createTranscriptBuffer(messages);
    let state = createTranscriptVimState(buffer);
    state = handleTranscriptKey(buffer, state, input('g')).state;
    state = handleTranscriptKey(buffer, state, input('g')).state;
    const yy = handleTranscriptKey(buffer, handleTranscriptKey(buffer, state, input('y')).state, input('y'));
    expect(yy.effect).toEqual({ type: 'yank', text: 'one two' });
    const yw = handleTranscriptKey(buffer, handleTranscriptKey(buffer, state, input('y')).state, input('w'));
    expect(yw.effect).toEqual({ type: 'yank', text: 'one t' });
    expect(yw.state.cursor).toEqual({ row: 0, column: 0 });
  });

  it('yanks the visible tool summary instead of only its raw tool name', () => {
    const buffer = createTranscriptBuffer([{
      id: 'read-image', role: 'tool', text: 'read\nRead image file [image/jpeg]\n[Image: original 4110x1500]',
      tool: { name: 'read', summary: 'read · /fixture/example-notes/Example Research/teaser.png' },
    }]);
    let state = createTranscriptVimState(buffer);
    state = handleTranscriptKey(buffer, state, input('g')).state;
    state = handleTranscriptKey(buffer, state, input('g')).state;
    state = handleTranscriptKey(buffer, state, input('V', { shift: true })).state;

    expect(handleTranscriptKey(buffer, state, input('y')).effect).toEqual({
      type: 'yank', text: 'read · /fixture/example-notes/Example Research/teaser.png',
    });
  });

  it('supports inside/around word and delimiter text objects without triggering handoff', () => {
    const buffer = createTranscriptBuffer([{ id: 'objects', role: 'assistant', text: 'alpha [beta gamma] tail' }]);
    let state = createTranscriptVimState(buffer);
    state = handleTranscriptKey(buffer, state, input('g')).state;
    state = handleTranscriptKey(buffer, state, input('g')).state;
    const yiw = handleTranscriptKey(buffer, handleTranscriptKey(buffer, handleTranscriptKey(buffer, state, input('y')).state, input('i')).state, input('w'));
    expect(yiw.effect).toEqual({ type: 'yank', text: 'alpha' });

    state = handleTranscriptKey(buffer, state, input('w')).state;
    const vi = handleTranscriptKey(buffer, handleTranscriptKey(buffer, state, input('v')).state, input('i')).state;
    const viBracket = handleTranscriptKey(buffer, vi, input('['));
    expect(viBracket.effect).toEqual({ type: 'none' });
    expect(selectedTranscriptText(buffer, viBracket.state)).toBe('beta gamma');

    const ya = handleTranscriptKey(buffer, handleTranscriptKey(buffer, state, input('y')).state, input('a')).state;
    expect(handleTranscriptKey(buffer, ya, input('[')).effect).toEqual({ type: 'yank', text: '[beta gamma]' });
  });

  it('toggles the current message fold with za and reserves bracket prefixes from edit handoff', () => {
    const buffer = createTranscriptBuffer(messages);
    let state = createTranscriptVimState(buffer);
    const z = handleTranscriptKey(buffer, state, input('z'));
    expect(z.state.pending).toBe('z');
    expect(handleTranscriptKey(buffer, z.state, input('a')).effect).toEqual({ type: 'toggle-fold', messageId: 'two' });
    state = handleTranscriptKey(buffer, state, input('[')).state;
    expect(handleTranscriptKey(buffer, state, input('i')).effect).toEqual({ type: 'none' });
  });

  it('treats every collapsed tool range as one visible j/k stop', () => {
    const buffer = createTranscriptBuffer([
      { id: 'before', role: 'assistant', text: 'before' },
      { id: 'tool-one', role: 'tool', text: 'tool one\nhidden one\nhidden two\nhidden three' },
      { id: 'between', role: 'assistant', text: 'between' },
      { id: 'tool-two', role: 'tool', text: 'tool two\nhidden four\nhidden five' },
      { id: 'after', role: 'assistant', text: 'after' },
    ]);
    const visibleRows = [0, 1, 5, 6, 9];
    let state = createTranscriptVimState(buffer);
    state = handleTranscriptKey(buffer, state, input('k'), visibleRows).state;
    expect(state.cursor.row).toBe(6);
    state = handleTranscriptKey(buffer, state, input('k'), visibleRows).state;
    expect(state.cursor.row).toBe(5);
    state = handleTranscriptKey(buffer, state, input('k'), visibleRows).state;
    expect(state.cursor.row).toBe(1);
    state = handleTranscriptKey(buffer, state, input('k'), visibleRows).state;
    expect(state.cursor.row).toBe(0);
    state = handleTranscriptKey(buffer, state, input('2'), visibleRows).state;
    state = handleTranscriptKey(buffer, state, input('j'), visibleRows).state;
    expect(state.cursor.row).toBe(5);
  });

  it('immediately projects a cursor hidden by cumulative auto-folding onto the visible fold stop', () => {
    const buffer = createTranscriptBuffer([
      { id: 'before', role: 'user', text: 'before' },
      { id: 'stream', role: 'assistant', text: Array.from({ length: 620 }, (_, index) => `line ${index + 1}`).join('\n') },
      { id: 'after', role: 'assistant', text: 'after' },
    ]);
    const navigationRows = [0, 1, 621];
    const hidden = {
      ...createTranscriptVimState(buffer),
      cursor: { row: 340, column: 4 },
      desiredColumn: 4,
      visualMode: 'character' as const,
      anchor: { row: 300, column: 2 },
    };
    const projected = projectTranscriptVimState(hidden, buffer, navigationRows);
    expect(projected.cursor).toEqual({ row: 1, column: 0 });
    expect(projected.anchor).toEqual({ row: 1, column: 0 });
    expect(projected.desiredColumn).toBe(0);
    expect(handleTranscriptKey(buffer, projected, input('j'), navigationRows).state.cursor.row).toBe(621);
  });

  it('projects a search match inside a collapsed fold onto its mounted stop', () => {
    const buffer = createTranscriptBuffer([
      { id: 'before', role: 'user', text: 'before' },
      { id: 'folded', role: 'assistant', text: Array.from({ length: 620 }, (_, index) => `Streaming response line ${index + 1}`).join('\n') },
      { id: 'after', role: 'assistant', text: 'after' },
    ]);
    const navigationRows = [0, 1, 621];
    const found = applyTranscriptSearch(buffer, createTranscriptVimState(buffer), 'Streaming response line 500', 1, navigationRows);

    expect(found.matched).toBe(true);
    expect(found.state.cursor).toEqual({ row: 1, column: 0 });
    expect(found.state.searchQuery).toBe('Streaming response line 500');
    expect(handleTranscriptKey(buffer, found.state, input('j'), navigationRows).state.cursor.row).toBe(621);
  });

  it('starts slash search, wraps n/N targets, and preserves an active visual anchor', () => {
    const buffer = createTranscriptBuffer(messages);
    let state = createTranscriptVimState(buffer);
    expect(handleTranscriptKey(buffer, state, input('/')).effect).toEqual({ type: 'start-search' });
    state = handleTranscriptKey(buffer, state, input('v')).state;
    const found = applyTranscriptSearch(buffer, state, 'three', 1);
    expect(found.matched).toBe(true);
    expect(found.state.cursor).toEqual({ row: 1, column: 0 });
    expect(found.state.anchor).toEqual(state.anchor);
  });

  it('searches rendered Markdown text and lands on its original source coordinate', () => {
    const source = 'Updated [standup.md](</fixture/example-notes/standup.md>) after review';
    const buffer = createTranscriptBuffer([{ id: 'linked-answer', role: 'assistant', text: source }]);
    const found = applyTranscriptSearch(buffer, createTranscriptVimState(buffer), 'Updated standup.md', 1);

    expect(found.matched).toBe(true);
    expect(found.state.cursor).toEqual({ row: 0, column: 0 });
    expect(transcriptSearchRanges(source, 'Updated standup.md')).toEqual([{ start: 0, end: 18 }]);
  });

  it('searches a visible phrase across inline emphasis markers', () => {
    const source = '**Main finding:** improve the Test first';
    const buffer = createTranscriptBuffer([{ id: 'formatted-answer', role: 'assistant', text: source }]);
    const found = applyTranscriptSearch(buffer, createTranscriptVimState(buffer), 'Main finding: improve', 1);

    expect(found.matched).toBe(true);
    expect(found.state.cursor).toEqual({ row: 0, column: 2 });
    expect(transcriptSearchRanges(source, 'Main finding: improve')).toEqual([{ start: 2, end: 24 }]);
  });

  it('keeps all navigation and selection commands safe for an empty transcript', () => {
    const buffer = createTranscriptBuffer([]);
    const commands = ['h', 'j', 'k', 'l', 'g', 'g', 'G', 'v', 'V', 'y', 'y'];
    const state = commands.reduce((current, key) => handleTranscriptKey(buffer, current, input(key, { shift: key === key.toUpperCase() && key !== 'y' })).state, createTranscriptVimState(buffer));
    expect(state.cursor).toEqual({ row: 0, column: 0 });
  });
});
