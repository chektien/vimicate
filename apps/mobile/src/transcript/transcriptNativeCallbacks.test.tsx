// @vitest-environment jsdom
import React, { act, startTransition, Suspense, useLayoutEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useTranscriptNativeCallbacks } from './useTranscriptNativeCallbacks';

type Callbacks = ReturnType<typeof useTranscriptNativeCallbacks>;
const keys: Array<keyof Callbacks> = ['onScroll', 'onScrollBeginDrag', 'onScrollEndDrag',
  'onMomentumScrollBegin', 'onMomentumScrollEnd', 'onContentSizeChange', 'onLayout', 'onViewableItemsChanged'];
const handlers = () => Object.fromEntries(keys.map(key => [key, vi.fn()])) as unknown as Callbacks;
let root: Root;
let bound: Callbacks;
function Child({ callbacks }: { callbacks: Callbacks }) {
  useLayoutEffect(() => callbacks.onContentSizeChange(400, 2_000), [callbacks]);
  return null;
}
function Probe({ sessionKey, callbacks, child = false }: { sessionKey: string; callbacks: Callbacks; child?: boolean }) {
  bound = useTranscriptNativeCallbacks(sessionKey, callbacks);
  return child ? <Child callbacks={bound} /> : null;
}
const render = (key: string, callbacks: Callbacks, child = false) => act(async () => {
  root.render(<Probe sessionKey={key} callbacks={callbacks} child={child} />);
});
function emitAll(callbacks: Callbacks) {
  callbacks.onScroll({} as never); callbacks.onScrollBeginDrag(); callbacks.onScrollEndDrag({} as never);
  callbacks.onMomentumScrollBegin(); callbacks.onMomentumScrollEnd();
  callbacks.onContentSizeChange(400, 2_000); callbacks.onLayout({} as never);
  callbacks.onViewableItemsChanged({ viewableItems: [], changed: [] });
}
beforeEach(() => { vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); vi.stubGlobal('React', React); root = createRoot(document.createElement('div')); });
afterEach(async () => { await act(async () => root.unmount()); vi.unstubAllGlobals(); });

describe('native transcript callback mount authority', () => {
  it('keeps bindings stable within a dataset while dispatching the latest handlers', async () => {
    const first = handlers(); await render('a', first); const original = bound;
    const latest = handlers(); await render('a', latest);
    expect(bound).toBe(original);
    emitAll(original);
    for (const key of keys) { expect(first[key]).not.toHaveBeenCalled(); expect(latest[key]).toHaveBeenCalledOnce(); }
  });

  it('keeps native events on committed handlers while a newer render is suspended', async () => {
    const pending = new Promise<never>(() => {});
    function Pause({ suspend }: { suspend: boolean }) { if (suspend) throw pending; return null; }
    const first = handlers(); const next = handlers();
    const scene = (callbacks: Callbacks, suspend: boolean) => <Suspense fallback={null}>
      <Probe sessionKey="a" callbacks={callbacks} /><Pause suspend={suspend} /></Suspense>;
    await act(async () => root.render(scene(first, false))); const visible = bound;
    await act(async () => startTransition(() => root.render(scene(next, true))));
    emitAll(visible);
    for (const key of keys) { expect(first[key]).toHaveBeenCalledOnce(); expect(next[key]).not.toHaveBeenCalled(); }
  });

  it('retires all native callback kinds, including when an identical route returns', async () => {
    const current = handlers(); await render('a', current); const retired = bound;
    await render('b', current); const retiredB = bound;
    await render('a', current);
    expect(bound).not.toBe(retired);
    emitAll(retired); emitAll(retiredB);
    for (const key of keys) expect(current[key]).not.toHaveBeenCalled();
    emitAll(bound);
    for (const key of keys) expect(current[key]).toHaveBeenCalledOnce();
  });

  it('rejects every late native event after unmount', async () => {
    const current = handlers(); await render('a', current); const retired = bound;
    await act(async () => root.unmount()); emitAll(retired);
    for (const key of keys) expect(current[key]).not.toHaveBeenCalled();
  });

  it('admits child layout publication before the parent layout effect, on mount and replacement', async () => {
    const current = handlers(); const next = handlers();
    await render('a', current, true); await render('b', next, true);
    expect(current.onContentSizeChange).toHaveBeenCalledExactlyOnceWith(400, 2_000);
    expect(next.onContentSizeChange).toHaveBeenCalledExactlyOnceWith(400, 2_000);
  });

  it('remains usable after StrictMode effect replay without an extra subscription or timer', async () => {
    const current = handlers();
    await act(async () => root.render(<React.StrictMode><Probe sessionKey="a" callbacks={current} /></React.StrictMode>));
    emitAll(bound);
    for (const key of keys) expect(current[key]).toHaveBeenCalledOnce();
  });
});
