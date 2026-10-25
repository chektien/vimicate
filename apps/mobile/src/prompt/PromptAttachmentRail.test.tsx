// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { PromptAttachment } from './promptAttachments';
let attachmentSpaceLayout: ((event: { nativeEvent: { layout: { width: number } } }) => void) | undefined;
vi.mock('react-native', () => ({
  View: ({ children, accessibilityLabel, onLayout }: { children?: React.ReactNode; accessibilityLabel?: string; onLayout?: typeof attachmentSpaceLayout }) => {
    if (onLayout) attachmentSpaceLayout = onLayout;
    return <div aria-label={accessibilityLabel}>{children}</div>;
  },
  Text: ({ children }: { children?: React.ReactNode }) => <span>{children}</span>,
  Image: () => <span />,
  ScrollView: ({ children, accessibilityLabel, style, snapToInterval }: { children?: React.ReactNode; accessibilityLabel?: string; style?: Record<string, number>[]; snapToInterval?: number }) =>
    <section aria-label={accessibilityLabel} data-width={style?.at(-1)?.width} data-snap-interval={snapToInterval}>{children}</section>,
  Pressable: ({ children, onPress, accessibilityLabel, accessibilityState }: { children?: React.ReactNode; onPress: () => void; accessibilityLabel: string; accessibilityState?: { expanded?: boolean } }) => <button aria-label={accessibilityLabel} aria-expanded={accessibilityState?.expanded} onClick={onPress}>{children}</button>,
  StyleSheet: { create: (styles: unknown) => styles },
}));
vi.mock('expo-symbols', () => ({ SymbolView: () => <span /> }));
vi.mock('../../modules/vimicate-editor', () => ({ PromptDropSurface: ({ children }: { children: import('react').ReactNode }) => <div>{children}</div>, VimicateEditorView: ({ editorState }: { editorState: string }) => <pre>{JSON.parse(editorState).text}</pre> }));
vi.mock('./PromptHistoryBrowserPanel', () => ({ PromptHistoryBrowserPanel: () => null }));
import { PromptPane } from './PromptPane';
import { createPromptState } from './vimPromptCore';
const unchangedDraft = vi.fn();
function AttachmentControls(props: { attachments: PromptAttachment[]; compact: boolean; sending?: boolean; onPreviewAttachment: (id: string) => void; onRemoveAttachment: (id: string) => void }) {
  return <PromptPane {...props} state={createPromptState('some more updates')} focusedPane="prompt" keyboardCapture height={112} fontScale={1} sending={props.sending ?? false} importing={false} attachmentLimitReached={props.attachments.length === 10}
    softwareKeyboardRequested={false} softwareKeyboardForced={false} historyBrowser={{ open: false, entries: [], selectedIndex: -1 }}
    onState={unchangedDraft} onFocusPrompt={unchangedDraft} onRequestPromptFocus={unchangedDraft}
    onHardwareKeyboardChange={vi.fn()} onHardwareKey={vi.fn()} onCommandHistory={vi.fn()} onPastedAttachment={vi.fn()} onPastedCommandLineText={vi.fn()} onSubmit={unchangedDraft} onAbort={vi.fn()}
    onPickDocument={vi.fn()} onPickImage={vi.fn()} onOpenCommand={vi.fn()} onOpenNewThread={vi.fn()} onToggleHistory={vi.fn()} onCloseHistory={vi.fn()} onAcceptHistory={vi.fn()} />;
}
let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
beforeEach(() => { unchangedDraft.mockClear(); attachmentSpaceLayout = undefined; vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); vi.stubGlobal('React', React); container = document.createElement('div'); document.body.append(container); root = createRoot(container); });
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); });
const attachments: PromptAttachment[] = Array.from({ length: 4 }, (_, i) => ({ id: `image-${i}`, filename: 'pasted-screenshot.png', kind: 'image', uri: `file:///fixture/${i}.png`, byteCount: 200, mimeType: 'image/png' }));
const button = (label: string, scope: ParentNode = container) => scope.querySelector(`[aria-label="${label}"]`) as HTMLButtonElement;
async function layoutAttachmentSpace(width: number) {
  expect(attachmentSpaceLayout).toBeTypeOf('function');
  await act(async () => attachmentSpaceLayout!({ nativeEvent: { layout: { width } } }));
}
it('shows multiple complete thumbnails when measured toolbar space permits, and reverts to a single swipe slot when narrow or Stop appears', async () => {
  const preview = vi.fn(), remove = vi.fn();
  const render = (compact: boolean, sending = false) => act(async () => root.render(<AttachmentControls attachments={attachments} compact={compact} sending={sending} onPreviewAttachment={preview} onRemoveAttachment={remove} />));
  await render(false);
  const rail = () => container.querySelector('[aria-label="Prompt attachments"]')!;
  expect(rail().getAttribute('data-width')).toBe('34'); // safe before native measurement
  await layoutAttachmentSpace(150);
  expect(rail().getAttribute('data-width')).toBe('68'); // two full 34pt images, not a count control
  expect(rail().getAttribute('data-snap-interval')).toBe('34');
  await layoutAttachmentSpace(75);
  expect(rail().getAttribute('data-width')).toBe('34');
  await render(true);
  // iPhone (6 Oct): 115pt between the attach buttons and the right-hand
  // controls showed one thumbnail, because the hidden hint's room was reserved.
  await layoutAttachmentSpace(115);
  expect(rail().getAttribute('data-width')).toBe('90');
  await layoutAttachmentSpace(135);
  expect(rail().getAttribute('data-width')).toBe('120');
  await render(true, true);
  await layoutAttachmentSpace(78); // active-run Stop reduces measured space
  expect(rail().getAttribute('data-width')).toBe('60');
  await layoutAttachmentSpace(40);
  expect(rail().getAttribute('data-width')).toBe('30');
  for (const label of ['Attach images', 'Attach files', 'Open prompt history', 'Open colon command', 'Start new thread', 'Escape', 'Show navigation keys', 'Stop run', 'Send prompt to active run']) expect(button(label)).not.toBeNull();
  expect(button('Show all 4 attachments')).toBeNull();
  expect(unchangedDraft).not.toHaveBeenCalled();
});
it('caps the rail at staged media count and preserves mixed-file and same-name image identities through removal', async () => {
  const preview = vi.fn(), remove = vi.fn();
  const mixed: PromptAttachment[] = [attachments[0]!, { id: 'file-1', filename: 'notes.pdf', kind: 'file', uri: 'file:///fixture/notes.pdf', byteCount: 1200, mimeType: 'application/pdf' }, attachments[1]!];
  const render = (items: PromptAttachment[]) => act(async () => root.render(<AttachmentControls attachments={items} compact={false} onPreviewAttachment={preview} onRemoveAttachment={remove} />));
  await render(mixed);
  await layoutAttachmentSpace(900);
  const rail = container.querySelector('[aria-label="Prompt attachments"]')!;
  expect(rail.getAttribute('data-width')).toBe('102');
  expect(rail.querySelector('[aria-label="Attachment 2 of 3: notes.pdf, 1.2 KB"]')).not.toBeNull();
  await act(async () => button('Remove attachment 2: notes.pdf', rail).click());
  expect(remove).toHaveBeenCalledWith('file-1');
  await render([attachments[0]!, attachments[1]!]);
  expect(rail.getAttribute('data-width')).toBe('68');
  await act(async () => button('Preview attachment 2: pasted-screenshot.png', rail).click());
  expect(preview).toHaveBeenCalledWith('image-1');
  await act(async () => button('Remove attachment 1: pasted-screenshot.png', rail).click());
  expect(remove).toHaveBeenLastCalledWith('image-0');
  expect(unchangedDraft).not.toHaveBeenCalled();
});
it.each([false, true])('uses one swipe rail with direct preview/removal and no more button (compact=%s)', async compact => {
  const preview = vi.fn(), remove = vi.fn();
  await act(async () => root.render(<AttachmentControls attachments={attachments} compact={compact} onPreviewAttachment={preview} onRemoveAttachment={remove} />));
  expect(button('Show all 4 attachments')).toBeNull();
  const rail = container.querySelector('[aria-label="Prompt attachments"]')!;
  expect(rail).not.toBeNull();
  expect(rail.querySelectorAll('button[aria-label^="Preview"]')).toHaveLength(4);
  await act(async () => button('Preview attachment 4: pasted-screenshot.png', rail).click());
  expect(preview).toHaveBeenCalledWith('image-3');
  expect(remove).not.toHaveBeenCalled();
  await act(async () => button('Remove attachment 3: pasted-screenshot.png', rail).click());
  expect(remove).toHaveBeenCalledWith('image-2');
  await act(async () => root.render(<AttachmentControls attachments={attachments.filter(a => a.id !== 'image-2')} compact={compact} onPreviewAttachment={preview} onRemoveAttachment={remove} />));
  expect(container.querySelectorAll('button[aria-label^="Preview"]')).toHaveLength(3);
  await act(async () => button('Preview attachment 3: pasted-screenshot.png').click());
  expect(preview).toHaveBeenLastCalledWith('image-3');
  expect(unchangedDraft).not.toHaveBeenCalled();
  expect(container.textContent).toContain('some more updates');
  await act(async () => root.render(<AttachmentControls attachments={[]} compact={compact} onPreviewAttachment={preview} onRemoveAttachment={remove} />));
  expect(container.querySelector('[aria-label="Prompt attachments"]')).toBeNull();
});
