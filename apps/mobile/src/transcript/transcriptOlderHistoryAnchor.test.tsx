// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { FlashListRef } from '@shopify/flash-list';

vi.mock('react-native', () => ({ AppState: { currentState: 'active', addEventListener: () => ({ remove() {} }) } }));
vi.mock('../../modules/vimicate-diagnostics', () => ({ recordViewportDiagnostic: vi.fn() }));
import { recordViewportDiagnostic } from '../../modules/vimicate-diagnostics';
import { useTranscriptViewport } from './useTranscriptViewport';

const original = Array.from({ length: 100 }, (_, index) => `row-${index}`);
let viewport: ReturnType<typeof useTranscriptViewport>;
let keys = original;
let offset = 200;
let rowHeight = 20;
let childHeight: number | null = null;
const native = {
  getLayout: (index: number) => ({ x: 0, y: index * rowHeight, width: 400, height: rowHeight }),
  getWindowSize: () => ({ width: 400, height: 400 }),
  getChildContainerDimensions: () => ({ width: 400, height: childHeight ?? keys.length * rowHeight }),
  getFirstItemOffset: () => 0,
  getAbsoluteLastScrollOffset: () => offset,
  computeVisibleIndices: () => ({ startIndex: Math.floor(offset / rowHeight), endIndex: Math.ceil((offset + 400) / rowHeight) - 1 }),
  scrollToOffset: vi.fn(({ offset: next }: { offset: number }) => { offset = next; }),
  scrollToIndex: vi.fn(),
};
function Probe({ rows }: { rows: string[] }) {
  viewport = useTranscriptViewport('review', rows, rows.length, 20, 20, undefined, rows);
  viewport.list.current = native as unknown as FlashListRef<unknown>;
  return null;
}
let root: ReturnType<typeof createRoot>;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('React', React);
  vi.stubGlobal('requestAnimationFrame', () => 1);
  vi.stubGlobal('cancelAnimationFrame', () => undefined);
  keys = original; offset = 200; rowHeight = 20; childHeight = null;
  native.scrollToOffset.mockClear();
  vi.mocked(recordViewportDiagnostic).mockClear();
  root = createRoot(document.createElement('div'));
});
afterEach(async () => { await act(async () => root.unmount()); vi.unstubAllGlobals(); });

it('restores the same mounted key and pixel position on the prepend layout, without waiting for a later reveal', async () => {
  await act(async () => root.render(<Probe rows={keys} />));
  viewport.onLayout({ nativeEvent: { layout: { height: 400 } } } as never);
  viewport.onContentSizeChange(400, 2000);
  viewport.onScrollBeginDrag();
  viewport.onScrollEndDrag({ nativeEvent: { velocity: { y: 0 } } } as never);
  viewport.captureOlderHistoryAnchor();
  const reviewed = 'row-20';
  const baseline = native.getLayout(keys.indexOf(reviewed)).y - offset;
  keys = [...Array.from({ length: 80 }, (_, index) => `older-${index}`), ...original];
  await act(async () => root.render(<Probe rows={keys} />));
  // FlashList/RefreshControl failed to adjust the native offset at commit.
  viewport.onOlderHistoryLayoutCommit();
  expect(native.getLayout(keys.indexOf(reviewed)).y - offset).toBeCloseTo(baseline);
  expect(native.scrollToOffset).toHaveBeenCalledWith(expect.objectContaining({ animated: false }));
});

