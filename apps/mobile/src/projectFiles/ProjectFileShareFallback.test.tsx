// @vitest-environment jsdom
import React, { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { ProjectFileEntry } from '../gateway/projectFiles';
import type { ProjectFileShareReader, ProjectFileShareTransfer } from '../gateway/projectFileSharing';

const probe = vi.hoisted(() => ({ share: vi.fn(), maximum: 32 * 1024 * 1024, state: 'active', listener: null as ((state: string) => void) | null }));
vi.mock('react-native', async () => {
  const { createElement, forwardRef, useImperativeHandle } = await import('react');
  const Host = forwardRef(({ children, accessibilityLabel, onPress, disabled }: {
    children?: ReactNode; accessibilityLabel?: string; onPress?: () => void; disabled?: boolean;
  }, ref) => {
    useImperativeHandle(ref, () => ({ measureInWindow: (done: (...args: number[]) => void) => done(12, 34, 90, 44) }));
    return createElement('div', { 'aria-label': accessibilityLabel, onClick: disabled ? undefined : onPress }, children);
  });
  return { View: Host, Text: Host, Pressable: Host, StyleSheet: { create: (styles: unknown) => styles },
    AppState: { get currentState() { return probe.state; }, addEventListener: (_: string, listener: (state: string) => void) => {
      probe.listener = listener; return { remove: () => { probe.listener = null; } };
    } } };
});
vi.mock('../../modules/vimicate-file-links', () => ({ maximumVimicateFileShareBytes: () => probe.maximum, shareVimicateFile: probe.share }));
import { ProjectFileShareFallback } from './ProjectFileShareFallback';

const entry: ProjectFileEntry = { name: 'original.pdf', path: 'folder/original.pdf', kind: 'document',
  mimeType: 'application/pdf', size: 8 * 1024 * 1024 + 17, mtimeMs: 8 };
const file = { filename: entry.name, mimeType: 'application/pdf', dataBase64: 'AP8BAg==' };
let root: Root; let node: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); probe.maximum = 32 * 1024 * 1024; probe.state = 'active';
  probe.share.mockReset().mockResolvedValue({ status: 'shared' });
  node = document.createElement('div'); document.body.append(node); root = createRoot(node);
});
afterEach(async () => { await act(async () => root.unmount()); node.remove(); vi.useRealTimers(); vi.unstubAllGlobals(); });
async function render(readFileForSharing?: ProjectFileShareReader, selected = entry) {
  await act(async () => root.render(<ProjectFileShareFallback entry={selected} projectId="synthetic" readFileForSharing={readFileForSharing}
    message="Document exceeds preview limit." fontScale={1} onFocus={() => undefined} />));
}
async function click(label = `Share original ${entry.name}`) { await act(async () => node.querySelector<HTMLElement>(`[aria-label="${label}"]`)!.click()); }
function pendingRead() {
  let finish!: (file: ProjectFileShareTransfer) => void;
  const read = vi.fn<ProjectFileShareReader>(() => new Promise(resolve => { finish = resolve; }));
  return { read, finish: () => finish(file) };
}

