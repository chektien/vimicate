// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { WorkspaceMessage } from '../workspace/workspaceTypes';
vi.mock('react-native', async () => {
  const { createElement } = await import('react');
  const Host = ({ children, accessibilityLabel, style }: { children?: React.ReactNode; accessibilityLabel?: string; style?: unknown }) =>
    createElement('div', { 'aria-label': accessibilityLabel, 'data-style': JSON.stringify(style) }, children);
  return { View: Host, Text: Host, Pressable: Host, StyleSheet: { create: (v: unknown) => v, hairlineWidth: 1 } };
});
vi.mock('@shopify/flash-list', async () => {
  const { createElement, forwardRef } = await import('react');
  return { FlashList: forwardRef(({ data, renderItem, ListHeaderComponent }: {
    data: Array<{ key: string }>; renderItem: (v: unknown) => React.ReactNode; ListHeaderComponent: React.ReactNode;
  }, _ref) => createElement('div', { 'data-list': true }, ListHeaderComponent,
    ...data.map((item, index) => createElement('section', { key: item.key, 'data-cell': item.key }, renderItem({ item, index }))))) };
});
vi.mock('./useTranscriptViewport', () => ({ useTranscriptViewport: () => ({ list: { current: null },
  retireUnchangedOlderHistoryAnchor: () => undefined, onOlderHistoryLayoutCommit: () => undefined }) }));
vi.mock('../../modules/vimicate-diagnostics', () => ({ recordViewportDiagnostic: () => undefined }));
vi.mock('./GatewayImage', () => ({ GatewayImage: () => null }));
vi.mock('./TranscriptMarkdownLine', () => ({ TranscriptMarkdownLine: ({ line }: { line: { source: string } }) => <span>{line.source}</span> }));
import { TranscriptPane } from './TranscriptPane';
import { transcriptChronology } from './transcriptChronology';
import { createTranscriptBuffer, createTranscriptVimState } from './transcriptVim';
let root: Root; let container: HTMLDivElement;
const noop = () => undefined;
const message = (id: string, day = 8): WorkspaceMessage => ({ id, role: 'narration', text: id, timestamp: new Date(2026, 8, day, 10).toISOString() });
async function render(messages: WorkspaceMessage[], loadingOlder = false) {
  const buffer = createTranscriptBuffer(messages);
  await act(async () => root.render(<TranscriptPane datasetKey="dates" messages={messages} buffer={buffer}
    navigation={createTranscriptVimState(buffer)} focused fontScale={1} onFocus={noop} onSelect={noop}
    onNavigationProjection={noop} onViewportReview={noop} onApprovalDecision={noop} onRecoverMessage={noop}
    onOpenMedia={noop} canLoadOlder loadingOlder={loadingOlder} onLoadOlder={noop} onRetryHistory={noop} />));
}
function contentInset(id: string) {
  const cell = container.querySelector(`[data-cell="${id}:0"]`)!;
  const body = cell.querySelector('[aria-label^="narration, line"]')!;
  let inset = 0;
  for (let node = body.previousElementSibling; node; node = node.previousElementSibling) {
    const style = JSON.parse(node.getAttribute('data-style') ?? '{}') as { minHeight?: number };
    inset += style.minHeight ?? 0;
  }
  return inset;
}
beforeEach(() => { vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); vi.stubGlobal('React', React); container = document.createElement('div'); root = createRoot(container); });
afterEach(async () => { await act(async () => root.unmount()); vi.unstubAllGlobals(); });
it.each([8, 7])('keeps the reviewed text fixed within its anchored cell when prepending day %s', async day => {
  const original = [message('reviewed'), message('later')];
  await render(original); const baseline = contentInset('reviewed');
  await render(original, true); expect(contentInset('reviewed')).toBe(baseline);
  await render([message('older', day), ...original]);
  expect(contentInset('reviewed')).toBe(baseline);
  expect(container.textContent!.split('reviewed').length - 1).toBe(1);
  const labels = transcriptChronology([message('older', day), ...original]).flatMap(value => value.dividerLabel ? [value.dividerLabel] : []);
  for (const label of labels) expect(container.querySelectorAll(`[aria-label="${label}"]`)).toHaveLength(1);
  expect(labels).toHaveLength(day === 8 ? 1 : 2);
  await render(original); expect(contentInset('reviewed')).toBe(baseline);
  const label = transcriptChronology(original)[0]!.dividerLabel!;
  expect(container.querySelectorAll(`[aria-label="${label}"]`)).toHaveLength(1);
});

vi.mock('../questions/QuestionOtherEditor', () => ({ QuestionOtherEditor: () => null }));
