// @vitest-environment jsdom
import React, { act, useRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FlashListRef } from '@shopify/flash-list';
import { useSynchronousState } from '../app/useSynchronousState';
import type { TranscriptPaneHandle } from './TranscriptPane';
import { createTranscriptBuffer, createTranscriptVimState, type TranscriptBuffer } from './transcriptVim';

vi.mock('react-native', () => ({ AppState: {
  currentState: 'active', addEventListener: () => ({ remove() {} }),
} }));
vi.mock('../../modules/vimicate-diagnostics', () => ({ recordViewportDiagnostic: vi.fn() }));
import { useTranscriptViewport } from './useTranscriptViewport';
import { useSessionTranscriptNavigation } from './useSessionTranscriptNavigation';

// Real React commits and both production owners; native layout is deterministic,
// not Fabric. This tests request authority, not a physical crash or scroll pass.
let viewport: ReturnType<typeof useTranscriptViewport>;
let navigation: ReturnType<typeof useSessionTranscriptNavigation>;
let parkReview: (row?: number) => void;
let cursorRow: number;
let root: Root;
let container: HTMLDivElement;
let nextFrame = 0;
let nativeOffset = 1_600;
const frames = new Map<number, FrameRequestCallback>();
const list = {
  scrollToOffset: vi.fn(), scrollToIndex: vi.fn(),
  getLayout: (index: number) => ({ x: 0, y: index * 20, width: 400, height: 20 }),
  getWindowSize: () => ({ width: 400, height: 400 }),
  getChildContainerDimensions: () => ({ width: 400, height: 2_000 }),
  getFirstItemOffset: () => 0, getAbsoluteLastScrollOffset: () => nativeOffset,
  computeVisibleIndices: () => ({ startIndex: Math.floor(nativeOffset / 20), endIndex: Math.ceil((nativeOffset + 400) / 20) - 1 }),
};
const tailReveal = { consumeIfAdvanced: vi.fn(() => false) };

function Probe({ sessionKey, buffer }: { sessionKey: string; buffer: TranscriptBuffer }) {
  const [state, setNavigation, navigationRef] = useSynchronousState(() => createTranscriptVimState(buffer));
  cursorRow = state.cursor.row;
  parkReview = (row = 40) => setNavigation(current => ({ ...current, followTail: false, cursor: { row, column: 0 } }));
  const viewportRef = useRef<TranscriptPaneHandle | null>(null);
  const result = useSessionTranscriptNavigation({ sessionKey, buffer, navigationRef,
    setNavigation, viewportRef, tailReveal });
  navigation = result;
  viewport = useTranscriptViewport(sessionKey, buffer, buffer.lines.length, state.cursor.row, state.cursor.row, result.onViewportReview);
  viewport.list.current = list as unknown as FlashListRef<unknown>;
  viewportRef.current = {
    reveal: viewport.reveal, revealAfterRevision: viewport.revealAfterRevision,
    viewPositionForSourceRow: () => 0.31,
    captureReviewPosition: () => {
      const anchor = viewport.captureReviewAnchor();
      return anchor ? { sourceRow: anchor.row, viewPosition: anchor.viewPosition } : null;
    },
  } as unknown as TranscriptPaneHandle;
  return null;
}

function buffer(textSuffix = '') {
  return createTranscriptBuffer([{ id: 'answer', role: 'assistant', text: Array.from({ length: 100 }, (_, i) => `${i}${textSuffix}`).join('\n') }]);
}
async function render(key: string, rows = buffer()) {
  await act(async () => root.render(<Probe sessionKey={key} buffer={rows} />));
}
async function tick() {
  await act(async () => { const callbacks = [...frames.values()]; frames.clear(); callbacks.forEach(callback => callback(0)); });
}
async function settle() { for (let i = 0; i < 8; i += 1) await tick(); }
const scroll = (offset: number) => ({ nativeEvent: { contentOffset: { x: 0, y: offset },
  contentSize: { width: 400, height: 2_000 }, layoutMeasurement: { width: 400, height: 400 }, velocity: { x: 0, y: 0 } } } as never);
