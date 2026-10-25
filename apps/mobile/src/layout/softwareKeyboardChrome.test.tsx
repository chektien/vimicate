// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const native = vi.hoisted(() => ({
  bottom: 34,
  layout: null as null | ((event: unknown) => void),
  listeners: new Map<string, (event: unknown) => void>(),
  scene: null as null | ((state: string) => void),
}));
vi.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 59, bottom: native.bottom, left: 0, right: 0 }) }));
vi.mock('react-native', async () => {
  const { createElement, forwardRef, useImperativeHandle } = await import('react');
  return {
    Platform: { OS: 'ios' }, StyleSheet: { create: (styles: unknown) => styles },
    View: forwardRef(({ children, style, onLayout }: { children?: React.ReactNode; style?: unknown; onLayout?: (event: unknown) => void }, ref) => {
      if (onLayout) native.layout = onLayout;
      useImperativeHandle(ref, () => ({ measureInWindow: (callback: (...bounds: number[]) => void) => callback(0, 59, 393, 793) }), []);
      const flattened = Object.assign({}, ...(Array.isArray(style) ? style : [style]).filter(Boolean));
      return createElement('div', { 'data-padding-bottom': flattened.paddingBottom ?? 0 }, children);
    }),
    Keyboard: { scheduleLayoutAnimation: vi.fn(), addListener: (name: string, callback: (event: unknown) => void) => {
      native.listeners.set(name, callback); return { remove: () => native.listeners.delete(name) };
    } },
    AppState: { currentState: 'active', addEventListener: (_: string, callback: (state: string) => void) => {
      native.scene = callback; return { remove: () => { native.scene = null; } };
    } },
  };
});
import { SoftwareKeyboardViewport } from './SoftwareKeyboardViewport';
import { BottomSafeAreaChrome } from '../app/BottomSafeAreaChrome';
let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal('React', React); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  native.bottom = 34; native.listeners.clear(); native.layout = null;
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); });
async function mount() {
  await act(async () => root.render(<SoftwareKeyboardViewport><BottomSafeAreaChrome><span id="footer">Status</span></BottomSafeAreaChrome></SoftwareKeyboardViewport>));
  await act(async () => native.layout!({ nativeEvent: { layout: { x: 0, y: 59, width: 393, height: 793 } } }));
}
const footerInset = () => Number(container.querySelector('#footer')!.parentElement!.getAttribute('data-padding-bottom'));
const viewportInset = () => Number(container.firstElementChild!.getAttribute('data-padding-bottom'));
async function show(local = true, screenY = 552, height = 300) {
  await act(async () => native.listeners.get('keyboardWillShow')!({ isEventFromThisApp: local, endCoordinates: { screenY, height } }));
}
it.each([34, 20])('reserves keyboard overlap once, and restores the %ipt home inset after dismissal', async (inset) => {
  native.bottom = inset; await mount();
  expect(footerInset()).toBe(inset);
  await show();
  expect(viewportInset()).toBe(300);
  expect(footerInset()).toBe(0);
  await act(async () => native.listeners.get('keyboardWillHide')!({}));
  expect(viewportInset()).toBe(0); expect(footerInset()).toBe(inset);
});
it('does not remove home protection for another app’s keyboard or a hardware-only frame', async () => {
  await mount(); await show(false);
  expect(viewportInset()).toBe(0); expect(footerInset()).toBe(34);
  await show(true, 852, 0);
  expect(viewportInset()).toBe(0); expect(footerInset()).toBe(34);
});
it('restores home protection when keyboard authority is retired with the scene', async () => {
  await mount(); await show();
  expect(footerInset()).toBe(0);
  await act(async () => native.scene!('background'));
  expect(viewportInset()).toBe(0); expect(footerInset()).toBe(34);
});
it('restores the retained local keyboard on foreground without another show event or rotation', async () => {
  await mount(); await show();
  await act(async () => native.scene!('inactive'));
  await act(async () => native.scene!('background'));
  expect(viewportInset()).toBe(0);
  await act(async () => native.scene!('active'));
  expect(viewportInset()).toBe(300); expect(footerInset()).toBe(0);
});
it('accepts a local restoration event before the scene becomes active', async () => {
  await mount();
  await act(async () => native.scene!('background'));
  await show(true, 532, 320);
  expect(viewportInset()).toBe(0);
  await act(async () => native.scene!('active'));
  expect(viewportInset()).toBe(320); expect(footerInset()).toBe(0);
});
it('does not resurrect a dismissed keyboard or another app’s keyboard on foreground', async () => {
  await mount(); await show();
  await act(async () => native.scene!('background'));
  await act(async () => native.listeners.get('keyboardWillHide')!({}));
  await act(async () => native.scene!('active'));
  expect(viewportInset()).toBe(0); expect(footerInset()).toBe(34);
  await show(); await act(async () => native.scene!('background'));
  await show(false);
  await act(async () => native.scene!('active'));
  expect(viewportInset()).toBe(0); expect(footerInset()).toBe(34);
});
it('tracks the final local frame while inactive and removes its listeners on teardown', async () => {
  await mount(); await show();
  await act(async () => native.scene!('inactive'));
  await act(async () => native.listeners.get('keyboardWillChangeFrame')?.({ isEventFromThisApp: true, endCoordinates: { screenY: 502, height: 350 } }));
  await act(async () => native.scene!('active'));
  expect(viewportInset()).toBe(350);
  await act(async () => root.unmount());
  expect(native.listeners.size).toBe(0); expect(native.scene).toBeNull();
});
