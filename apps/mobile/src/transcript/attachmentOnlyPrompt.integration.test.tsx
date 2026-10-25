// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import type { WorkspaceMessage } from '../workspace/workspaceTypes';
vi.mock('react-native', async () => {
  const { createElement } = await import('react');
  const Host = ({ children, accessibilityLabel, onPress }: { children?: React.ReactNode; accessibilityLabel?: string; onPress?: () => void }) =>
    createElement('div', { 'aria-label': accessibilityLabel, onClick: onPress }, children);
  return { View: Host, Text: Host, Pressable: Host, StyleSheet: { create: (value: unknown) => value, hairlineWidth: 1 } };
});
vi.mock('./GatewayImage', () => ({ GatewayImage: () => <span>thumbnail</span> }));
vi.mock('./TranscriptMarkdownLine', () => ({ TranscriptMarkdownLine: ({ line }: { line: { source: string } }) => <span>{line.source}</span> }));
import { TranscriptSourceRow } from './TranscriptSourceRow';
import { buildVisibleTranscriptRenderRows } from './transcriptVisibleRows';
import { createTranscriptBuffer, createTranscriptVimState } from './transcriptVim';

it('labels the empty prompt accessibly while retaining its source, thumbnail and preview action', async () => {
  vi.stubGlobal('React', React); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const container = document.createElement('div'); const root = createRoot(container);
  const original: WorkspaceMessage = { id: 'prompt', role: 'user', text: '', attachments: [{ id: 'image', filename: 'screenshot.png', mimeType: 'image/png', uri: 'https://example.test/image.png' }] };
  const snapshot = JSON.stringify(original); const open = vi.fn(); const noop = () => {};
  try {
    for (const message of [original, { ...original, text: 'Look at this' }]) {
      const rows = buildVisibleTranscriptRenderRows([message], new Set());
      expect(rows).toHaveLength(1); expect(rows[0]!.compiled.source).toBe(message.text);
      const buffer = createTranscriptBuffer([message]);
      await act(async () => root.render(<TranscriptSourceRow row={rows[0]!} navigation={createTranscriptVimState(buffer)}
        focused fontScale={1} gutterWidth={32} sourceNavigationIndex={0} cursorNavigationIndex={0}
        onPress={noop} onToggleFold={noop} onApprovalDecision={noop} onOpenMedia={open} onRecoverMessage={noop} />));
      expect(container.textContent).toContain(message.text || 'Image attached');
      expect(container.querySelector('[aria-label^="user, line"]')!.getAttribute('aria-label')).toContain(message.text || 'Image attached');
      if (message.text) expect(container.textContent).not.toContain('Image attached');
      expect(container.textContent).toContain('thumbnail');
      await act(async () => (container.querySelector('[aria-label="Open screenshot.png"]') as HTMLElement).click());
    }
    expect(open.mock.calls).toEqual([['image'], ['image']]);
    expect(JSON.stringify(original)).toBe(snapshot);
  } finally { await act(async () => root.unmount()); vi.unstubAllGlobals(); }
});

vi.mock('../questions/QuestionOtherEditor', () => ({ QuestionOtherEditor: () => null }));
