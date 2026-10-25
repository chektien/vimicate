// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import type { PromptDropEvent } from '../../modules/vimicate-editor/src/VimicateEditor.types';
const bridge = vi.hoisted(() => ({ supported: true, props: {} as { sessionKey: string; enabled: boolean; onDrop?: (event: { nativeEvent: PromptDropEvent }) => void }, requireView: vi.fn() }));
vi.mock('../../modules/vimicate-editor/src/VimicateEditorModule', () => ({ default: { get supportsPromptDrop() { return bridge.supported; } } }));
vi.mock('expo', () => ({ requireNativeView: (...args: string[]) => {
  bridge.requireView(...args);
  return (props: typeof bridge.props & { children: React.ReactNode }) => { bridge.props = props; return <section>{props.children}</section>; };
} }));
vi.mock('react-native', () => ({ View: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));
let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
beforeEach(() => { vi.resetModules(); bridge.requireView.mockClear(); vi.stubGlobal('React', React); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); container = document.createElement('div'); root = createRoot(container); });
afterEach(async () => { await act(async () => root.unmount()); vi.unstubAllGlobals(); });

it('retains prompt children on old binaries without requesting an unavailable native view', async () => {
  bridge.supported = false;
  const { PromptDropSurface } = await import('../../modules/vimicate-editor/src/PromptDropSurface');
  await act(async () => root.render(<PromptDropSurface sessionKey="a" enabled><textarea defaultValue="draft kept" /><button>Attach files</button></PromptDropSurface>));
  expect(bridge.requireView).not.toHaveBeenCalled();
  expect(container.querySelector('textarea')!.value).toBe('draft kept');
  expect(container.textContent).toContain('Attach files');
});

it('forwards the captured native destination unchanged, even after rendering another thread', async () => {
  bridge.supported = true;
  const { PromptDropSurface } = await import('../../modules/vimicate-editor/src/PromptDropSurface');
  const onDrop = vi.fn();
  await act(async () => root.render(<PromptDropSurface sessionKey="b" enabled={false} onDrop={onDrop}><span>prompt</span></PromptDropSurface>));
  expect(bridge.requireView).toHaveBeenCalledWith('VimicateEditor', 'PromptDrop');
  expect(bridge.props).toMatchObject({ sessionKey: 'b', enabled: false });
  bridge.props.onDrop?.({ nativeEvent: { id: 'one', sessionKey: 'a' } });
  expect(onDrop).toHaveBeenCalledWith({ id: 'one', sessionKey: 'a' });
});
