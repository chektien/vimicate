// @vitest-environment jsdom
import { act, createElement, forwardRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ prepare: vi.fn(), share: vi.fn(), available: vi.fn(), phase: 'loading', measure: true, state: null as null | ((state: string) => void) }));
vi.mock('react-native', () => ({
  AppState: { addEventListener: (_name: string, callback: (state: string) => void) => { mocks.state = callback; return { remove: () => { mocks.state = null; } }; } },
  Pressable: forwardRef(function Button(props: { onPress: () => void; disabled: boolean }, ref) {
    if (typeof ref === 'object' && ref) ref.current = { measureInWindow: (callback: (...values: number[]) => void) => { if (mocks.measure) callback(10, 20, 44, 44); } };
    return createElement('button', { onClick: props.onPress, disabled: props.disabled }, 'Share image');
  }), View: 'div', Text: (props: { children: string }) => createElement('p', {}, props.children), StyleSheet: { create: (value: unknown) => value },
}));
vi.mock('expo-file-system', () => ({ File: class {}, FileMode: { ReadOnly: 'r' } }));
vi.mock('expo-symbols', () => ({ SymbolView: () => null }));
vi.mock('../../modules/vimicate-file-links', () => ({ isVimicateFileShareAvailable: mocks.available, shareVimicateFile: mocks.share }));
vi.mock('./useGatewayImage', () => ({ useGatewayImage: () => ({ source: { uri: 'data:image/png;base64,AQID' }, phase: mocks.phase }) }));
vi.mock('./transcriptImageShare', () => ({ prepareTranscriptImageShare: mocks.prepare }));
import { TranscriptImageShareButton } from './TranscriptImageShareButton';
const attachment = { id: 'first', filename: 'first.png', mimeType: 'image/png', uri: 'file:///first.png' };
const file = { dataBase64: 'AQID', filename: 'first.png', mimeType: 'image/png' };
let root: Root; let host: HTMLDivElement;
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(yes => { resolve = yes; }); return { promise, resolve }; }
const click = () => act(async () => { host.querySelector('button')!.click(); });
beforeEach(async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); vi.clearAllMocks(); mocks.phase = 'loading'; mocks.measure = true; mocks.available.mockReturnValue(true);
  mocks.prepare.mockResolvedValue(file); mocks.share.mockResolvedValue({ status: 'cancelled' });
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  await act(async () => { root.render(<TranscriptImageShareButton attachment={attachment} top={12} />); });
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });
describe('image share selected-image lifetime', () => {
  it('presents selected bytes with the measured iPad anchor; native cancellation is quiet', async () => {
    await click(); expect(mocks.share).toHaveBeenCalledWith('AQID', 'first.png', 'image/png', { x: 10, y: 20, width: 44, height: 44 });
    expect(host.querySelector('p')).toBeNull(); expect(host.querySelector('button')!.disabled).toBe(false);
  });
  it('does not open a stale sheet after paging or closing unmounts the selected image', async () => {
    const pending = deferred<typeof file>(); mocks.prepare.mockReturnValue(pending.promise); await click();
    const signal = mocks.prepare.mock.calls[0]![2] as AbortSignal;
    await act(async () => root.render(null)); expect(signal.aborted).toBe(true);
    await act(async () => pending.resolve(file)); expect(mocks.share).not.toHaveBeenCalled();
  });
  it('prevents duplicate requests while preparation is pending', async () => {
    const pending = deferred<typeof file>(); mocks.prepare.mockReturnValue(pending.promise); await click(); await click();
    expect(mocks.prepare).toHaveBeenCalledTimes(1); await act(async () => pending.resolve(file));
  });
  it('retires preparation when the app goes inactive', async () => {
    const pending = deferred<typeof file>(); mocks.prepare.mockReturnValue(pending.promise); await click();
    await act(async () => { mocks.state?.('background'); pending.resolve(file); });
    expect(mocks.share).not.toHaveBeenCalled(); expect(host.textContent).toContain('interrupted');
  });
  it('keeps old native binaries and unavailable images out of native sharing', async () => {
    mocks.available.mockReturnValue(false); await click(); expect(host.textContent).toContain('TestFlight');
    expect(mocks.prepare).not.toHaveBeenCalled(); expect(mocks.share).not.toHaveBeenCalled();
  });
  it('retires pending bytes when authority changes under the same image ID and URI', async () => {
    const pending = deferred<typeof file>(); mocks.prepare.mockReturnValue(pending.promise); await click();
    await act(async () => root.render(<TranscriptImageShareButton attachment={{ ...attachment, artifactSessionKey: 'new-session' }} top={12} />));
    await act(async () => pending.resolve(file)); expect(mocks.share).not.toHaveBeenCalled();
    expect(host.querySelector('button')!.disabled).toBe(false);
  });
  it('recovers if native measurement never calls back', async () => {
    vi.useFakeTimers(); mocks.measure = false;
    try { await click(); await act(async () => { vi.advanceTimersByTime(30_000); });
      expect(host.querySelector('button')!.disabled).toBe(false); expect(mocks.share).not.toHaveBeenCalled();
      expect(host.textContent).toContain('interrupted');
    } finally { vi.useRealTimers(); }
  });
  it('shows preparation errors without a success claim', async () => {
    mocks.prepare.mockRejectedValue(new Error('Image unavailable')); await click();
    expect(host.textContent).toContain('Image unavailable'); expect(mocks.share).not.toHaveBeenCalled();
  });
});
