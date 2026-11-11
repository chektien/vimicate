// @vitest-environment jsdom
import React, { act, useLayoutEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { FlashListRef } from '@shopify/flash-list';
vi.mock('react-native', () => ({ AppState: { currentState: 'active', addEventListener: () => ({ remove() {} }) } }));
vi.mock('../../modules/vimicate-diagnostics', () => ({ recordViewportDiagnostic: vi.fn() }));
import { useTranscriptViewport } from './useTranscriptViewport';

// Real React and viewport owner, deliberately asynchronous native receipts.
// The fake scroller never acknowledges a write from inside scrollToOffset.
let root: Root;
let viewport: ReturnType<typeof useTranscriptViewport>;
let frames: Map<number, FrameRequestCallback>;
let now: number;
let offset: number;
let header: number;
const keys = Array.from({ length: 100 }, (_, index) => `line-${index}`);
const revision = {};
const list = {
  scrollToOffset: vi.fn<(input: { offset: number }) => void>(), scrollToIndex: vi.fn(),
  getLayout: (index: number) => ({ x: 0, y: index * 20 + (index > 40 ? 980 : 0), width: 400, height: index === 40 ? 1000 : 20 }),
  getWindowSize: () => ({ width: 400, height: 400 }),
  getChildContainerDimensions: () => ({ width: 400, height: 2980 + header }),
  getFirstItemOffset: () => header, getAbsoluteLastScrollOffset: () => offset,
  getNativeScrollRef: () => ({ getNativeScrollRef: () => ({ isConnected: true, scrollTop: offset }) }),
};
function Probe() {
  const current = useTranscriptViewport('return-lifetime', revision, 100, 40, 40, undefined, keys);
  useLayoutEffect(() => { viewport = current; current.list.current = list as unknown as FlashListRef<unknown>; });
  return null;
}
function nativeScroll(value: number) {
  offset = value;
  viewport.onScroll({ nativeEvent: { contentOffset: { x: 0, y: value }, contentSize: { width: 400, height: 2980 + header }, layoutMeasurement: { width: 400, height: 400 } } } as never);
}
function visible(indices: number[]) {
  viewport.onViewableItemsChanged({ viewableItems: indices.map(index => ({ index, key: keys[index], isViewable: true })), changed: [] } as never);
}
async function tick() {
  now += 50;
  await act(async () => { const queued = [...frames.values()]; frames.clear(); queued.forEach(callback => callback(now)); });
}
async function issueRestore() {
  viewport.revealAfterRevision(40, 0, 250);
  for (let frame = 0; frame < 3; frame++) await tick();
  expect(list.scrollToOffset.mock.lastCall?.[0].offset).toBe(1050);
}
async function flushNativeCommands() {
  let delivered = list.scrollToOffset.mock.calls.length;
  for (let frame = 0; frame < 16; frame++) {
    await tick();
    if (list.scrollToOffset.mock.calls.length > delivered) {
      delivered = list.scrollToOffset.mock.calls.length;
      nativeScroll(list.scrollToOffset.mock.lastCall![0].offset);
    }
  }
}
beforeEach(async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); vi.clearAllMocks();
  now = 0; header = 0; offset = 2580; frames = new Map(); let next = 0;
  vi.spyOn(performance, 'now').mockImplementation(() => now);
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { frames.set(++next, callback); return next; });
  vi.stubGlobal('cancelAnimationFrame', (frame: number) => frames.delete(frame));
  root = createRoot(document.createElement('div')); await act(async () => root.render(<Probe />));
  viewport.onLayout({ nativeEvent: { layout: { height: 400 } } } as never);
  viewport.onContentSizeChange(400, 2980);
});
afterEach(async () => { await act(async () => root.unmount()); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('retains a pending pixel return through delayed initial-tail scroll and tail-only viewability', async () => {
  await issueRestore();
  nativeScroll(2580); visible([99]); // Initial recycler paint, not a reader gesture.
  nativeScroll(1050); visible([40]); // Only now is the requested native write acknowledged.
  header = 30; viewport.onContentSizeChange(400, 3010); visible([40]);
  await flushNativeCommands();
  expect(list.scrollToOffset.mock.lastCall?.[0].offset).toBe(1080);
  expect(offset).toBe(1080);
});

it('retains within-card pixels through empty completion viewability and later measured geometry', async () => {
  await issueRestore(); nativeScroll(1050); visible([]);
  for (let frame = 0; frame < 8; frame++) await tick();
  // A second empty report after numeric confirmation used to release generic
  // blank recovery, which centered the tall row and discarded its local250.
  visible([]); for (let frame = 0; frame < 3; frame++) await tick();
  header = 30; viewport.onContentSizeChange(400, 3010); visible([40]);
  await flushNativeCommands();
  expect(list.scrollToOffset.mock.lastCall?.[0].offset).toBe(1080);
  expect(offset).toBe(1080);
});

it('does not let inferred movement from a completed restore cancel a replacement request', async () => {
  await issueRestore(); nativeScroll(1050); visible([40]);
  for (let frame = 0; frame < 4; frame++) await tick();
  // A mismatched event can precede the native position settling back, with
  // that final position visible to measurement before its JS scroll receipt.
  nativeScroll(2580); offset = 1050;
  await tick(); // Complete the original restore from its measured position.
  list.scrollToOffset.mockClear();
  viewport.revealAfterRevision(60, 0, 10.5);
  await tick(); await tick();
  visible([60]); // Excludes the old target40, but belongs to the new target60.
  await tick();
  expect(list.scrollToOffset.mock.lastCall?.[0].offset).toBe(2190.5);
  nativeScroll(2190.5); await flushNativeCommands();
  expect(offset).toBe(2190.5);
});
