import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ module: {} as Record<string, unknown>, nativeView: vi.fn() }));
vi.mock('expo', () => ({ requireNativeView: mocks.nativeView }));
vi.mock('./VimicateFileLinksModule', () => ({ default: mocks.module }));

beforeEach(() => {
  vi.resetModules();
  for (const key of Object.keys(mocks.module)) delete mocks.module[key];
  mocks.nativeView.mockReset();
});

describe('optional native HTML and file sharing', () => {
  it('never asks an old binary for an unregistered view or share method', async () => {
    const bridge = await import('./VimicateHTMLPreviewView');
    expect(bridge.isVimicateHTMLPreviewAvailable()).toBe(false);
    expect(bridge.isVimicateFileShareAvailable()).toBe(false);
    expect(bridge.maximumVimicateFileShareBytes()).toBe(0);
    expect(mocks.nativeView).not.toHaveBeenCalled();
    await expect(bridge.shareVimicateFile('', 'empty.txt', 'text/plain')).rejects.toThrow('updated native app');
  });
  it('uses the explicitly named HTML view and forwards the exact complete file and anchor', async () => {
    mocks.module.supportsHTMLPreview = true;
    mocks.module.supportsFileSharing = true;
    const share = vi.fn().mockResolvedValue({ status: 'shared' });
    mocks.module.shareFile = share;
    mocks.nativeView.mockReturnValue(() => null);
    const bridge = await import('./VimicateHTMLPreviewView');
    const anchor = { x: 50, y: 80, width: 44, height: 44 };
    expect(bridge.isVimicateHTMLPreviewAvailable()).toBe(true);
    expect(bridge.maximumVimicateFileShareBytes()).toBe(8 * 1024 * 1024);
    expect(mocks.nativeView).toHaveBeenCalledWith('VimicateFileLinks', 'HTMLPreview');
    await expect(bridge.shareVimicateFile('Zg==', 'mock.html', 'text/html', anchor)).resolves.toEqual({ status: 'shared' });
    expect(share).toHaveBeenCalledWith('Zg==', 'mock.html', 'text/html', anchor);
  });
  it('recovers gracefully when native HTML registration is unavailable', async () => {
    mocks.module.supportsHTMLPreview = true;
    mocks.nativeView.mockImplementation(() => { throw new Error('unregistered'); });
    const bridge = await import('./VimicateHTMLPreviewView');
    expect(bridge.isVimicateHTMLPreviewAvailable()).toBe(false);
  });
  it('only enables larger shares when the installed binary declares its independent bound', async () => {
    mocks.module.supportsFileSharing = true; mocks.module.shareFile = vi.fn();
    mocks.module.maximumFileShareBytes = 32 * 1024 * 1024;
    const bridge = await import('./VimicateHTMLPreviewView');
    expect(bridge.maximumVimicateFileShareBytes()).toBe(32 * 1024 * 1024);
    mocks.module.maximumFileShareBytes = Infinity;
    expect(bridge.maximumVimicateFileShareBytes()).toBe(8 * 1024 * 1024);
  });
});
