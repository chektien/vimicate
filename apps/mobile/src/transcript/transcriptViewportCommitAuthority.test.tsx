// @vitest-environment jsdom
import React, { act, startTransition, Suspense, useLayoutEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FlashListRef } from '@shopify/flash-list';

vi.mock('react-native', () => ({ AppState: {
  currentState: 'active', addEventListener: () => ({ remove() {} }),
} }));
vi.mock('../../modules/vimicate-diagnostics', () => ({ recordViewportDiagnostic: vi.fn() }));
import { recordViewportDiagnostic } from '../../modules/vimicate-diagnostics';
import { useTranscriptViewport } from './useTranscriptViewport';

type Viewport = ReturnType<typeof useTranscriptViewport>;
let root: Root;
let committed: Viewport;
let attempts: number;
let frames: Map<number, FrameRequestCallback>;
let pending: Promise<never>;
const revisionA = {}; const revisionB = {};
const before = vi.fn(); const after = vi.fn();
const list = {
  scrollToOffset: vi.fn(), scrollToIndex: vi.fn(),
  getLayout: vi.fn((index: number) => ({ x: 0, y: index * 20, width: 400, height: 20 })),
  getWindowSize: () => ({ width: 400, height: 400 }),
  getChildContainerDimensions: () => ({ width: 400, height: 2_000 }),
  getFirstItemOffset: () => 0, getAbsoluteLastScrollOffset: () => 600,
};
function Owner({ next = false }: { next?: boolean }) {
  attempts++;
  const viewport = useTranscriptViewport(next ? 'b' : 'a', next ? revisionB : revisionA,
    next ? 2 : 100, next ? 1 : 40, next ? 1 : 40, next ? after : before);
  useLayoutEffect(() => { committed = viewport; viewport.list.current = list as unknown as FlashListRef<unknown>; });
  return null;
}
function Pause({ suspend }: { suspend: boolean }) { if (suspend) throw pending; return null; }
function Scene({ next = false, suspend = false }: { next?: boolean; suspend?: boolean }) {
  return <Suspense fallback={null}><Owner next={next} /><Pause suspend={suspend} /></Suspense>;
}
const tick = () => { const callbacks = [...frames.values()]; frames.clear(); callbacks.forEach(callback => callback(0)); };
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); vi.stubGlobal('React', React);
  frames = new Map(); let id = 0;
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { frames.set(++id, callback); return id; });
  vi.stubGlobal('cancelAnimationFrame', (key: number) => frames.delete(key));
  attempts = 0; pending = new Promise<never>(() => {});
  vi.clearAllMocks(); root = createRoot(document.createElement('div'));
});
afterEach(async () => { await act(async () => root.unmount()); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
async function suspendReplacement() {
  await act(async () => root.render(<Scene />));
  const visible = committed; const count = attempts;
  await act(async () => startTransition(() => root.render(<Scene next suspend />)));
  expect(attempts).toBeGreaterThan(count); expect(committed).toBe(visible);
  return visible;
}
describe('committed viewport input authority', () => {
  it('reveals measured question targets inside a taller-than-window cell in both directions', async () => {
    await act(async () => root.render(<Scene />));
    list.getLayout.mockImplementation(index => ({ x: 0, y: index * 20, width: 400, height: index === 40 ? 1_000 : 20 }));
    committed.onContentSizeChange(400, 2_000);
    committed.onLayout({ nativeEvent: { layout: { height: 400 } } } as never); tick();
    list.scrollToOffset.mockClear();
    const offset = vi.spyOn(list, 'getAbsoluteLastScrollOffset').mockReturnValue(600);
    const original = committed.captureRegionPosition(40)!;
    expect(original).toEqual({ y: -200, height: 400 });
    committed.revealRegion(40, { y: 700, height: 40 }); tick();
    expect(list.scrollToOffset).toHaveBeenLastCalledWith({ offset: 1_320, animated: false, skipFirstItemOffset: true });
    offset.mockReturnValue(1_320);
    committed.revealRegion(40, { y: 20, height: 40 }); tick();
    expect(list.scrollToOffset).toHaveBeenLastCalledWith({ offset: 640, animated: false, skipFirstItemOffset: true });
    offset.mockReturnValue(640);
    committed.revealRegion(40, { y: 200, height: 700 }); tick();
    expect(list.scrollToOffset).toHaveBeenLastCalledWith({ offset: 1_000, animated: false, skipFirstItemOffset: true });
    offset.mockReturnValue(1_000);
    committed.revealRegion(40, { y: 700, height: 40 });
    committed.revealRegion(40, { y: 20, height: 40 }); list.scrollToOffset.mockClear(); tick();
    expect(list.scrollToOffset).toHaveBeenCalledExactlyOnceWith({ offset: 640, animated: false, skipFirstItemOffset: true });
    offset.mockReturnValue(640);
    committed.revealRegion(40, original); tick();
    expect(list.scrollToOffset).toHaveBeenLastCalledWith({ offset: 600, animated: false, skipFirstItemOffset: true });
    committed.revealRegion(40, { y: 700, height: 40 }); committed.cancelRegionReveal(); list.scrollToOffset.mockClear(); tick();
    expect(list.scrollToOffset).not.toHaveBeenCalled();
    committed.revealRegion(40, { y: 700, height: 40 });
    await act(async () => root.render(<Scene next />)); list.scrollToOffset.mockClear(); tick();
    expect(list.scrollToOffset).not.toHaveBeenCalled();
  });
  it('keeps active question reveal authority on the visible dataset during a suspended replacement', async () => {
    const visible = await suspendReplacement();
    list.getLayout.mockImplementation(index => ({ x: 0, y: index * 20, width: 400, height: index === 40 ? 1_000 : 20 }));
    visible.onContentSizeChange(400, 2_000);
    visible.onLayout({ nativeEvent: { layout: { height: 400 } } } as never); tick();
    list.scrollToOffset.mockClear();
    visible.revealRegion(40, { y: 700, height: 40 }); tick();
    expect(list.scrollToOffset).toHaveBeenCalledExactlyOnceWith({ offset: 1_320, animated: false, skipFirstItemOffset: true });
  });
  it.each(['drag', 'momentum'] as const)('lets an explicit tail command supersede %s and its late completion', async phase => {
    await act(async () => root.render(<Scene />));
    const sample = (y: number) => ({ nativeEvent: { contentOffset: { x: 0, y },
      contentSize: { width: 400, height: 2_000 }, layoutMeasurement: { width: 400, height: 400 } } }) as never;
    committed.onContentSizeChange(400, 2_000);
    committed.onLayout({ nativeEvent: { layout: { height: 400 } } } as never);
    tick(); committed.onScroll(sample(1_600));
    committed.onScrollBeginDrag(); committed.onScroll(sample(600));
    if (phase === 'momentum') {
      committed.onScrollEndDrag({ nativeEvent: { velocity: { y: 2 } } } as never);
      committed.onMomentumScrollBegin();
    }
    list.scrollToOffset.mockClear();
    // The floating button and G both use this same explicit tail handoff.
    committed.reveal(99, true, 'tail');
    // Events from the superseded gesture can still arrive before the frame.
    committed.onScrollEndDrag({ nativeEvent: { velocity: { y: 2 } } } as never);
    committed.onMomentumScrollBegin(); committed.onMomentumScrollEnd();
    tick();
    expect(list.scrollToOffset).toHaveBeenCalledWith({ offset: 1_600, animated: false, skipFirstItemOffset: true });
    committed.onScroll(sample(1_600));
    list.scrollToOffset.mockClear();
    committed.onContentSizeChange(400, 2_100); tick();
    expect(list.scrollToOffset).toHaveBeenCalledWith({ offset: 1_700, animated: false, skipFirstItemOffset: true });
    // A genuinely new touch must still win over the pending tail command.
    list.scrollToOffset.mockClear();
    committed.reveal(99, true, 'tail'); committed.onScrollBeginDrag(); tick();
    expect(list.scrollToOffset).not.toHaveBeenCalled();
  });

  it('attributes a drag on the still-visible thread to that thread during a suspended replacement', async () => {
    const visible = await suspendReplacement();
    visible.onScrollBeginDrag();
    expect(before).toHaveBeenCalledExactlyOnceWith('a'); expect(after).not.toHaveBeenCalled();
  });

  it('bounds keyboard reveal by the visible list, not the smaller uncommitted replacement', async () => {
    const visible = await suspendReplacement();
    visible.reveal(70, true, 'review'); tick();
    expect(list.getLayout).toHaveBeenCalledWith(70);
    expect(list.getLayout).not.toHaveBeenCalledWith(1);
  });

  it('publishes the replacement at commit and retires the previous native bindings', async () => {
    const visible = await suspendReplacement();
    await act(async () => root.render(<Scene next />));
    visible.onScrollBeginDrag(); committed.onScrollBeginDrag();
    expect(before).not.toHaveBeenCalled(); expect(after).toHaveBeenCalledExactlyOnceWith('b');
    committed.reveal(70, true, 'review'); tick();
    expect(list.getLayout).toHaveBeenCalledWith(1);
  });
});

it('keeps the first child content-size callback authoritative for a keyed thread entry', async () => {
  function InitialNativeCommit({ viewport }: { viewport: Viewport }) {
    useLayoutEffect(() => {
      viewport.list.current = list as unknown as FlashListRef<unknown>;
      viewport.onContentSizeChange(400, 2_000);
      viewport.onLayout({ nativeEvent: { layout: { height: 400 } } } as never);
    }, [viewport]);
    return null;
  }
  function Entry({ datasetKey }: { datasetKey: string }) {
    const viewport = useTranscriptViewport(datasetKey, datasetKey === 'other-thread' ? revisionA : revisionB, 100, 40, 40);
    useLayoutEffect(() => { committed = viewport; });
    return <InitialNativeCommit key={datasetKey} viewport={viewport} />;
  }
  await act(async () => root.render(<Entry datasetKey="other-thread" />));
  for (let frame = 0; frame < 6; frame += 1) await act(async () => tick());
  list.getLayout.mockClear(); list.scrollToOffset.mockClear();
  await act(async () => root.render(<Entry datasetKey="one-thread" />));
  // This thread emits no second size callback. Its recycler initially reports
  // no mounted cells, so the already-owned blank recovery must run on entry.
  for (let frame = 0; frame < 6; frame += 1) await act(async () => tick());
  expect(list.getLayout).toHaveBeenCalledWith(40);
  expect(list.scrollToOffset).toHaveBeenCalledTimes(2);
  expect(list.scrollToOffset).toHaveBeenLastCalledWith(expect.objectContaining({ offset: 1_600 }));
});

it('reports the pending dataset reset when entry has no content-size callback', async () => {
  await act(async () => root.render(<Owner />));
  await act(async () => tick());
  await act(async () => tick());
  expect(vi.mocked(recordViewportDiagnostic).mock.calls.map(([line]) => line).some((line) =>
    line.includes('blank-check') && line.includes('reset=1') && line.includes('block=pendingDatasetReset')
  )).toBe(true);
});


it('keeps a queued navigation target on the same row when history prepends before its frame', async () => {
  const original = Array.from({ length: 100 }, (_, index) => `original-${index}`);
  const prepended = [...Array.from({ length: 40 }, (_, index) => `older-${index}`), ...original];
  function PrependOwner({ keys }: { keys: string[] }) {
    const viewport = useTranscriptViewport('same-thread', keys, keys.length, keys.indexOf('original-0'), 0, undefined, keys);
    useLayoutEffect(() => { committed = viewport; viewport.list.current = list as unknown as FlashListRef<unknown>; });
    return null;
  }
  await act(async () => root.render(<PrependOwner keys={original} />));
  committed.reveal(0, true, 'review');
  await act(async () => root.render(<PrependOwner keys={prepended} />));
  list.getLayout.mockClear(); list.scrollToOffset.mockClear();
  tick();
  expect(list.getLayout).toHaveBeenCalledWith(40);
  expect(list.getLayout).not.toHaveBeenCalledWith(0);
  expect(list.scrollToOffset).toHaveBeenCalledWith(expect.objectContaining({ offset: 800 }));
});


it('retires a queued row request when that exact row is removed before publication', async () => {
  const original = ['remove-me', 'retained'];
  function Page({ keys }: { keys: string[] }) {
    const viewport = useTranscriptViewport('one', keys, keys.length, 0, 0, undefined, keys);
    useLayoutEffect(() => { committed = viewport; viewport.list.current = list as unknown as FlashListRef<unknown>; });
    return null;
  }
  await act(async () => root.render(<Page keys={original} />));
  committed.reveal(0, true, 'review');
  await act(async () => root.render(<Page keys={['retained']} />));
  list.scrollToOffset.mockClear(); tick();
  expect(list.scrollToOffset).not.toHaveBeenCalled();
});

it('does not retarget a queued row using keys from an uncommitted page', async () => {
  const original = Array.from({ length: 100 }, (_, index) => `row-${index}`);
  const next = ['new', ...original];
  function Page({ keys, suspend = false }: { keys: string[]; suspend?: boolean }) {
    const viewport = useTranscriptViewport('one', keys, keys.length, 0, 0, undefined, keys);
    useLayoutEffect(() => { committed = viewport; viewport.list.current = list as unknown as FlashListRef<unknown>; });
    return <Pause suspend={suspend} />;
  }
  await act(async () => root.render(<Suspense fallback={null}><Page keys={original} /></Suspense>));
  committed.reveal(0, true, 'review');
  await act(async () => startTransition(() => root.render(<Suspense fallback={null}><Page keys={next} suspend /></Suspense>)));
  list.getLayout.mockClear(); tick();
  expect(list.getLayout).toHaveBeenCalledWith(0);
  expect(list.getLayout).not.toHaveBeenCalledWith(1);
});