it('keeps Share / Open in available after preview failure and only fetches on explicit tap', async () => {
  const read = vi.fn<ProjectFileShareReader>().mockResolvedValue(file);
  await render(read); expect(node.textContent).toContain('Document exceeds preview limit.');
  expect(node.textContent).toContain('Share / Open in…'); expect(read).not.toHaveBeenCalled();
  await click();
  expect(read).toHaveBeenCalledWith({ projectId: 'synthetic', path: entry.path, size: entry.size, mtimeMs: entry.mtimeMs, signal: expect.any(AbortSignal) });
  expect(probe.share).toHaveBeenCalledWith(file.dataBase64, file.filename, file.mimeType, { x: 12, y: 34, width: 90, height: 44 });
});
it('suppresses duplicate taps during transfer and while the native chooser is open', async () => {
  const p = pendingRead(); let dismiss!: (value: unknown) => void;
  probe.share.mockReturnValue(new Promise(resolve => { dismiss = resolve; }));
  await render(p.read); await click(); await click(); expect(p.read).toHaveBeenCalledTimes(1);
  await act(async () => p.finish()); await click(); expect(p.read).toHaveBeenCalledTimes(1);
  await act(async () => dismiss({ status: 'cancelled' })); await click(); expect(p.read).toHaveBeenCalledTimes(2);
});
it.each(['cancel', 'selection', 'background', 'unmount'])('does not present stale completed transfers after %s', async reason => {
  const p = pendingRead(); await render(p.read); await click();
  const signal = p.read.mock.calls[0]![0].signal!;
  if (reason === 'cancel') await click('Cancel file download');
  if (reason === 'selection') await render(p.read, { ...entry, path: 'new.pdf', name: 'new.pdf' });
  if (reason === 'background') act(() => { probe.state = 'background'; probe.listener?.('background'); });
  if (reason === 'unmount') await act(async () => root.render(null));
  expect(signal.aborted).toBe(true);
  await act(async () => p.finish()); expect(probe.share).not.toHaveBeenCalled();
});
it('fails before downloading on old binaries, missing Gateway support and oversize originals', async () => {
  const read = vi.fn<ProjectFileShareReader>();
  probe.maximum = 8 * 1024 * 1024; await render(read); await click();
  expect(node.textContent).toContain('next TestFlight build'); expect(read).not.toHaveBeenCalled();
  probe.maximum = 32 * 1024 * 1024; await render(); await click();
  expect(node.textContent).toContain('Gateway does not support');
  await render(read, { ...entry, size: 32 * 1024 * 1024 + 1 }); await click();
  expect(node.textContent).toContain('limited to 32 MiB'); expect(read).not.toHaveBeenCalled();
});
it('reports transfer and presentation failures without preventing a deliberate retry', async () => {
  const read = vi.fn<ProjectFileShareReader>().mockRejectedValueOnce(new Error('host unavailable')).mockResolvedValue(file);
  await render(read); await click(); expect(node.textContent).toContain('The original file could not be downloaded. Try again.');
  probe.share.mockRejectedValueOnce(new Error('cannot present')); await click();
  expect(node.textContent).toContain('The file downloaded, but the share sheet could not open. Try again.');
  await click(); expect(probe.share).toHaveBeenCalledTimes(2);
});
it('bounds a stalled transfer and reports a retryable timeout without opening a chooser', async () => {
  vi.useFakeTimers();
  const read = vi.fn<ProjectFileShareReader>(({ signal }) => new Promise((_resolve, reject) => {
    signal!.addEventListener('abort', () => reject(signal!.reason), { once: true });
  }));
  await render(read); await click();
  await act(async () => { await vi.advanceTimersByTimeAsync(5 * 60 * 1000); });
  expect(read.mock.calls[0]![0].signal!.aborted).toBe(true);
  expect(node.textContent).toContain('File transfer timed out. Try again.');
  expect(probe.share).not.toHaveBeenCalled();
});

it.each([
  ['health timed out', 'The Gateway connection timed out. Wait for it to reconnect, then try sharing again.'],
  ['Gateway is not connected', 'The Gateway is disconnected. Wait for it to reconnect, then try sharing again.'],
  ['vimicate.files.exportChunk timed out', 'The file download timed out. Try sharing again.'],
  ['unknown method: vimicate.files.exportChunk', 'This Gateway needs an update to support original-file sharing.'],
  ['vimicate project files: file changed before sharing', 'The file changed. Refresh the folder, then share it again.'],
  ['Invalid original file transfer response.', 'The file transfer could not be verified. Nothing was shared. Try again.'],
])('reports actionable share failure for %s without opening a native chooser', async (reason, expected) => {
  const read = vi.fn<ProjectFileShareReader>().mockRejectedValueOnce(new Error(reason)).mockResolvedValue(file);
  await render(read); await click();
  expect(node.textContent).toContain(expected); expect(probe.share).not.toHaveBeenCalled();
  await click(); expect(probe.share).toHaveBeenCalledTimes(1);
});
it('does not expose unknown host diagnostics or blame connection for native presentation failure', async () => {
  const reason = 'private path /private/report.docx token=synthetic';
  const read = vi.fn<ProjectFileShareReader>().mockRejectedValueOnce(new Error(reason)).mockResolvedValue(file);
  await render(read); await click(); expect(node.textContent).not.toContain(reason);
  expect(node.textContent).toContain('The original file could not be downloaded. Try again.');
  probe.share.mockRejectedValueOnce(new Error('health timed out')); await click();
  expect(node.textContent).toContain('The file downloaded, but the share sheet could not open. Try again.');
});
