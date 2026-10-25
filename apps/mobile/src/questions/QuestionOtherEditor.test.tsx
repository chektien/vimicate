// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { HardwareKeyEvent, VimicateEditorViewProps } from '../../modules/vimicate-editor/src/VimicateEditor.types';

const native = vi.hoisted(() => ({ props: {} as VimicateEditorViewProps }));
vi.mock('react-native', () => ({
  View: ({ children, accessibilityLabel }: { children?: React.ReactNode; accessibilityLabel?: string }) => <div aria-label={accessibilityLabel}>{children}</div>,
  Text: ({ children }: { children?: React.ReactNode }) => <span>{children}</span>,
  Pressable: ({ children, onPress, accessibilityLabel }: { children?: React.ReactNode; onPress: () => void; accessibilityLabel: string }) => <button aria-label={accessibilityLabel} onClick={onPress}>{children}</button>,
  StyleSheet: { create: (styles: unknown) => styles },
}));
vi.mock('../../modules/vimicate-editor', () => ({ VimicateEditorView: (props: VimicateEditorViewProps) => { native.props = props; return <pre>{props.editorState}</pre>; } }));
import { QuestionOtherEditor, type QuestionOtherEditorProps } from './QuestionOtherEditor';

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
let props: QuestionOtherEditorProps;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  props = { value: '', scope: 'question-a/other/0', fontScale: 1, maxLength: 8000, accessibilityLabel: 'Channel other answer', onChange: vi.fn(), onDone: vi.fn(), onExit: vi.fn() };
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); });
const render = (overrides: Partial<QuestionOtherEditorProps> = {}) => act(async () => { props = { ...props, ...overrides }; root.render(<QuestionOtherEditor {...props} />); });
const state = () => JSON.parse(native.props.editorState) as { text: string; mode: 'normal' | 'insert'; authority: number; revision: number; scope: string; selectionStart: number; selectionEnd: number };
const input = (key: string, extras: Partial<HardwareKeyEvent> = {}): HardwareKeyEvent => ({ key, shift: false, command: false, control: false, option: false, ...extras });
const key = (key: string, extras: Partial<HardwareKeyEvent> = {}) => act(async () => native.props.onHardwareKey?.({ nativeEvent: input(key, extras) }));
const text = (value: string, caret = value.length, authority = state().authority) => act(async () => native.props.onTextChange?.({ nativeEvent: { text: value, selectionStart: caret, selectionEnd: caret, textAuthority: authority } }));
const tap = (label: string) => act(async () => container.querySelector<HTMLButtonElement>(`[aria-label="${label}"]`)!.click());

it('starts in insert with native input enabled and a visible mode and Done action', async () => {
  await render({ value: 'staging' });
  expect(state()).toMatchObject({ text: 'staging', mode: 'insert', selectionStart: 7 });
  expect(native.props).toMatchObject({ focused: true, cursorVisible: true, captureAllKeys: false, softwareKeyboardEnabled: true, repeatAuthority: props.scope });
  expect(container.textContent).toContain('INSERT');
  expect(container.querySelector('[aria-label="Done editing other answer"]')).not.toBeNull();
});

it('flushes pending native insertion from Escape before changing to normal', async () => {
  await render({ value: 'a' });
  const generation = state().authority;
  await key('escape', { text: 'abc', selectionStart: 3, selectionEnd: 3, textAuthority: generation });
  expect(state()).toMatchObject({ text: 'abc', mode: 'normal', selectionStart: 2 });
  expect(props.onChange).toHaveBeenLastCalledWith('abc');
  expect(props.onDone).not.toHaveBeenCalled(); expect(props.onExit).not.toHaveBeenCalled();
  await text('late native edit', 3, generation);
  expect(state().text).toBe('abc');
  await key('i');
  await text('late native edit', 3, generation);
  expect(state().text).toBe('abc');
});

it('keeps native insert Enter as a newline and normal Enter as Done exactly once', async () => {
  await render();
  await text('line one\nline two');
  expect(state().text).toBe('line one\nline two');
  expect(props.onDone).not.toHaveBeenCalled();
  await key('escape');
  const callback = native.props.onHardwareKey;
  await act(async () => { callback?.({ nativeEvent: input('enter') }); callback?.({ nativeEvent: input('enter') }); });
  expect(props.onDone).toHaveBeenCalledTimes(1);
  expect(props.onExit).not.toHaveBeenCalled();
});

it('supports local Vim motions, operators and undo without routing j/k outside the editor', async () => {
  await render({ value: 'alpha beta\ngamma' });
  await key('escape'); await key('g'); await key('g'); await key('d'); await key('w');
  expect(state().text).toBe('beta\ngamma');
  await key('u');
  expect(state().text).toBe('alpha beta\ngamma');
  await key('j'); expect(state().selectionStart).toBe(11);
  await key('k'); expect(state().selectionStart).toBe(0);
  expect(props.onDone).not.toHaveBeenCalled(); expect(props.onExit).not.toHaveBeenCalled();
});