function touchReview() {
  viewport.onScrollBeginDrag(); nativeOffset = 600;
  viewport.onScroll(scroll(600)); viewport.onScrollEndDrag(scroll(600));
  viewport.onViewableItemsChanged({ viewableItems: Array.from({ length: 20 }, (_, i) => ({ index: i + 30, isViewable: true })) as never, changed: [] });
  navigation.captureCurrentSession();
}
function publishGeometry() {
  viewport.onLayout({ nativeEvent: { layout: { height: 400 } } } as never);
  viewport.onContentSizeChange(400, 2_000);
}

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('React', React);
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { const id = ++nextFrame; frames.set(id, callback); return id; });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
  frames.clear(); vi.clearAllMocks(); nativeOffset = 1_600;
  container = document.createElement('div'); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); frames.clear(); vi.unstubAllGlobals(); });

describe('session handoff versus newer native review', () => {
  it.each([false, true])('captures the current bottom after an acknowledged cursor reveal (scroll callback delivered=%s)', async delivered => {
    const rows = buffer(); await render('a', rows); publishGeometry(); await settle();
    viewport.onScroll(scroll(1600));
    await act(async () => parkReview(85));
    viewport.reveal(85, true, 'review'); await settle();
    nativeOffset = list.scrollToOffset.mock.lastCall![0].offset;
    viewport.onScroll(scroll(nativeOffset)); // Acknowledge the earlier cursor placement.
    // UIKit/trackpad may omit begin-drag. This newer native sample reaches the
    // bottom while the selected cursor remains visible, above the final row.
    nativeOffset = 1600; if (delivered) viewport.onScroll(scroll(nativeOffset));
    navigation.captureCurrentSession();
    await render('b'); await settle(); list.scrollToOffset.mockClear();
    await render('a', rows); publishGeometry(); await settle();
    expect(list.scrollToOffset.mock.calls.map(([request]) => request.offset)).toEqual([1600]);
    expect(cursorRow).toBe(85);
  });

  it('returns to latest after a growth sample arrives before the size callback', async () => {
    const rows = buffer(); await render('a', rows); publishGeometry(); await settle();
    viewport.onScroll(scroll(1600));
    // New content exists, but UIKit first reports the previous end position.
    const sample = { nativeEvent: { contentOffset: { x: 0, y: 1600 }, contentSize: { width: 400, height: 2200 }, layoutMeasurement: { width: 400, height: 400 } } } as never;
    viewport.onScroll(sample); navigation.captureCurrentSession();
    await render('b'); await settle(); list.scrollToOffset.mockClear();
    await render('a', rows); publishGeometry(); await settle();
    viewport.onContentSizeChange(400, 2200); await settle();
    expect(list.scrollToOffset).toHaveBeenLastCalledWith(expect.objectContaining({ offset: 1800 }));
  });

  it('captures review after a topology append before the next viewability callback', async () => {
    const rows = buffer(); await render('a', rows); touchReview();
    const refreshed = createTranscriptBuffer([...rows.messages!, { id: 'later', role: 'assistant', text: 'later' }]);
    await render('a', refreshed);
    // Native cells still occupy offset 600, but the topology commit invalidated
    // the callback range. The switch captures after that commit, not before it.
    navigation.captureCurrentSession();
    await render('b'); await settle(); list.scrollToOffset.mockClear();
    await render('a', refreshed); publishGeometry(); await settle();
    expect(list.scrollToOffset.mock.calls.map(([request]) => request.offset)).toEqual([600]);
    expect(cursorRow).toBe(99); // Touch review no longer advances the Vim cursor to new responses.
  });

  it('captures the latest native range after prepend instead of the preceding callback indices', async () => {
    const rows = buffer(); await render('a', rows); touchReview();
    const refreshed = createTranscriptBuffer([{ id: 'older', role: 'assistant', text: 'older' }, ...rows.messages!]);
    await render('a', refreshed);
    nativeOffset = 620; // Native placement settled; its deferred viewability callback has not fired.
    navigation.captureCurrentSession();
    await render('b'); await settle(); list.scrollToOffset.mockClear();
    await render('a', refreshed); publishGeometry(); await settle();
    expect(list.scrollToOffset.mock.calls.map(([request]) => request.offset)).toEqual([620]);
    expect(cursorRow).toBe(100);
  });

  it('preserves a touch-reviewed viewport on return even when the Vim cursor stayed at the tail', async () => {
    const rows = buffer(); await render('a', rows);
    touchReview(); expect(cursorRow).toBe(99);
    await render('b'); await settle(); list.scrollToOffset.mockClear(); list.scrollToIndex.mockClear();
    await render('a', rows);
    publishGeometry();
    await settle();
    expect(list.scrollToOffset.mock.calls.map(([request]) => request.offset)).toEqual([600]);
    expect(cursorRow).toBe(99);
  });

  it('remaps a touch anchor through prepended history before the return frame', async () => {
    const rows = buffer(); await render('a', rows); touchReview();
    await render('b'); await settle(); list.scrollToOffset.mockClear();
    await render('a', rows); publishGeometry();
    await render('a', createTranscriptBuffer([
      { id: 'older', role: 'assistant', text: 'older line' },
      ...(rows.messages ?? []),
    ])); await settle();
    expect(list.scrollToOffset.mock.calls.map(([request]) => request.offset)).toEqual([620]);
  });

  it('leaves an in-place prepend to native anchoring without moving the Vim cursor', async () => {
    const rows = buffer(); await render('a', rows); touchReview();
    await render('a', createTranscriptBuffer([
      { id: 'older', role: 'assistant', text: 'older line' },
      ...(rows.messages ?? []),
    ])); await settle();
    expect(list.scrollToOffset).not.toHaveBeenCalled();
    expect(list.scrollToIndex).not.toHaveBeenCalled();
    expect(cursorRow).toBe(100);
  });

  it('reconciles a keyboard-selected row without a second viewport reveal after insertion', async () => {
    const rows = buffer(); await render('a', rows); await act(async () => parkReview());
    touchReview();
    await render('a', createTranscriptBuffer([
      { id: 'older', role: 'assistant', text: 'older line' }, ...rows.messages!,
    ])); await settle();
    expect(cursorRow).toBe(41);
    expect(list.scrollToOffset).not.toHaveBeenCalled();
    expect(list.scrollToIndex).not.toHaveBeenCalled();
  });

  it('does not pull a reader back to the request-start position after they move while history loads', async () => {
    const rows = buffer(); await render('a', rows); touchReview();
    // Request captured offset 600, but the reader moves while transport waits.
    viewport.onScrollBeginDrag(); nativeOffset = 1_000;
    viewport.onScroll(scroll(1_000)); viewport.onScrollEndDrag(scroll(1_000));
    await render('a', createTranscriptBuffer([
      { id: 'older', role: 'assistant', text: 'older line' }, ...rows.messages!,
    ]));
    // Recycler preserves the current native row across insertion, not the old
    // request snapshot. No later app writer may reclaim that old snapshot.
    nativeOffset = 1_020;
    await settle();
    expect(list.scrollToOffset).not.toHaveBeenCalled();
    expect(list.scrollToIndex).not.toHaveBeenCalled();
  });

  it('does not revive a captured touch anchor after an explicit tail action is captured', async () => {
    const rows = buffer(); await render('a', rows); touchReview();
    viewport.reveal(99, true, 'tail'); await settle(); navigation.captureCurrentSession();
    await render('b'); await settle(); list.scrollToOffset.mockClear();
    await render('a', rows); publishGeometry(); await settle();
    expect(list.scrollToOffset.mock.calls.every(([request]) => request.offset === 1_600)).toBe(true);
    expect(list.scrollToOffset).toHaveBeenCalled();
  });

  it('lets a newly submitted prompt supersede the pending touch-review return', async () => {
    const rows = buffer(); await render('a', rows); touchReview();
    await render('b'); await settle(); list.scrollToOffset.mockClear();
    await render('a', rows); publishGeometry();
    tailReveal.consumeIfAdvanced.mockReturnValueOnce(true);
    await render('a', buffer(' submitted')); await settle();
    expect(list.scrollToOffset.mock.calls.every(([request]) => request.offset === 1_600)).toBe(true);
    expect(list.scrollToOffset).toHaveBeenCalled();
  });

  it('lets a newer touch cancel the captured review return', async () => {
    const rows = buffer(); await render('a', rows); touchReview();
    await render('b'); await settle(); list.scrollToOffset.mockClear();
    await render('a', rows); publishGeometry();
    viewport.onScrollBeginDrag(); viewport.onScroll(scroll(300)); await settle();
    expect(list.scrollToOffset).not.toHaveBeenCalled();
  });

  it('does not reclaim the tail after a drag starts before the return frame', async () => {
    await render('a'); await render('b');
    viewport.onLayout({ nativeEvent: { layout: { height: 400 } } } as never);
    viewport.onContentSizeChange(400, 2_000);
    viewport.onScrollBeginDrag(); viewport.onScroll(scroll(600));
    await settle();
    expect(list.scrollToOffset).not.toHaveBeenCalled();
    expect(list.scrollToIndex).not.toHaveBeenCalled();
  });

  it('does not revive the canceled handoff when a refresh arrives after the drag', async () => {
    await render('a'); await render('b');
    viewport.onScrollBeginDrag(); viewport.onScroll(scroll(600)); viewport.onScrollEndDrag(scroll(600));
    await render('b', buffer(' refreshed')); await settle();
    expect(list.scrollToOffset).not.toHaveBeenCalled();
    expect(list.scrollToIndex).not.toHaveBeenCalled();
  });

  it('does not let a retired session cancel the current return request', async () => {
    await render('a'); await render('b');
    viewport.onScroll(scroll(1_600));
    navigation.onViewportReview('a');
    await settle();
    expect(list.scrollToOffset).toHaveBeenCalledExactlyOnceWith({ offset: 1_600, animated: false, skipFirstItemOffset: true });
  });

  it('cancels a saved review-position return as well as a tail return', async () => {
    await render('a'); await act(async () => parkReview()); navigation.captureCurrentSession();
    await render('b'); await settle(); list.scrollToOffset.mockClear(); list.scrollToIndex.mockClear();
    await render('a');
    viewport.onScrollBeginDrag(); viewport.onScroll(scroll(300));
    await settle();
    expect(list.scrollToOffset).not.toHaveBeenCalled();
    expect(list.scrollToIndex).not.toHaveBeenCalled();
  });

  it('still accepts a fresh explicit tail intent after touch cancels the return', async () => {
    await render('a'); await render('b');
    viewport.onScrollBeginDrag(); viewport.onScroll(scroll(600)); viewport.onScrollEndDrag(scroll(600));
    await settle();
    expect(list.scrollToOffset).not.toHaveBeenCalled();
    viewport.reveal(99, true, 'tail'); await settle();
    expect(list.scrollToOffset).toHaveBeenCalledExactlyOnceWith({ offset: 1_600, animated: false, skipFirstItemOffset: true });
  });

  it('rejects a canceled handoff even if the platform delivers its frame late', async () => {
    await render('a'); await render('b');
    const retired = [...frames.values()];
    viewport.onScrollBeginDrag(); viewport.onScroll(scroll(600));
    await act(async () => retired.forEach(callback => callback(0)));
    await settle();
    expect(list.scrollToOffset).not.toHaveBeenCalled();
    expect(list.scrollToIndex).not.toHaveBeenCalled();
  });

  it('does not attribute a retired list drag to the new session', async () => {
    await render('a'); const retired = viewport;
    await render('b'); viewport.onScroll(scroll(1_600));
    retired.onScrollBeginDrag();
    await settle();
    expect(list.scrollToOffset).toHaveBeenCalledExactlyOnceWith({ offset: 1_600, animated: false, skipFirstItemOffset: true });
  });

  it('rejects retired content measurements before they poison the new tail geometry', async () => {
    await render('a'); const retired = viewport;
    await render('b'); viewport.onScroll(scroll(1_600));
    retired.onContentSizeChange(400, 9_000);
    await settle();
    expect(list.scrollToOffset).toHaveBeenCalledExactlyOnceWith({ offset: 1_600, animated: false, skipFirstItemOffset: true });
  });

  it('does not revive callbacks from the first mount when the same session returns', async () => {
    await render('a'); const retired = viewport;
    await render('b'); await render('a'); viewport.onScroll(scroll(1_600));
    retired.onScrollBeginDrag();
    await settle();
    expect(list.scrollToOffset).toHaveBeenCalledExactlyOnceWith({ offset: 1_600, animated: false, skipFirstItemOffset: true });
  });
});
