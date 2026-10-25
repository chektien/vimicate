// @vitest-environment jsdom
import React, { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { toByteArray } from 'base64-js';
import type { ProjectFileContent } from '../gateway/projectFiles';
import type { VimicateFilePreviewViewProps } from '../../modules/vimicate-file-links';
const probe = vi.hoisted(() => ({ share: vi.fn(), available: true, native: true, props: null as VimicateFilePreviewViewProps | null, mounts: 0 }));
vi.mock('react-native', async () => {
  const { createElement, forwardRef, useImperativeHandle } = await import('react');
  const Host = forwardRef(({ children, accessibilityLabel, accessibilityState, onPress, onTouchStart, disabled, style }: {
    children?: ReactNode; accessibilityLabel?: string; accessibilityState?: { selected?: boolean }; onPress?: () => void; onTouchStart?: () => void; disabled?: boolean; style?: unknown;
  }, ref) => {
    useImperativeHandle(ref, () => ({ measureInWindow: (callback: (...args: number[]) => void) => callback(260, 320, 44, 44) }));
    const styles = [style].flat().filter(value => value && typeof value === 'object') as Array<{ display?: string; opacity?: number }>;
    return createElement('div', { 'aria-label': accessibilityLabel, 'aria-selected': accessibilityState?.selected,
      style: { display: styles.find(value => value.display === 'none')?.display, opacity: styles.find(value => value.opacity === 0)?.opacity }, onClick: disabled ? undefined : onPress, onTouchStart }, children);
  });
  return { View: Host, Text: Host, Pressable: Host, StyleSheet: { create: (styles: unknown) => styles } };
});
vi.mock('expo-symbols', () => ({ SymbolView: ({ name }: { name: string }) => <span data-symbol={name} /> }));
vi.mock('../../modules/vimicate-file-links', () => {
  function Native(props: VimicateFilePreviewViewProps) { probe.props = props; React.useEffect(() => { probe.mounts += 1; }, []); return <div data-webview />; }
  return { isVimicateFileShareAvailable: () => probe.available, shareVimicateFile: probe.share, get VimicateHTMLPreviewView() { return probe.native ? Native : null; } };
});
import { ProjectFileContents } from './ProjectFileContents';
import { projectFileTransfer } from './projectFileTransfer';
const html: ProjectFileContent = { projectId: 'synthetic', path: 'folder/preview.html', kind: 'text', mimeType: 'text/html', size: 0, mtimeMs: 1,
  text: '<!doctype html><button onclick="this.textContent=42">Run</button>\n' + '😀漢字\r\n'.repeat(12_000) };
let root: Root; let node: HTMLDivElement;
beforeEach(() => { vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); probe.share.mockReset().mockResolvedValue({ status: 'shared' }); probe.available = true; probe.native = true; probe.mounts = 0; probe.props = null;
  node = document.createElement('div'); document.body.append(node); root = createRoot(node); });
afterEach(async () => { await act(async () => root.unmount()); node.remove(); vi.unstubAllGlobals(); });
async function render(content = html, checking = false) { await act(async () => root.render(<ProjectFileContents key={content.path} content={content} checking={checking} fontScale={1} onFocus={() => undefined}><span data-source>source rows</span></ProjectFileContents>)); }
async function click(label: string) { await act(async () => node.querySelector<HTMLElement>(`[aria-label="${label}"]`)!.click()); }

it('renders complete HTML by default and preserves the native document while toggling source', async () => {
  await render();
  expect(new TextDecoder().decode(toByteArray(probe.props!.dataBase64))).toBe(html.kind === 'text' && html.text);
  expect(node.querySelector('[data-source]')?.parentElement?.style.opacity).toBe('0');
  expect(node.querySelector('[aria-label="Show HTML preview"]')?.getAttribute('aria-selected')).toBe('true');
  await click('Show HTML source');
  expect(node.querySelector('[data-source]')?.parentElement?.style.opacity).not.toBe('0');
  await click('Show HTML preview');
  expect(probe.mounts).toBe(1);
});

