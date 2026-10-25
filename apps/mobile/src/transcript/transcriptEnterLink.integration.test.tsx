// @vitest-environment jsdom
import React, { act, Suspense, startTransition } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { WorkspaceMessage } from '../workspace/workspaceTypes';

vi.mock('react-native', async () => {
  const { createElement } = await import('react');
  const Host = ({ children }: { children?: React.ReactNode }) => createElement('div', null, children);
  return { View: Host, Text: Host, Pressable: Host, StyleSheet: { create: (value: unknown) => value, hairlineWidth: 1 } };
});
vi.mock('@shopify/flash-list', async () => {
  const { forwardRef } = await import('react');
  return { FlashList: forwardRef(() => null) };
});
vi.mock('./useTranscriptViewport', () => {
  const noop = () => undefined;
  return { useTranscriptViewport: () => ({
    list: { current: null }, reveal: noop, revealAfterRevision: noop, viewPositionForRow: noop,
    holdReviewAnchor: noop, captureReviewAnchor: noop, captureOlderHistoryAnchor: noop,
    retireUnchangedOlderHistoryAnchor: noop, onOlderHistoryLayoutCommit: noop,
  }) };
});
vi.mock('./TranscriptSourceRow', () => ({ TranscriptSourceRow: () => null }));
vi.mock('../../modules/vimicate-diagnostics', () => ({ recordViewportDiagnostic: () => undefined }));
import { TranscriptPane, type TranscriptPaneHandle } from './TranscriptPane';
import { createTranscriptBuffer, createTranscriptVimState } from './transcriptVim';

const noop = () => undefined;
const handle = React.createRef<TranscriptPaneHandle>();
const answer = (text: string): WorkspaceMessage => ({ id: 'answer', role: 'assistant', text });
let root: ReturnType<typeof createRoot>;
let pending: Promise<never>;
function Scene({ message, suspend = false }: { message: WorkspaceMessage; suspend?: boolean }) {
  const buffer = createTranscriptBuffer([message]);
  return <Suspense fallback={null}><TranscriptPane ref={handle} datasetKey="test" messages={[message]} buffer={buffer}
    navigation={createTranscriptVimState(buffer)} focused fontScale={1} onFocus={noop} onSelect={noop}
    onNavigationProjection={noop} onViewportReview={noop} onApprovalDecision={noop} onRecoverMessage={noop}
    onOpenMedia={noop} canLoadOlder={false} loadingOlder={false} onLoadOlder={noop} onRetryHistory={noop} />
    <PendingSibling suspend={suspend} /></Suspense>;
}
function PendingSibling({ suspend }: { suspend: boolean }) { if (suspend) throw pending; return null; }
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); vi.stubGlobal('React', React);
  pending = new Promise<never>(() => {});
  root = createRoot(document.createElement('div'));
});
afterEach(async () => { await act(async () => root.unmount()); vi.unstubAllGlobals(); });

it('routes the visible cursor through the committed transcript pane snapshot', async () => {
  const first = answer('- [Teaching Philosophy](notes/teaching.md)\n- [Research Strategy](notes/research.md)');
  await act(async () => root.render(<Scene message={first} />));
  expect(handle.current?.linkAtSourceCursor(0, 0)).toEqual({ kind: 'local-file', path: 'notes/teaching.md' });
  expect(handle.current?.renderedLineAtSourceRow(0)?.source).toBe(first.text.split('\n')[0]);
  expect(handle.current?.linkAtSourceCursor(1, 2)).toEqual({ kind: 'local-file', path: 'notes/research.md' });

  const next = answer('- [Changed](notes/changed.md)');
  await act(async () => startTransition(() => root.render(<Scene message={next} suspend />)));
  expect(handle.current?.linkAtSourceCursor(0, 0)).toEqual({ kind: 'local-file', path: 'notes/teaching.md' });
  expect(handle.current?.renderedLineAtSourceRow(0)?.source).toBe(first.text.split('\n')[0]);
  await act(async () => root.render(<Scene message={next} />));
  expect(handle.current?.linkAtSourceCursor(0, 0)).toEqual({ kind: 'local-file', path: 'notes/changed.md' });
  expect(handle.current?.linkAtSourceCursor(1, 0)).toBeNull();
  expect(handle.current?.renderedLineAtSourceRow(0)?.source).toBe(next.text);
  expect(handle.current?.renderedLineAtSourceRow(1)).toBeUndefined();
});
