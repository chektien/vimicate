// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const native = vi.hoisted(() => ({ props: {} as import('../../modules/vimicate-editor/src/VimicateEditor.types').VimicateEditorViewProps }));
vi.mock('react-native', () => ({
  View: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  Text: ({ children }: { children?: React.ReactNode }) => <span>{children}</span>,
  Image: () => <span />,
  ScrollView: ({ children, accessibilityLabel }: { children?: React.ReactNode; accessibilityLabel?: string }) => <section aria-label={accessibilityLabel}>{children}</section>,
  Pressable: ({ children, onPress, accessibilityLabel, disabled }: { children?: React.ReactNode; onPress: () => void; accessibilityLabel: string; disabled?: boolean }) => <button disabled={disabled} aria-label={accessibilityLabel} onClick={onPress}>{children}</button>,
  StyleSheet: { create: (styles: unknown) => styles },
}));
vi.mock('expo-symbols', () => ({ SymbolView: () => <span /> }));
vi.mock('../../modules/vimicate-editor', () => ({ PromptDropSurface: ({ children }: { children: import('react').ReactNode }) => <div>{children}</div>, VimicateEditorView: (props: typeof native.props) => { native.props = props; return <pre>{props.navigationCommand}</pre>; } }));
vi.mock('./PromptHistoryBrowserPanel', () => ({ PromptHistoryBrowserPanel: () => null }));
import { PromptPane } from './PromptPane';
import { createPromptState } from './vimPromptCore';

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
beforeEach(() => { vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); vi.stubGlobal('React', React); container = document.createElement('div'); document.body.append(container); root = createRoot(container); });
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); });

const commandHistory = vi.fn();
const requestPromptFocus = vi.fn();
const render = (commandLineActive: boolean, commandHistoryActive: boolean, overrides: Partial<Parameters<typeof PromptPane>[0]> = {}) => act(async () => root.render(
  <PromptPane state={createPromptState('draft')} focusedPane="prompt" keyboardCapture height={180} fontScale={1} sending={false}
    commandLineActive={commandLineActive} commandLineNativeInputActive={commandLineActive} commandHistoryActive={commandHistoryActive}
    attachments={[]} importing={false} attachmentLimitReached={false}
    softwareKeyboardRequested={false} softwareKeyboardForced={false} historyBrowser={{ open: false, entries: [], selectedIndex: -1 }}
    onState={vi.fn()} onFocusPrompt={vi.fn()} onRequestPromptFocus={requestPromptFocus} onHardwareKeyboardChange={vi.fn()}
    onHardwareKey={vi.fn()} onCommandHistory={commandHistory} onPastedAttachment={vi.fn()} onPastedCommandLineText={vi.fn()}
    onSubmit={vi.fn()} onAbort={vi.fn()} onPickDocument={vi.fn()} onPickImage={vi.fn()} onPreviewAttachment={vi.fn()} onRemoveAttachment={vi.fn()}
    onOpenCommand={vi.fn()} onOpenNewThread={vi.fn()} onToggleHistory={vi.fn()} onCloseHistory={vi.fn()} onAcceptHistory={vi.fn()} {...overrides} />));
const button = (label: string) => container.querySelector(`[aria-label="${label}"]`) as HTMLButtonElement | null;
const expandNavigation = () => act(async () => button('Show navigation keys')!.click());
const navigationCommand = () => container.querySelector('pre')!.textContent;

beforeEach(() => { commandHistory.mockClear(); requestPromptFocus.mockClear(); });

it('gives the toolbar arrows to colon command history while the command line is open', async () => {
  await render(true, true);
  await expandNavigation();
  const idle = navigationCommand();
  await act(async () => button('Recall older command')!.click());
  expect(commandHistory).toHaveBeenLastCalledWith(-1);
  await act(async () => button('Recall newer command')!.click());
  expect(commandHistory).toHaveBeenLastCalledWith(1);
  // The command input owns the responder; recall must not steal focus back to the editor.
  expect(requestPromptFocus).not.toHaveBeenCalled();
  expect(navigationCommand()).toBe(idle);
  expect(button('Move left')!.disabled).toBe(true);
  expect(button('Move right')!.disabled).toBe(true);
});

it('keeps every arrow inert for a search line, which has no history', async () => {
  await render(true, false);
  await expandNavigation();
  const idle = navigationCommand();
  for (const key of ['left', 'down', 'up', 'right']) {
    expect(button(`Move ${key}`)!.disabled).toBe(true);
    await act(async () => button(`Move ${key}`)!.click());
  }
  expect(commandHistory).not.toHaveBeenCalled();
  expect(navigationCommand()).toBe(idle);
});