it('shares the full original Unicode file with its basename and iPad popover anchor, not source-row excerpts', async () => {
  await render(); await click('Share preview.html');
  const [bytes, filename, mime, anchor] = probe.share.mock.calls[0]!;
  expect(new TextDecoder().decode(toByteArray(bytes))).toBe(html.kind === 'text' && html.text);
  expect([filename, mime, anchor]).toEqual(['preview.html', 'text/html', { x: 260, y: 320, width: 44, height: 44 }]);
  expect(node.querySelector('[data-symbol="square.and.arrow.up"]')).not.toBeNull();
});

it('does not share retained content during revalidation and coalesces double taps', async () => {
  await render(html, true); await click('Share preview.html'); expect(probe.share).not.toHaveBeenCalled();
  let finish!: (value: { status: string }) => void; probe.share.mockReturnValue(new Promise(resolve => { finish = resolve; }));
  await render(); await click('Share preview.html'); await click('Share preview.html'); expect(probe.share).toHaveBeenCalledTimes(1);
  await act(async () => finish({ status: 'cancelled' })); await click('Share preview.html'); expect(probe.share).toHaveBeenCalledTimes(2);
});

it('keeps source usable on old binaries and explains unavailable file sharing', async () => {
  probe.available = false; probe.native = false; await render();
  expect(node.textContent).toContain('Install the next TestFlight build');
  await click('Show HTML source'); await click('Share preview.html'); expect(probe.share).not.toHaveBeenCalled();
  expect(node.textContent).toContain('to share files');
});

it('shows blocked-link notices without replacing the document, and offers recovery after rendering fails', async () => {
  await render();
  act(() => probe.props!.onPreviewStatus!({ nativeEvent: { status: 'ready', message: 'External link unavailable' } }));
  expect(node.textContent).toContain('External link unavailable'); expect(node.querySelector('[data-webview]')).not.toBeNull();
  act(() => probe.props!.onPreviewStatus!({ nativeEvent: { status: 'error', message: 'Rendering failed' } }));
  expect(node.querySelector('[data-webview]')).toBeNull();
  await click('Retry HTML preview'); expect(probe.mounts).toBe(2);
});

it.each(['image', 'document'] as const)('shares %s bytes unchanged without presenting HTML mode controls', async kind => {
  const file: ProjectFileContent = { projectId: 'synthetic', path: 'notes/report.dat', kind, mimeType: 'application/octet-stream', size: 4, mtimeMs: 1, dataBase64: 'AP8BAg==' };
  await render(file); await click('Share report.dat');
  expect(probe.share).toHaveBeenCalledWith('AP8BAg==', 'report.dat', 'application/octet-stream', expect.any(Object));
  expect(node.querySelector('[aria-label="HTML display mode"]')).toBeNull();
});

it('preserves empty files and reports share errors with a retryable control', async () => {
  const file: ProjectFileContent = { ...html, kind: 'text', text: '', size: 0 };
  expect(projectFileTransfer(file).dataBase64).toBe('');
  probe.share.mockRejectedValueOnce(new Error('native failure')); await render(file); await click('Share preview.html');
  expect(node.textContent).toContain('This file could not be shared');
  await click('Share preview.html'); expect(probe.share).toHaveBeenCalledTimes(2);
});

it('focuses source contents on touch without waiting for a row press or taking its gesture', async () => {
  const focus = vi.fn();
  const content: ProjectFileContent = { ...html, path: 'notes.md', mimeType: 'text/markdown', text: 'A selectable paragraph' };
  await act(async () => root.render(<ProjectFileContents content={content} checking={false} fontScale={1} onFocus={focus}><span data-source>A selectable paragraph</span></ProjectFileContents>));
  const source = node.querySelector('[data-source]')!;
  const touch = new Event('touchstart', { bubbles: true, cancelable: true });
  await act(async () => source.dispatchEvent(touch));
  expect(focus).toHaveBeenCalledTimes(1);
  expect(touch.defaultPrevented).toBe(false);
  await act(async () => source.parentElement!.dispatchEvent(new Event('touchstart', { bubbles: true })));
  expect(focus).toHaveBeenCalledTimes(2);
});
