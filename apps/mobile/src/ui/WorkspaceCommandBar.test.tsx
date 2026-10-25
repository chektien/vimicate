// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const viewport = vi.hoisted(() => ({ width: 375, height: 812 }));
vi.mock('react-native', () => ({
  useWindowDimensions: () => viewport,
  View: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  Text: ({ children }: { children?: React.ReactNode }) => <span>{children}</span>,
  Pressable: ({ children, accessibilityLabel, onPress }: { children?: React.ReactNode; accessibilityLabel: string; onPress: () => void }) =>
    <button aria-label={accessibilityLabel} onClick={onPress}>{children}</button>,
  FlatList: ({ data, renderItem, accessibilityLabel, keyboardDismissMode, keyboardShouldPersistTaps, style }: {
    data: { value: string }[]; renderItem: (info: { item: { value: string } }) => React.ReactNode;
    accessibilityLabel: string; keyboardDismissMode: string; keyboardShouldPersistTaps: string; style: unknown;
  }) => <section aria-label={accessibilityLabel} data-dismiss={keyboardDismissMode} data-taps={keyboardShouldPersistTaps} data-style={JSON.stringify(style)}>
    {data.map((item) => <React.Fragment key={item.value}>{renderItem({ item })}</React.Fragment>)}
  </section>,
  StyleSheet: { create: (styles: unknown) => styles, hairlineWidth: 1 },
}));
vi.mock('../../modules/vimicate-editor', () => ({
  VimicateCommandInputView: ({ inputAccessibilityLabel, value }: { inputAccessibilityLabel: string; value: string }) =>
    <input aria-label={inputAccessibilityLabel} value={value} readOnly />,
}));

import { WorkspaceCommandBar } from './WorkspaceCommandBar';
let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
const props = () => ({ search: null, command: { query: 'model ' }, commands: [],
  modelChoices: ['openai/gpt-6-astra', 'openai/gpt-5.6-sol', 'anthropic/claude-opus-5'],
  onQueryChange: vi.fn(), onSubmit: vi.fn(), onCancel: vi.fn(), onComplete: vi.fn(), onHistory: vi.fn(), onSelectCompletion: vi.fn(),
});
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  viewport.width = 375; viewport.height = 812;
  container = document.createElement('div'); document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); });

it('shows all candidates above the input in a bounded keyboard-preserving scroll list and fills without submitting', async () => {
  const p = props();
  await act(async () => root.render(<WorkspaceCommandBar {...p} />));
  const list = container.querySelector('section')!;
  expect(list.dataset.dismiss).toBe('none'); expect(list.dataset.taps).toBe('always');
  expect(JSON.parse(list.dataset.style!).maxHeight).toBe(132);
  expect(list.querySelectorAll('button')).toHaveLength(3);
  const input = container.querySelector('input')!;
  expect(list.compareDocumentPosition(input) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  await act(async () => (list.querySelector('button') as HTMLButtonElement).click());
  expect(p.onSelectCompletion).toHaveBeenCalledWith('openai/gpt-6-astra', p.command);
  expect(p.onSubmit).not.toHaveBeenCalled();
  await act(async () => (container.querySelector('[aria-label="Run command"]') as HTMLButtonElement).click());
  expect(p.onSubmit).toHaveBeenCalledOnce();
  await act(async () => (container.querySelector('[aria-label="Cancel command"]') as HTMLButtonElement).click());
  expect(p.onCancel).toHaveBeenCalledOnce();
});

it('retains the native input instance when filtering, and keeps the list bounded in landscape', async () => {
  const p = props();
  await act(async () => root.render(<WorkspaceCommandBar {...p} />));
  const input = container.querySelector('input');
  viewport.height = 375;
  await act(async () => root.render(<WorkspaceCommandBar {...p} command={{ query: 'model openai/' }} />));
  expect(container.querySelector('input')).toBe(input);
  expect(container.querySelectorAll('section button')).toHaveLength(2);
  expect(JSON.parse(container.querySelector('section')!.dataset.style!).maxHeight).toBe(75);
});

it('keeps hardware hints on wide layouts, and does not show command suggestions during search', async () => {
  viewport.width = 1024;
  const p = props();
  await act(async () => root.render(<WorkspaceCommandBar {...p} />));
  expect(container.textContent).toContain('Tab complete');
  await act(async () => root.render(<WorkspaceCommandBar {...p} command={null} search={{ query: 'needle', scope: 'transcript', direction: 1, softwareKeyboardEnabled: true }} />));
  expect(container.querySelector('section')).toBeNull();
  expect(container.querySelector('[aria-label="Search"]')).not.toBeNull();
});
