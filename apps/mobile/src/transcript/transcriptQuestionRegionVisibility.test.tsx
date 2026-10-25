// @vitest-environment jsdom
import React, { act, useLayoutEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { FlashListRef } from '@shopify/flash-list';
vi.mock('react-native', () => ({ AppState: { currentState: 'active', addEventListener: () => ({ remove() {} }) } }));
vi.mock('../../modules/vimicate-diagnostics', () => ({ recordViewportDiagnostic: vi.fn() }));
import { useTranscriptViewport } from './useTranscriptViewport';
import { recordViewportDiagnostic } from '../../modules/vimicate-diagnostics';
let root: Root; let viewport: ReturnType<typeof useTranscriptViewport>;
let windowHeight: number;
const rowKeys = Array.from({ length: 100 }, (_, index) => `row-${index}`);
let frames: Map<number, FrameRequestCallback>; let offset: number; let nativeOffset: number | undefined;
const revision = {};
const list = {
  scrollToOffset: vi.fn((input: { offset: number }) => { offset = input.offset; }), scrollToIndex: vi.fn(),
  getLayout: (index: number) => ({ x: 0, y: index * 20, width: 400, height: index === 40 ? 1_000 : 20 }),
  getWindowSize: () => ({ width: 400, height: windowHeight }), getChildContainerDimensions: () => ({ width: 400, height: 2_000 }),
  getFirstItemOffset: () => 0, getAbsoluteLastScrollOffset: () => offset,
  // FlashList exposes the RN ScrollView; web's connected native element is one level further down.
  getNativeScrollRef: () => ({ getNativeScrollRef: () => ({ isConnected: true, scrollTop: nativeOffset }) }),
};
function Owner() {
  viewport = useTranscriptViewport('a', revision, 100, 40, 40, undefined, rowKeys);
  useLayoutEffect(() => { viewport.list.current = list as unknown as FlashListRef<unknown>; });
  return null;
}
const tick = () => { const callbacks = [...frames.values()]; frames.clear(); callbacks.forEach(callback => callback(0)); };
beforeEach(async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); frames = new Map(); let id = 0;
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { frames.set(++id, callback); return id; });
  vi.stubGlobal('cancelAnimationFrame', (key: number) => frames.delete(key));
  windowHeight = 400; offset = 600; nativeOffset = undefined; vi.clearAllMocks(); root = createRoot(document.createElement('div'));
  await act(async () => root.render(<Owner />));
  viewport.onContentSizeChange(400, 2_000);
  viewport.onLayout({ nativeEvent: { layout: { height: 400 } } } as never);
  viewport.onViewableItemsChanged({ viewableItems: [{ index: 40 }], changed: [] } as never); tick();
  offset = 600; list.scrollToOffset.mockClear();
});
afterEach(async () => { await act(async () => root.unmount()); vi.unstubAllGlobals(); });
it('keeps fully visible options stationary including both viewport edges', () => {
  // Viewport 600..1000 contains the measured target regions within cell 800..1800.
  for (const region of [{ y: 0, height: 40 }, { y: 40, height: 40 }, { y: -200, height: 40 }, { y: 160, height: 40 }]) {
    viewport.revealRegion(40, region); tick();
  }
  expect(list.scrollToOffset).not.toHaveBeenCalled(); expect(list.scrollToIndex).not.toHaveBeenCalled();
});
it.each([
  [{ y: 180, height: 40 }, 800], // Bottom clipped by twenty points.
  [{ y: -240, height: 40 }, 380], // Above the window.
  [{ y: 700, height: 40 }, 1_320], // Below the window.
  [{ y: 200, height: 700 }, 1_000], // An oversized target aligns its start.
] as const)('reveals clipped or outside region %j through the existing single indexed writer', (region, expected) => {
  viewport.revealRegion(40, region); expect(list.scrollToOffset).not.toHaveBeenCalled(); tick();
  expect(list.scrollToOffset).toHaveBeenCalledExactlyOnceWith({ offset: expected, animated: false, skipFirstItemOffset: true });
  expect(list.scrollToIndex).not.toHaveBeenCalled();
});
it('restores the exact saved viewport rectangle after moving to a distant option', () => {
  const saved = viewport.captureRegionPosition(40)!; expect(saved).toEqual({ y: -200, height: 400 });
  viewport.revealRegion(40, { y: 700, height: 40 }); tick(); expect(offset).toBe(1_320);
  list.scrollToOffset.mockClear(); viewport.revealRegion(40, saved); tick();
  expect(list.scrollToOffset).toHaveBeenCalledExactlyOnceWith({ offset: 600, animated: false, skipFirstItemOffset: true });
});
it('retires a queued offscreen reveal when a rapid next target is already visible', () => {
  viewport.revealRegion(40, { y: 700, height: 40 }); viewport.revealRegion(40, { y: 20, height: 40 }); tick();
  expect(list.scrollToOffset).not.toHaveBeenCalled();
});
it('uses the connected painted FlashList host for visibility and capture before a JS scroll acknowledgement', () => {
  nativeOffset = 1_300; // JS getter still reports the old 600..1000 window.
  expect(viewport.captureRegionPosition(40)).toEqual({ y: 500, height: 400 });
  viewport.revealRegion(40, { y: 700, height: 40 }); tick();
  expect(list.scrollToOffset).not.toHaveBeenCalled();
});
it('cancels a queued region write on target release', () => {
  viewport.revealRegion(40, { y: 700, height: 40 }); viewport.cancelRegionReveal(); tick();
  expect(list.scrollToOffset).not.toHaveBeenCalled();
});