it('reduces unrendered normal-to-insert key bursts against synchronous latest state', async () => {
  await render({ value: 'ab' }); await key('escape');
  const callback = native.props.onHardwareKey!;
  await act(async () => {
    for (const value of ['0', 'i', 'x', 'y', 'escape']) callback({ nativeEvent: input(value) });
  });
  expect(state()).toMatchObject({ text: 'xyab', mode: 'normal', selectionStart: 1 });
});

it('cancels pending operators, counts and visual selection before Escape exits', async () => {
  await render({ value: 'answer' }); await key('escape'); await key('d'); await key('escape');
  expect(props.onExit).not.toHaveBeenCalled();
  await key('2'); await key('escape'); expect(props.onExit).not.toHaveBeenCalled();
  await key('v'); await key('escape'); expect(props.onExit).not.toHaveBeenCalled();
  await key('escape'); expect(props.onExit).toHaveBeenCalledTimes(1);
});

it('enforces the length ceiling and bumps authority even when truncation restores the same text', async () => {
  await render({ value: 'abc', maxLength: 3 });
  const before = state();
  await text('abcdef');
  expect(state()).toMatchObject({ text: 'abc', selectionStart: 3, selectionEnd: 3 });
  expect(state().authority).toBeGreaterThan(before.authority);
  expect(state().revision).toBeGreaterThan(before.revision);
  await text('ab', 2, before.authority); expect(state().text).toBe('abc');
  await key('escape'); await key('A'); await key('z'); expect(state().text).toBe('abc');
  await text('ab'); expect(props.onChange).toHaveBeenLastCalledWith('ab');
});

it('preserves cursor and undo across controlled value echoes', async () => {
  await render(); await text('abc', 1);
  const inserted = state();
  await render({ value: 'abc' }); expect(state()).toEqual(inserted);
  await key('escape'); await key('u'); expect(state().text).toBe('');
});

it('external values replace authority without letting prior callbacks edit the replacement', async () => {
  await render({ value: 'before' }); await key('escape'); await key('h');
  const stale = native.props;
  const prior = state();
  await render({ value: 'external' });
  expect(state()).toMatchObject({ text: 'external', mode: 'insert', selectionStart: 8 });
  expect(state().revision).toBeGreaterThan(prior.revision);
  expect(state().authority).toBeGreaterThan(prior.authority);
  await act(async () => stale.onTextChange?.({ nativeEvent: { text: 'stale', selectionStart: 5, selectionEnd: 5, textAuthority: prior.authority } }));
  expect(state().text).toBe('external');
});

it('rejects stale selection revisions and scopes while accepting current native selection', async () => {
  await render({ value: 'abc' });
  const current = state();
  const selection = (editorRevision: number, scope: string) => act(async () => native.props.onSelectionChange?.({ nativeEvent: { selectionStart: 0, selectionEnd: 0, userInitiated: true, editorRevision, scope } }));
  await selection(current.revision - 1, current.scope); expect(state().selectionStart).toBe(3);
  await selection(current.revision, 'other-scope'); expect(state().selectionStart).toBe(3);
  await selection(current.revision, current.scope); expect(state().selectionStart).toBe(0);
});

it('invalidates every previous-scope callback even for equal-text questions', async () => {
  await render({ value: 'same' }); const old = native.props; const prior = state();
  await render({ scope: 'question-b/other/0' }); const next = state();
  expect(next.revision).toBeGreaterThan(prior.revision);
  await act(async () => {
    old.onTextChange?.({ nativeEvent: { text: 'wrong question', selectionStart: 3, selectionEnd: 3, textAuthority: prior.authority } });
    old.onHardwareKey?.({ nativeEvent: input('escape') });
    old.onSelectionChange?.({ nativeEvent: { selectionStart: 0, selectionEnd: 0, userInitiated: true } });
  });
  expect(state()).toEqual(next); expect(props.onChange).not.toHaveBeenCalled();
});

it('provides touch mode switching and Done, and ignores callbacks after unmount', async () => {
  await render({ value: 'answer' });
  await tap('Other answer normal mode'); expect(state().mode).toBe('normal');
  await tap('Other answer insert mode'); expect(state().mode).toBe('insert');
  await text('updated'); await tap('Done editing other answer'); expect(props.onDone).toHaveBeenCalledTimes(1);
  const old = native.props;
  await act(async () => root.render(null));
  await act(async () => old.onHardwareKey?.({ nativeEvent: input('enter') }));
  expect(props.onDone).toHaveBeenCalledTimes(1);
});

it('tapping a normal-mode answer enters insert at the touched caret', async () => {
  await render({ value: 'alpha beta' }); await key('escape');
  await act(async () => native.props.onEditorTap?.({ nativeEvent: { selectionStart: 3, selectionEnd: 3 } }));
  expect(state()).toMatchObject({ mode: 'insert', selectionStart: 3, selectionEnd: 3 });
  expect(props.onDone).not.toHaveBeenCalled(); expect(props.onExit).not.toHaveBeenCalled();
});
