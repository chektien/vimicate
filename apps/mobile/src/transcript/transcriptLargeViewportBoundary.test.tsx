// @vitest-environment jsdom
// Synthetic native-event boundary. React, the app viewport, and installed
// FlashList controller/manager/layout code are real. No UIKit/Fabric execution.
import React, { act, useLayoutEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
vi.mock('react-native', () => ({ I18nManager: { isRTL: false }, PixelRatio: { getPixelSizeForLayoutSize: (value: number) => value, roundToNearestPixel: (value: number) => value }, AppState: {
  currentState: 'active', addEventListener: () => ({ remove() {} }),
} }));
vi.mock('../../modules/vimicate-diagnostics', () => ({ recordViewportDiagnostic: vi.fn() }));
vi.mock('../../node_modules/@shopify/flash-list/dist/native/config/PlatformHelper', () => ({ PlatformConfig: { supportsOffsetCorrection: true } }));
import { RecyclerViewManager } from '../../node_modules/@shopify/flash-list/dist/recyclerview/RecyclerViewManager';
import { useRecyclerViewController } from '../../node_modules/@shopify/flash-list/dist/recyclerview/hooks/useRecyclerViewController';
import { useTranscriptViewport } from './useTranscriptViewport';
import { transcriptEntryIndex, transcriptVisibleContentAnchor } from './transcriptViewportPolicy';

const data = Array.from({ length: 20 }, (_, index) => ({ key: `synthetic-${index}` }));
const keys = data.map(row => row.key);
let root: Root;
let manager: RecyclerViewManager<{ key: string }>;
let viewport: ReturnType<typeof useTranscriptViewport>;
let controller: ReturnType<typeof useRecyclerViewController<{ key: string }>>;
let frames: Map<number, FrameRequestCallback>;
const scroll = { current: { scrollTo: vi.fn() } };
const anchor = { current: { scrollBy: vi.fn() } };
function Owner({ datasetKey = 'synthetic' }: { datasetKey?: string }) {
  const next = useTranscriptViewport(datasetKey, data, data.length, 19, 19, undefined, keys);
  controller = useRecyclerViewController(manager, next.list as never, scroll as never, anchor as never);
  useLayoutEffect(() => { viewport = next; });
  return null;
}
const layout = (height: number) => ({ nativeEvent: { layout: { width: 1400, height } } }) as never;
const sample = (height: number, contentHeight: number, offset = 0) => ({ nativeEvent: {
  contentOffset: { x: 0, y: offset }, contentSize: { width: 1400, height: contentHeight },
  layoutMeasurement: { width: 1400, height },
} }) as never;
async function tick() {
  await act(async () => {
    const pending = [...frames.values()]; frames.clear(); pending.forEach(callback => callback(0));
  });
}
beforeEach(() => {
  vi.useFakeTimers(); vi.clearAllMocks();
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  frames = new Map(); let id = 0;
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { frames.set(++id, callback); return id; });
  vi.stubGlobal('cancelAnimationFrame', (key: number) => frames.delete(key));
  manager = new RecyclerViewManager({ data, renderItem: () => null, keyExtractor: row => row.key,
    initialScrollIndex: transcriptEntryIndex(data.length, true, 19),
    maintainVisibleContentPosition: transcriptVisibleContentAnchor, drawDistance: 1200 });
  manager.updateLayoutParams({ width: 1400, height: 200 }, 50);
  manager.modifyChildrenLayout(data.map((_, index) => ({ index, dimensions: { width: 1400, height: 20 } })), data.length);
  manager.isFirstPaintOnUiComplete = true;
  root = createRoot(document.createElement('div'));
});
afterEach(async () => {
  await act(async () => root.unmount()); manager.dispose();
  vi.useRealTimers(); vi.unstubAllGlobals();
});