it('still moves the prompt caret when no command line is open', async () => {
  await render(false, false);
  await expandNavigation();
  const idle = navigationCommand();
  await act(async () => button('Move up')!.click());
  expect(commandHistory).not.toHaveBeenCalled();
  expect(requestPromptFocus).toHaveBeenCalledTimes(1);
  expect(navigationCommand()).not.toBe(idle);
  expect(JSON.parse(navigationCommand()!).key).toBe('up');
});

it('publishes a scoped half-page command against the committed native editor revision', async () => {
  const state = createPromptState('a long wrapped draft');
  const request = { revision: 1, key: 'halfPageDown' as const, scope: 'thread-a', state };
  await render(false, false, { sessionKey: 'thread-a', state, navigationRequest: request });
  expect(JSON.parse(navigationCommand()!)).toMatchObject({ key: 'halfPageDown', scope: 'thread-a', editorRevision: JSON.parse(native.props.editorState).revision });
  const first = navigationCommand();
  await render(false, false, { sessionKey: 'thread-a', state, navigationRequest: request });
  expect(navigationCommand()).toBe(first);
  await render(false, false, { sessionKey: 'thread-a', state, navigationRequest: { ...request, revision: 2, key: 'halfPageUp' } });
  expect(JSON.parse(navigationCommand()!).key).toBe('halfPageUp');
  expect(JSON.parse(navigationCommand()!).revision).toBeGreaterThan(JSON.parse(first!).revision);
});

it('drops paging requests overtaken by an edit, session change or command line', async () => {
  const state = createPromptState('same draft');
  const navigationRequest = { revision: 1, key: 'halfPageUp' as const, scope: 'thread-a', state };
  await render(false, false, { sessionKey: 'thread-b', state, navigationRequest });
  const idle = navigationCommand();
  await render(false, false, { sessionKey: 'thread-a', state: createPromptState('new draft'), navigationRequest: { ...navigationRequest, revision: 2 } });
  expect(navigationCommand()).toBe(idle);
  await render(true, true, { sessionKey: 'thread-a', state, navigationRequest: { ...navigationRequest, revision: 3 } });
  expect(navigationCommand()).toBe(idle);
});

it('accepts the owned page result but ignores a result after another edit or equal-text session switch', async () => {
  const state = createPromptState('same draft');
  const onState = vi.fn();
  await render(false, false, { sessionKey: 'thread-a', state, onState });
  const firstEditor = JSON.parse(native.props.editorState);
  const callback = native.props.onSelectionChange!;
  const event = { nativeEvent: { selectionStart: 2, selectionEnd: 2, userInitiated: true, scope: 'thread-a', editorRevision: firstEditor.revision } };
  callback(event);
  expect(onState.mock.calls.at(-1)![0](state).selection).toEqual({ start: 2, end: 2 });
  const edited = createPromptState('new draft');
  expect(onState.mock.calls.at(-1)![0](edited)).toBe(edited);
  await render(false, false, { sessionKey: 'thread-b', state, onState });
  callback(event);
  expect(onState.mock.calls.at(-1)![0](state)).toBe(state);
  const switchedEditor = JSON.parse(native.props.editorState);
  expect(switchedEditor.revision).toBeGreaterThan(firstEditor.revision);
  native.props.onSelectionChange!({ nativeEvent: { ...event.nativeEvent, scope: 'thread-b', editorRevision: firstEditor.revision } });
  expect(onState.mock.calls.at(-1)![0](state)).toBe(state);
});

it.each([
  { focusedPane: 'transcript' as const }, { inputBlocked: true }, { commandLineActive: true },
  { historyBrowser: { open: true, entries: [], selectedIndex: -1 } },
])('does not apply a delayed page result after input ownership changes to %j', async (overrides) => {
  const state = createPromptState('keep caret');
  const onState = vi.fn();
  await render(false, false, { sessionKey: 'thread-a', state, onState });
  const editorRevision = JSON.parse(native.props.editorState).revision;
  await render(false, false, { sessionKey: 'thread-a', state, onState, ...overrides });
  native.props.onSelectionChange!({ nativeEvent: { selectionStart: 0, selectionEnd: 0, userInitiated: true, scope: 'thread-a', editorRevision } });
  expect(onState.mock.calls.at(-1)![0](state)).toBe(state);
});