it('does not double-correct a native-stable prepend or override a new reader drag', async () => {
  await act(async () => root.render(<Probe rows={keys} />));
  viewport.onLayout({ nativeEvent: { layout: { height: 400 } } } as never);
  viewport.onContentSizeChange(400, 2000);
  viewport.onScrollBeginDrag();
  viewport.onScrollEndDrag({ nativeEvent: { velocity: { y: 0 } } } as never);
  viewport.captureOlderHistoryAnchor();
  keys = [...Array.from({ length: 80 }, (_, index) => `older-${index}`), ...original];
  offset += 1600; // FlashList already kept the mounted key at the same y.
  await act(async () => root.render(<Probe rows={keys} />));
  viewport.onOlderHistoryLayoutCommit();
  expect(native.scrollToOffset).not.toHaveBeenCalled();
  viewport.onScrollBeginDrag();
  offset = 200; // New reader gesture supersedes the old request anchor.
  viewport.onOlderHistoryLayoutCommit();
  expect(native.scrollToOffset).not.toHaveBeenCalled();
});

it('does not mistake a prepend offset for off-content before native content height settles', async () => {
  await act(async () => root.render(<Probe rows={keys} />));
  viewport.onLayout({ nativeEvent: { layout: { height: 400 } } } as never);
  viewport.onContentSizeChange(400, 2000);
  viewport.onScrollBeginDrag();
  viewport.onScrollEndDrag({ nativeEvent: { velocity: { y: 0 } } } as never);
  viewport.captureOlderHistoryAnchor();
  keys = [...Array.from({ length: 80 }, (_, index) => `older-${index}`), ...original];
  offset = 1800; // Native insertion retained row-20 at y=200; React still knows the old height.
  await act(async () => root.render(<Probe rows={keys} />));
  viewport.onScroll({ nativeEvent: { contentOffset: { x: 0, y: 1800 },
    contentSize: { width: 400, height: 2000 }, layoutMeasurement: { width: 400, height: 400 },
    velocity: { x: 0, y: 0 } } } as never);
  expect(vi.mocked(recordViewportDiagnostic).mock.calls.flat().join('\n')).not.toContain('off-content');
  expect(native.scrollToOffset).not.toHaveBeenCalled();
});

it('waits for sufficient native content height before writing and deduplicates an unsettled correction', async () => {
  await act(async () => root.render(<Probe rows={keys} />));
  viewport.onLayout({ nativeEvent: { layout: { height: 400 } } } as never);
  viewport.onContentSizeChange(400, 2000);
  viewport.onScrollBeginDrag();
  viewport.onScrollEndDrag({ nativeEvent: { velocity: { y: 0 } } } as never);
  viewport.captureOlderHistoryAnchor();
  keys = [...Array.from({ length: 80 }, (_, index) => `older-${index}`), ...original];
  childHeight = 2000; // Prepend layouts exist, but native extent is a prior generation.
  await act(async () => root.render(<Probe rows={keys} />));
  viewport.onOlderHistoryLayoutCommit();
  expect(native.scrollToOffset).not.toHaveBeenCalled();
  childHeight = 3600;
  viewport.onContentSizeChange(400, 3600);
  viewport.onOlderHistoryLayoutCommit();
  expect(native.scrollToOffset).toHaveBeenCalledTimes(1);
});

it('corrects a pull-requested prepend when the owning drag settles after publication', async () => {
  await act(async () => root.render(<Probe rows={keys} />));
  viewport.onLayout({ nativeEvent: { layout: { height: 400 } } } as never);
  viewport.onContentSizeChange(400, 2000);
  const baseline = native.getLayout(20).y - offset;
  viewport.onScrollBeginDrag();
  offset = -200; // RefreshControl bounce has displaced the visible range.
  viewport.captureOlderHistoryAnchor(); // Request must retain the pre-drag key and position.
  keys = [...Array.from({ length: 80 }, (_, index) => `older-${index}`), ...original];
  await act(async () => root.render(<Probe rows={keys} />));
  viewport.onOlderHistoryLayoutCommit();
  expect(native.scrollToOffset).not.toHaveBeenCalled();
  viewport.onScrollEndDrag({ nativeEvent: { velocity: { y: 0 } } } as never);
  expect(native.scrollToOffset).toHaveBeenCalledWith(expect.objectContaining({ animated: false }));
  expect(native.getLayout(keys.indexOf('row-20')).y - offset).toBeCloseTo(baseline);
});