it.each([
  { label: 'large entry', initialWindow: 1000, finalWindow: 1000, initialRowHeight: 20, header: 50, expected: 0 },
  { label: 'viewport growth', initialWindow: 200, finalWindow: 1000, initialRowHeight: 20, header: 50, expected: 0 },
  { label: 'content shrink', initialWindow: 1000, finalWindow: 1000, initialRowHeight: 80, header: 50, expected: 0 },
  { label: 'no header', initialWindow: 1000, finalWindow: 1000, initialRowHeight: 20, header: 0, expected: 0 },
  { label: 'growth while recovery pending', initialWindow: 200, finalWindow: 200, initialRowHeight: 20, header: 50, expected: 0, lateResize: true },
  { label: 'content taller than window', initialWindow: 200, finalWindow: 200, initialRowHeight: 20, header: 50, expected: 250 },
])('bounds partial-tail recovery at the actual library boundary ($label)', async ({ initialWindow, finalWindow, initialRowHeight, header, expected, lateResize }) => {
  manager.updateLayoutParams({ width: 1400, height: initialWindow }, header);
  manager.modifyChildrenLayout(data.map((_, index) => ({ index, dimensions: { width: 1400, height: initialRowHeight } })), data.length);
  await act(async () => root.render(<Owner />));
  await act(async () => {
    controller.applyInitialScrollIndex();
    viewport.onLayout(layout(initialWindow)); viewport.onContentSizeChange(1400, data.length * initialRowHeight + header);
  });
  await tick();
  await act(async () => vi.advanceTimersByTime(101));
  expect(scroll.current.scrollTo.mock.calls.every(([command]) => command.y >= 0)).toBe(true);
  // A delayed partial viewability report survives entry/geometry changes.
  // This is controlled input, not proof that the device produced that sequence.
  manager.updateLayoutParams({ width: 1400, height: finalWindow }, header);
  manager.modifyChildrenLayout(data.map((_, index) => ({ index, dimensions: { width: 1400, height: 20 } })), data.length);
  await act(async () => {
    viewport.onLayout(layout(finalWindow)); viewport.onContentSizeChange(1400, 400 + header);
    viewport.onScroll(sample(finalWindow, 400 + header));
    viewport.onViewableItemsChanged({ viewableItems: data.slice(0, 10).map((item, index) => ({ item, key: item.key, index, isViewable: true, timestamp: 0 })), changed: [] });
  });
  scroll.current.scrollTo.mockClear();
  await tick();
  if (lateResize) {
    manager.updateLayoutParams({ width: 1400, height: 1000 }, header);
    manager.modifyChildrenLayout([], data.length);
    await act(async () => viewport.onLayout(layout(1000)));
  }
  for (let frame = 0; frame < 4; frame++) await tick();
  await act(async () => vi.advanceTimersByTime(201));
  expect(scroll.current.scrollTo.mock.calls.length).toBeGreaterThan(0);
  expect(scroll.current.scrollTo.mock.calls.map(([command]) => command.y)).toContain(expected);
  expect(scroll.current.scrollTo.mock.calls.every(([command]) => command.y >= 0)).toBe(true);
});

it('keeps correction steps bounded if the viewport grows after indexed admission starts', async () => {
  manager.updateLayoutParams({ width: 1400, height: 1000 }, 50);
  manager.modifyChildrenLayout([], data.length);
  await act(async () => root.render(<Owner />));
  const getLayout = manager.getLayout.bind(manager);
  let reads = 0;
  vi.spyOn(manager, 'getLayout').mockImplementation(index => {
    // Controlled geometry publication between corrective target reads. The
    // manager and controller remain real, but this is not native event timing.
    if (++reads === 2) manager.updateLayoutParams({ width: 1400, height: 2000 }, 50);
    return getLayout(index);
  });
  await act(async () => {
    void controller.handlerMethods.scrollToIndex({ index: 19, animated: false, viewPosition: 430 / 980 });
  });
  await act(async () => vi.advanceTimersByTime(201));
  expect(reads).toBeGreaterThan(2);
  expect(scroll.current.scrollTo.mock.calls.map(([command]) => command.y)).toEqual([0]);
});


it.each(['review', 'retired dataset'] as const)('does not run pending recovery after %s takes ownership', async reason => {
  manager.updateLayoutParams({ width: 1400, height: 1000 }, 50);
  manager.modifyChildrenLayout([], data.length);
  await act(async () => root.render(<Owner />));
  await act(async () => {
    viewport.onLayout(layout(1000)); viewport.onContentSizeChange(1400, 450);
    viewport.onViewableItemsChanged({ viewableItems: data.slice(0, 10).map((item, index) => ({ item, key: item.key, index, isViewable: true, timestamp: 0 })), changed: [] });
  });
  await tick();
  await act(async () => {
    if (reason === 'review') viewport.holdReviewAnchor('navigation');
    else root.render(<Owner key="replacement" datasetKey="replacement" />);
  });
  scroll.current.scrollTo.mockClear();
  for (let frame = 0; frame < 5; frame++) await tick();
  await act(async () => vi.advanceTimersByTime(201));
  expect(scroll.current.scrollTo).not.toHaveBeenCalled();
});
