// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';

const openLink = vi.hoisted(() => vi.fn());

vi.mock('react-native', async () => {
  const { createElement } = await import('react');
  const Host = ({ children, accessible, accessibilityRole, accessibilityLabel, accessibilityHint, onPress, onAccessibilityTap, pointerEvents }: {
    children?: React.ReactNode;
    accessible?: boolean;
    accessibilityRole?: string;
    accessibilityLabel?: string;
    accessibilityHint?: string;
    onPress?: (event: { stopPropagation: () => void }) => void;
    onAccessibilityTap?: () => void;
    pointerEvents?: string;
  }) => createElement(accessibilityRole === 'link' ? 'a' : 'div', {
    role: accessibilityRole,
    'aria-label': accessibilityLabel,
    'data-hint': accessibilityHint,
    'data-accessible': String(accessible),
    'data-pointer-events': pointerEvents,
    'data-has-press': String(Boolean(onPress)),
    'data-has-accessibility-tap': String(Boolean(onAccessibilityTap)),
    onClick: onPress,
  }, children);
  return { View: Host, Text: Host, Pressable: Host, StyleSheet: { create: (value: unknown) => value, hairlineWidth: 1 } };
});
vi.mock('./openTranscriptLink', () => ({
  openTranscriptLink: openLink,
  transcriptLinkAccessibilityHint: () => 'Opens the cited file',
  transcriptLinkAccessibilityLabel: (target: { path: string }) => `Open file ${target.path.split('/').at(-1)}`,
}));
vi.mock('./GatewayImage', () => ({ GatewayImage: () => null }));

import { TranscriptSourceRow } from './TranscriptSourceRow';
import { TranscriptMarkdownLine } from './TranscriptMarkdownLine';
import { TranscriptLinkOpenerProvider } from './TranscriptLinkOpener';
import { compileTranscriptMarkdown } from './transcriptMarkdown';
import { buildVisibleTranscriptRenderRows } from './transcriptVisibleRows';
import { createTranscriptBuffer, createTranscriptVimState } from './transcriptVim';

it('keeps row navigation and the compiled citation as separate accessible actions', async () => {
  vi.stubGlobal('React', React);
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const container = document.createElement('div');
  const root = createRoot(container);
  const message = {
    id: 'citation', role: 'assistant' as const,
    text: 'Result: :codex-file-citation{path="/Users/fixture/Documents/final report.pdf"}',
  };
  const row = buildVisibleTranscriptRenderRows([message], new Set())[0]!;
  const navigation = createTranscriptVimState(createTranscriptBuffer([message]));
  const select = vi.fn();
  try {
    await act(async () => root.render(<TranscriptSourceRow
      row={row} navigation={navigation} focused fontScale={1} gutterWidth={32}
      sourceNavigationIndex={0} cursorNavigationIndex={0} onPress={select}
      onToggleFold={() => {}} onApprovalDecision={() => {}} onOpenMedia={() => {}} onRecoverMessage={() => {}}
    />));
    const rowAction = container.querySelector('[role="button"][aria-label^="assistant, line"]') as HTMLElement;
    const fileAction = container.querySelector('[role="link"][aria-label="Open file final report.pdf"]') as HTMLElement;
    const touchRow = container.querySelector('[data-accessible="false"][data-has-press="true"]') as HTMLElement;
    expect(rowAction).not.toBeNull();
    expect(rowAction.dataset.pointerEvents).toBe('none');
    expect(rowAction.dataset.hasAccessibilityTap).toBe('true');
    expect(fileAction).not.toBeNull();

    await act(async () => touchRow.click());
    expect(select).toHaveBeenCalledTimes(1);
    select.mockClear();
    await act(async () => fileAction.click());
    expect(openLink).toHaveBeenCalledWith({ kind: 'local-file', path: '/Users/fixture/Documents/final report.pdf' });
    expect(select).not.toHaveBeenCalled();
  } finally {
    await act(async () => root.unmount());
    vi.unstubAllGlobals();
    openLink.mockReset();
  }
});

it('routes table-cell links through the nearest transcript-scoped opener', async () => {
  vi.stubGlobal('React', React);
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const container = document.createElement('div');
  const root = createRoot(container);
  const line = compileTranscriptMarkdown('| File | Note |\n| --- | --- |\n| [guide](docs/guide.md#L4) | read |')[2]!;
  const navigation = createTranscriptVimState(createTranscriptBuffer([{ id: 'table', role: 'assistant', text: line.source }]));
  const scopedOpen = vi.fn();
  try {
    await act(async () => root.render(
      <TranscriptLinkOpenerProvider value={{ openLink: scopedOpen, getAccessibilityHint: () => 'Opens in project Files' }}>
        <TranscriptMarkdownLine line={line} row={0} navigation={navigation} fontScale={1} />
      </TranscriptLinkOpenerProvider>,
    ));
    const action = container.querySelector('[role="link"][aria-label="Open file guide.md"]') as HTMLElement;
    expect(action.dataset.hint).toBe('Opens in project Files');
    await act(async () => action.click());
    expect(scopedOpen).toHaveBeenCalledWith({ kind: 'local-file', path: 'docs/guide.md', rawTarget: 'docs/guide.md#L4', line: 4 });
    expect(openLink).not.toHaveBeenCalled();
  } finally {
    await act(async () => root.unmount());
    vi.unstubAllGlobals();
    openLink.mockReset();
  }
});

vi.mock('../questions/QuestionOtherEditor', () => ({ QuestionOtherEditor: () => null }));