it('lets an already visible question supersede a queued whole-row selection reveal', () => {
  viewport.reveal(90); viewport.revealRegion(40, { y: 20, height: 40 }); tick();
  expect(list.scrollToOffset).not.toHaveBeenCalled();
});

it('restores the saved top after the viewport shrinks while a question is engaged', () => {
  const saved = viewport.captureRegionPosition(40)!;
  viewport.revealRegion(40, { y: 700, height: 40 }); tick();
  windowHeight = 250;
  viewport.onLayout({ nativeEvent: { layout: { height: windowHeight } } } as never);
  list.scrollToOffset.mockClear(); viewport.revealRegion(40, saved); tick();
  expect(list.scrollToOffset).toHaveBeenCalledExactlyOnceWith({ offset: 600, animated: false, skipFirstItemOffset: true });
});

it('preserves ordinary whole-row centering for forced oversized reveals', () => {
  offset = 0;
  viewport.onViewableItemsChanged({ viewableItems: [{ index: 10 }, { index: 20 }], changed: [] } as never); tick();
  list.scrollToOffset.mockClear(); viewport.reveal(40, true); tick();
  expect(list.scrollToOffset).toHaveBeenCalledExactlyOnceWith({ offset: 1_100, animated: false, skipFirstItemOffset: true });
});

it('top-aligns the source line when leaving an oversized card even if it is the sole visible cell', () => {
  let now = 0; const clock = vi.spyOn(performance, 'now').mockImplementation(() => now);
  offset = 1_300;
  viewport.onViewableItemsChanged({ viewableItems: [{ index: 40, item: {}, key: 'row-40', isViewable: true, timestamp: 0 }], changed: [] });
  viewport.revealAfterRevision(40, 0);
  viewport.cancelRegionReveal(); // Card target releases during the same React commit.
  for (let frame = 0; frame < 12; frame++) { now += 300; tick(); }
  clock.mockRestore();
  expect(list.scrollToOffset).toHaveBeenCalledTimes(1);
  expect(list.scrollToIndex).not.toHaveBeenCalled();
  expect(JSON.stringify(vi.mocked(recordViewportDiagnostic).mock.calls)).toContain('review-complete');
  expect(offset).toBe(800); // Source header at 800 is visible, not the middle of its 1000px card.
});
