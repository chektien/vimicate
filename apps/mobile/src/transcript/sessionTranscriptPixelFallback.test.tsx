// @vitest-environment jsdom
// The installed FlashList controller and layout manager execute the fallback.
// Native paint is synthetic. This is not a UIKit/Fabric acceptance claim.
import React, { act, useLayoutEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
vi.mock('react-native', () => ({
  I18nManager: { isRTL: false },
  PixelRatio: { getPixelSizeForLayoutSize: (value: number) => value, roundToNearestPixel: (value: number) => value },
  AppState: { currentState: 'active', addEventListener: () => ({ remove() {} }) },
}));
vi.mock('../../modules/vimicate-diagnostics', () => ({ recordViewportDiagnostic: vi.fn() }));
vi.mock('../../node_modules/@shopify/flash-list/dist/native/config/PlatformHelper', () => ({ PlatformConfig: { supportsOffsetCorrection: true } }));
import { RecyclerViewManager } from '../../node_modules/@shopify/flash-list/dist/recyclerview/RecyclerViewManager';
import { useRecyclerViewController } from '../../node_modules/@shopify/flash-list/dist/recyclerview/hooks/useRecyclerViewController';
import { useTranscriptViewport } from './useTranscriptViewport';
import { transcriptVisibleContentAnchor } from './transcriptViewportPolicy';

const data = Array.from({ length: 100 }, (_, index) => ({ key: `source-${index}` }));
const rowKeys = data.map(row => row.key);
let root: Root;
let manager: RecyclerViewManager<{ key: string }>;
let viewport: ReturnType<typeof useTranscriptViewport>;
let frames: Map<number, FrameRequestCallback>;
let now: number;
let paintedOffset: number;
let acceptsPaint: boolean;
const scroll = { current: {
  scrollTo: vi.fn((command: { y?: number }) => { if (acceptsPaint && command.y !== undefined) paintedOffset = command.y; }),
  getNativeScrollRef: () => ({ isConnected: true, get scrollTop() { return paintedOffset; } }),
} };
const anchor = { current: { scrollBy: vi.fn() } };
function Probe() {
  const current = useTranscriptViewport('pixel-fallback', data, data.length, 10, 10, undefined, rowKeys);
  useRecyclerViewController(manager, current.list as never, scroll as never, anchor as never);
  useLayoutEffect(() => { viewport = current; });
  return null;
}
async function tick() {
  now += 100;
  await act(async () => { const queued = [...frames.values()]; frames.clear(); queued.forEach(callback => callback(now)); });
}
beforeEach(async () => {
  vi.useFakeTimers(); vi.clearAllMocks(); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  now = 0; paintedOffset = 0; acceptsPaint = true; frames = new Map(); let next = 0;
  vi.spyOn(performance, 'now').mockImplementation(() => now);
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { frames.set(++next, callback); return next; });
  vi.stubGlobal('cancelAnimationFrame', (frame: number) => frames.delete(frame));
  manager = new RecyclerViewManager({ data, renderItem: () => null, keyExtractor: row => row.key,
    maintainVisibleContentPosition: transcriptVisibleContentAnchor, drawDistance: 1200 });
  manager.updateLayoutParams({ width: 400, height: 400 }, 30);
  manager.modifyChildrenLayout(data.map((_, index) => ({ index, dimensions: { width: 400, height: index === 10 ? 1000 : 20 } })), data.length);
  manager.isFirstPaintOnUiComplete = true;
  root = createRoot(document.createElement('div'));
  await act(async () => root.render(<Probe />));
  viewport.onLayout({ nativeEvent: { layout: { height: 400 } } } as never);
  viewport.onContentSizeChange(400, 3010);
});
afterEach(async () => {
  await act(async () => root.unmount()); manager.dispose();
  vi.restoreAllMocks(); vi.useRealTimers(); vi.unstubAllGlobals();
});

it.each([false, true])('executes signed pixel restoration through the installed fallback (initial layout unavailable=%s)', async unavailable => {
  const owner = viewport.list.current!;
  const nativeFallback = owner.scrollToIndex.bind(owner);
  const measuredLayout = owner.getLayout.bind(owner);
  let admitted = !unavailable;
  vi.spyOn(owner, 'getLayout').mockImplementation(index => index === 10 && !admitted ? undefined : measuredLayout(index));
  const fallback = vi.spyOn(owner, 'scrollToIndex').mockImplementation(input => {
    // Layout admission is owned by the real library. Its controller can now
    // read the manager's measured tall cell and complete its corrective steps.
    admitted = true; acceptsPaint = true;
    return nativeFallback(input);
  });
  // In the admitted case, direct native commands are deliberately not painted.
  // The existing bounded verifier must escalate to its corrective library path.
  acceptsPaint = unavailable;
  viewport.revealAfterRevision(10, 0, 650);
  for (let frame = 0; frame < 30 && fallback.mock.calls.length === 0; frame++) await tick();
  expect(fallback).toHaveBeenCalledTimes(1);
  await act(async () => vi.advanceTimersByTimeAsync(201));
  expect(manager.getLayout(10)).toMatchObject({ y: 200, height: 1000 });
  expect(paintedOffset).toBe(880);
  expect(scroll.current.scrollTo.mock.lastCall?.[0].y).toBe(880);
});
