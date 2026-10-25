// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { VimicateFilePreviewViewProps } from '../../modules/vimicate-file-links';
const probe = vi.hoisted(() => ({ props: null as VimicateFilePreviewViewProps | null, available: true }));
vi.mock('react-native', async () => {
  const { createElement } = await import('react');
  const Host = ({ children, accessibilityLabel, onPress }: { children?: React.ReactNode; accessibilityLabel?: string; onPress?: () => void }) => createElement('div', { 'aria-label': accessibilityLabel, onClick: onPress }, children);
  return { View: Host, Text: Host, Pressable: Host, StyleSheet: { create: (value: unknown) => value } };
});
vi.mock('../../modules/vimicate-file-links', () => ({ get VimicateFilePreviewView() { return probe.available ? (props: VimicateFilePreviewViewProps) => { probe.props = props; return <div data-native-preview />; } : null; } }));
import { ProjectDocumentPreview } from './ProjectDocumentPreview';
const content = { projectId: 'artifacts', path: 'demo/grades.xlsx', kind: 'document' as const, mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', dataBase64: 'ZGVtbw==', size: 4, mtimeMs: 1 };
let root: Root; let node: HTMLDivElement;
beforeEach(() => { vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); probe.available = true; probe.props = null; node = document.createElement('div'); document.body.append(node); root = createRoot(node); });
afterEach(async () => { await act(async () => root.unmount()); node.remove(); vi.unstubAllGlobals(); });
const render = () => act(async () => root.render(<ProjectDocumentPreview content={content} onFocus={() => undefined} />));
it('passes only the selected bytes and basename to the inline viewer, then settles ready', async () => {
  await render();
  expect(probe.props).toMatchObject({ filename: 'grades.xlsx', dataBase64: 'ZGVtbw==', mimeType: content.mimeType });
  expect(node.textContent).toContain('Preparing');
  act(() => probe.props!.onPreviewStatus!({ nativeEvent: { status: 'ready' } }));
  expect(node.textContent).not.toContain('Preparing');
  expect(node.querySelector('[data-native-preview]')).not.toBeNull();
});
it('explains an unsupported system preview without replacing the selected document', async () => {
  await render();
  act(() => probe.props!.onPreviewStatus!({ nativeEvent: { status: 'unsupported' } }));
  expect(node.textContent).toContain('Preview not supported');
  expect(node.textContent).toContain('file is selected in its folder');
  expect(node.querySelector('[data-native-preview]')).toBeNull();
});
it('retries expired previews and ignores late events from the retired native view', async () => {
  await render(); const retired = probe.props!.onPreviewStatus!;
  act(() => retired({ nativeEvent: { status: 'error', message: 'Preview expired.' } }));
  expect(node.textContent).toContain('Preview expired.');
  act(() => (node.querySelector('[aria-label="Retry document preview"]') as HTMLElement).click());
  expect(node.textContent).toContain('Preparing');
  act(() => retired({ nativeEvent: { status: 'unsupported' } }));
  expect(node.querySelector('[data-native-preview]')).not.toBeNull();
  act(() => probe.props!.onPreviewStatus!({ nativeEvent: { status: 'ready' } }));
  expect(node.textContent).not.toContain('Preparing');
});
it('degrades safely on an old native binary', async () => {
  probe.available = false; await render();
  expect(node.textContent).toContain('Install the latest TestFlight build');
  expect(node.querySelector('[data-native-preview]')).toBeNull();
});
