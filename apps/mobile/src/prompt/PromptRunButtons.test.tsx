// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { PromptAttachment } from './promptAttachments';
vi.mock('react-native', () => ({
  View: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  Text: ({ children }: { children?: React.ReactNode }) => <span>{children}</span>,
  Image: () => <span />,
  ScrollView: ({ children, accessibilityLabel }: { children?: React.ReactNode; accessibilityLabel?: string }) => <section aria-label={accessibilityLabel}>{children}</section>,
  Pressable: ({ children, onPress, accessibilityLabel, accessibilityState, disabled }: { children?: React.ReactNode; onPress: () => void; accessibilityLabel: string; accessibilityState?: { expanded?: boolean }; disabled?: boolean }) => <button disabled={disabled} aria-label={accessibilityLabel} aria-expanded={accessibilityState?.expanded} onClick={onPress}>{children}</button>,
  StyleSheet: { create: (styles: unknown) => styles },
}));
vi.mock('expo-symbols', () => ({ SymbolView: () => <span /> }));
vi.mock('../../modules/vimicate-editor', () => ({ PromptDropSurface: ({ children }: { children: import('react').ReactNode }) => <div>{children}</div>, VimicateEditorView: ({ editorState }: { editorState: string }) => <pre>{JSON.parse(editorState).text}</pre> }));
vi.mock('./PromptHistoryBrowserPanel', () => ({ PromptHistoryBrowserPanel: () => null }));
import { PromptPane } from './PromptPane';
import { createPromptState } from './vimPromptCore';

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
beforeEach(() => { vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); vi.stubGlobal('React', React); container = document.createElement('div'); document.body.append(container); root = createRoot(container); });
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); });

it.each([false, true])('keeps Send at the right-hand target through repeated steering and empty drafts (compact=%s)', async compact => {
  const submit = vi.fn(), abort = vi.fn();
  const render = (sending: boolean, text: string, attachments: PromptAttachment[] = [], historyOpen = false) => act(async () => root.render(
    <PromptPane state={createPromptState(text)} focusedPane="prompt" keyboardCapture height={180} fontScale={1} sending={sending}
      attachments={attachments} importing={false} attachmentLimitReached={false} compact={compact}
      softwareKeyboardRequested={false} softwareKeyboardForced={false} historyBrowser={{ open: historyOpen, entries: [], selectedIndex: -1 }}
      onState={vi.fn()} onFocusPrompt={vi.fn()} onRequestPromptFocus={vi.fn()} onHardwareKeyboardChange={vi.fn()}
      onHardwareKey={vi.fn()} onCommandHistory={vi.fn()} onPastedAttachment={vi.fn()} onPastedCommandLineText={vi.fn()} onSubmit={submit} onAbort={abort}
      onPickDocument={vi.fn()} onPickImage={vi.fn()} onPreviewAttachment={vi.fn()} onRemoveAttachment={vi.fn()}
      onOpenCommand={vi.fn()} onOpenNewThread={vi.fn()} onToggleHistory={vi.fn()} onCloseHistory={vi.fn()} onAcceptHistory={vi.fn()} />));
  const toolbarButtons = () => [...container.querySelectorAll<HTMLButtonElement>('button')];
  await render(false, 'first prompt');
  const target = toolbarButtons().at(-1)!;
  expect(target.getAttribute('aria-label')).toBe('Send prompt');
  await act(async () => target.click());
  expect(submit).toHaveBeenCalledTimes(1);
  await render(true, ''); // submission clears draft and starts the run
  expect(toolbarButtons().at(-1)).toBe(target);
  expect(target.getAttribute('aria-label')).toBe('Send prompt to active run');
  expect(target.disabled).toBe(true);
  expect(target.previousElementSibling?.getAttribute('aria-label')).toBe('Stop run');
  await act(async () => { target.click(); target.click(); });
  expect(submit).toHaveBeenCalledTimes(1);
  expect(abort).not.toHaveBeenCalled();
  for (const text of ['steer one', 'steer two']) {
    await render(true, text);
    expect(toolbarButtons().at(-1)).toBe(target);
    expect(target.disabled).toBe(false);
    await act(async () => target.click());
    await render(true, '');
    await act(async () => target.click());
  }
  expect(submit).toHaveBeenCalledTimes(3);
  expect(abort).not.toHaveBeenCalled();
  const image: PromptAttachment = { id: 'image', filename: 'screenshot.png', kind: 'image', uri: 'file:///fixture/image.png', byteCount: 200, mimeType: 'image/png' };
  await render(true, '', [image]);
  expect(toolbarButtons().at(-1)).toBe(target);
  expect(target.disabled).toBe(false);
  await act(async () => target.click());
  expect(submit).toHaveBeenCalledTimes(4);
  await render(true, 'draft retained', [], true);
  expect(target.disabled).toBe(true);
  const stop = target.previousElementSibling as HTMLButtonElement;
  await act(async () => stop.click());
  expect(abort).toHaveBeenCalledTimes(1);
  await render(false, 'draft retained');
  expect(toolbarButtons().at(-1)).toBe(target);
  expect(container.querySelector('[aria-label="Stop run"]')).toBeNull();
  expect(target.getAttribute('aria-label')).toBe('Send prompt');
  expect(target.disabled).toBe(false);
});
