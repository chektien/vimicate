// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FlashListRef } from '@shopify/flash-list';

vi.mock('react-native', () => ({ AppState: {
  currentState: 'active', addEventListener: () => ({ remove() {} }),
} }));
vi.mock('../../modules/vimicate-diagnostics', () => ({ recordViewportDiagnostic: vi.fn() }));
import { useTranscriptViewport } from './useTranscriptViewport';

// Physical owlpi entry: after a tail publication the recycler reported one
// native sample near -1,000,000 while the measured rows stayed in place. The
// pane painted nothing until `k` issued an indexed reveal.
let viewport: ReturnType<typeof useTranscriptViewport>;
let root: Root;
let nextFrame = 0;
const frames = new Map<number, FrameRequestCallback>();
const reviewIntent = vi.fn();
const list = {
  scrollToOffset: vi.fn(), scrollToIndex: vi.fn(),
  getLayout: (index: number) => ({ x: 0, y: index * 20, width: 400, height: 20 }),
  getWindowSize: () => ({ width: 400, height: 400 }),
  getChildContainerDimensions: () => ({ width: 400, height: 2_000 }),
  getFirstItemOffset: () => 0, getAbsoluteLastScrollOffset: () => 1_600,
  computeVisibleIndices: () => ({ startIndex: 80, endIndex: 99 }),
};
const revision = {};

function Probe() {
  viewport = useTranscriptViewport('owlpi', revision, 100, 99, 99, reviewIntent);
  viewport.list.current = list as unknown as FlashListRef<unknown>;
  return null;
}

async function settle() {
  for (let i = 0; i < 8; i += 1) {
    await act(async () => { const callbacks = [...frames.values()]; frames.clear(); callbacks.forEach(callback => callback(0)); });
  }
}
const scroll = (offset: number) => ({ nativeEvent: { contentOffset: { x: 0, y: offset },
  contentSize: { width: 400, height: 2_000 }, layoutMeasurement: { width: 400, height: 400 }, velocity: { x: 0, y: 0 } } } as never);

beforeEach(async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('React', React);
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { const id = ++nextFrame; frames.set(id, callback); return id; });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
  frames.clear(); vi.clearAllMocks();
  root = createRoot(document.createElement('div'));
  await act(async () => root.render(<Probe />));
  viewport.onLayout({ nativeEvent: { layout: { height: 400 } } } as never);
  viewport.onContentSizeChange(400, 2_000);
  await settle();
  viewport.onScroll(scroll(1_600));
  viewport.onViewableItemsChanged({ viewableItems: Array.from({ length: 20 }, (_, i) => ({ index: i + 80, isViewable: true })) as never, changed: [] });
  await settle();
  vi.clearAllMocks();
});
afterEach(async () => { await act(async () => root.unmount()); frames.clear(); vi.unstubAllGlobals(); });

describe('off-content native scroll sample', () => {
  it('recovers a sample far above the content instead of treating it as reader review', async () => {
    viewport.onScroll(scroll(-997_668));
    viewport.onViewableItemsChanged({ viewableItems: [], changed: [] });
    await settle();

    expect(reviewIntent).not.toHaveBeenCalled();
    expect(list.scrollToOffset.mock.calls.length + list.scrollToIndex.mock.calls.length).toBeGreaterThan(0);
  });

  it('still treats an in-content upward move without begin-drag as review', async () => {
    viewport.onScroll(scroll(900));
    await settle();

    expect(reviewIntent).toHaveBeenCalledWith('owlpi');
  });
});
