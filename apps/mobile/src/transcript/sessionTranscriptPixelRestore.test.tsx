// @vitest-environment jsdom
import React, { act, useLayoutEffect, useRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FlashListRef } from '@shopify/flash-list';
import { useSynchronousState } from '../app/useSynchronousState';
import type { TranscriptPaneHandle } from './TranscriptPane';
import { createTranscriptBuffer, createTranscriptVimState } from './transcriptVim';

vi.mock('react-native', () => ({ AppState: { currentState: 'active', addEventListener: () => ({ remove() {} }) } }));
vi.mock('../../modules/vimicate-diagnostics', () => ({ recordViewportDiagnostic: vi.fn() }));
import { useSessionTranscriptNavigation } from './useSessionTranscriptNavigation';
import { useTranscriptViewport } from './useTranscriptViewport';

// Real committed React owners, synthetic native geometry. No Fabric, keyboard,
// Gateway, or claim that these controlled event timings occurred on a device.
type Session = 'a' | 'b';
type PixelViewport = ReturnType<typeof useTranscriptViewport> & {
  captureSessionReviewAnchor?: () => { row: number; rowOffset: number } | null;
};
type Geometry = { offset: number; tallHeight: number; header: number; contentLimit?: number; staleRange?: { startIndex: number; endIndex: number } };
let root: Root;
let viewport: PixelViewport;
let navigation: ReturnType<typeof useSessionTranscriptNavigation>;
let session: Session;
let geometry: Record<Session, Geometry>;
let frames: Map<number, FrameRequestCallback>;
let now: number;
let nextFrame: number;
const buffers = {
  a: createTranscriptBuffer(Array.from({ length: 100 }, (_, index) => ({ id: `a-${index}`, role: 'assistant' as const, text: index === 10 ? 'Tall question source line' : `A line ${index}` }))),
  b: createTranscriptBuffer(Array.from({ length: 100 }, (_, index) => ({ id: `b-${index}`, role: 'assistant' as const, text: `B line ${index}` }))),
};
const keys = { a: buffers.a.messages!.map(message => message.id), b: buffers.b.messages!.map(message => message.id) };
const tailReveal = { consumeIfAdvanced: () => false };
function cell(key: Session, index: number) {
  const height = geometry[key].tallHeight;
  return { x: 0, y: index * 20 + (index > 10 ? height - 20 : 0), width: 400, height: index === 10 ? height : 20 };
}
function contentHeight(key: Session) { return geometry[key].contentLimit ?? 2_000 + geometry[key].tallHeight - 20 + geometry[key].header; }
function visibleIndices(key: Session) {
  const state = geometry[key];
  return Array.from({ length: 100 }, (_, index) => index).filter(index => {
    const layout = cell(key, index); const top = layout.y + state.header;
    return top + layout.height > state.offset && top < state.offset + 400;
  });
}
function scrollSample(key = session) {
  return { nativeEvent: { contentOffset: { x: 0, y: geometry[key].offset }, contentSize: { width: 400, height: contentHeight(key) }, layoutMeasurement: { width: 400, height: 400 }, velocity: { x: 0, y: 0 } } } as never;
}
function reportNativeScroll() {
  viewport.onScroll(scrollSample());
  viewport.onViewableItemsChanged({ viewableItems: visibleIndices(session).map(index => ({ index, key: keys[session][index], isViewable: true })), changed: [] } as never);
}
const writes = vi.fn<(key: Session, offset: number) => void>();
const owners = Object.fromEntries((['a', 'b'] as const).map(key => [key, {
  getLayout: (index: number) => cell(key, index),
  getWindowSize: () => ({ width: 400, height: 400 }),
  getChildContainerDimensions: () => ({ width: 400, height: contentHeight(key) }),
  getFirstItemOffset: () => geometry[key].header,
  getAbsoluteLastScrollOffset: () => geometry[key].offset,
  getNativeScrollRef: () => ({ getNativeScrollRef: () => ({ isConnected: true, scrollTop: geometry[key].offset }) }),
  computeVisibleIndices: () => {
    const indices = visibleIndices(key);
    return geometry[key].staleRange ?? { startIndex: indices[0]!, endIndex: indices.at(-1)! };
  },
  scrollToOffset: ({ offset }: { offset: number }) => {
    writes(key, offset); geometry[key].offset = offset;
    if (key === session) reportNativeScroll();
  },
  scrollToIndex: vi.fn(),
}])) as unknown as Record<Session, FlashListRef<unknown>>;

function Probe({ selected }: { selected: Session }) {
  const [state, setNavigation, navigationRef] = useSynchronousState(() => createTranscriptVimState(buffers[selected]));
  const pane = useRef<TranscriptPaneHandle | null>(null);
  navigation = useSessionTranscriptNavigation({ sessionKey: selected, buffer: buffers[selected], navigationRef, setNavigation, viewportRef: pane, tailReveal });
  const current = useTranscriptViewport(selected, buffers[selected], 100, state.cursor.row, state.cursor.row, navigation.onViewportReview, keys[selected], undefined, {
    onSessionRetire: (key, capture) => navigation.onViewportRetire(key, capture?.kind === 'anchor' ? { ...capture, sourceRow: capture.row } : capture),
  }) as PixelViewport;
  useLayoutEffect(() => {
    session = selected; viewport = current; current.list.current = owners[selected];
    pane.current = {
      reveal: current.reveal,
      revealAfterRevision: (sourceRow: number, viewPosition?: number, rowOffset?: number) =>
        (current.revealAfterRevision as (row: number, position?: number, offset?: number) => void)(sourceRow, viewPosition, rowOffset),
      restoreSessionPosition: saved => current.revealAfterRevision(buffers[selected].messages!.findIndex(message => message.id === saved.messageId), 0, saved.rowOffset, { anchor: saved, endAligned: (saved.endGap ?? Infinity) <= 1 }),
      viewPositionForSourceRow: current.viewPositionForRow,
      captureReviewPosition: () => {
        const pixel = current.captureSessionReviewAnchor?.();
        if (pixel) return { sourceRow: pixel.row, viewPosition: 0, rowOffset: pixel.rowOffset };
        // Exercise the pre-repair owner as well. Its numeric placement fails
        // the same assertions, not merely an absent proposed method.
        const old = current.captureReviewAnchor();
        return old ? { sourceRow: old.row, viewPosition: old.viewPosition } : null;
      },
    } as TranscriptPaneHandle;
  });
  return null;
}
async function render(selected: Session) {
  await act(async () => root.render(<Probe selected={selected} />));
}
function publishGeometry() {
  viewport.onLayout({ nativeEvent: { layout: { height: 400 } } } as never);
  viewport.onContentSizeChange(400, contentHeight(session));
  reportNativeScroll();
}
async function tick() {
  now += 100;
  await act(async () => { const queued = [...frames.values()]; frames.clear(); queued.forEach(callback => callback(now)); });
}
async function settle() { for (let index = 0; index < 24; index++) await tick(); }
async function switchTo(selected: Session) {
  geometry[selected].offset = 0;
  await render(selected); publishGeometry();
}
async function beginReview(offset: number) {
  await act(async () => {
    viewport.onScrollBeginDrag(); geometry[session].offset = offset; reportNativeScroll(); viewport.onScrollEndDrag(scrollSample());
  });
}
async function park(offset: number) {
  await beginReview(offset);
  await settle(); writes.mockClear();
}
async function roundTrip() { await switchTo('b'); await settle(); await switchTo('a'); writes.mockClear(); }

beforeEach(async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); now = 0; nextFrame = 0; frames = new Map();
  vi.spyOn(performance, 'now').mockImplementation(() => now);
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { frames.set(++nextFrame, callback); return nextFrame; });
  vi.stubGlobal('cancelAnimationFrame', (frame: number) => frames.delete(frame));
  geometry = { a: { offset: 0, tallHeight: 1_000, header: 30 }, b: { offset: 0, tallHeight: 20, header: 30 } };
  session = 'a'; writes.mockClear(); root = createRoot(document.createElement('div'));
  await render('a'); publishGeometry(); await settle(); writes.mockClear();
});
afterEach(async () => { await act(async () => root.unmount()); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('session return preserves measured source-relative pixels', () => {
  it.each([430.5, 880.25])('restores a distinct position inside the same tall question card at %s', async offset => {
    await park(offset); await roundTrip(); await settle();
    expect(geometry.a.offset).toBeCloseTo(offset, 6);
    expect(writes.mock.calls.filter(([key]) => key === 'a').every(([, value]) => Math.abs(value - offset) < 0.01)).toBe(true);
  });

  it.each([false, true])('keeps a normal first-visible row clipped by exactly 10.5 points (stale recycler range=%s)', async stale => {
    geometry.a.tallHeight = 20; publishGeometry(); await park(840.5);
    if (stale) geometry.a.staleRange = { startIndex: 0, endIndex: 19 };
    await roundTrip(); delete geometry.a.staleRange; await settle();
    expect(geometry.a.offset).toBeCloseTo(840.5, 6);
  });

  it('retains a signed position in the leading header gap', async () => {
    await park(10.5); await roundTrip(); await settle();
    expect(geometry.a.offset).toBeCloseTo(10.5, 6);
  });

  it('uses an acknowledged current native scroll event when the UIKit-style ref has no scrollTop', async () => {
    geometry.a.tallHeight = 20; publishGeometry(); await park(840.5);
    vi.spyOn(owners.a, 'getNativeScrollRef').mockReturnValue(null);
    // A library projection can lag the event already accepted by the viewport.
    vi.spyOn(owners.a, 'getAbsoluteLastScrollOffset').mockReturnValue(600);
    await roundTrip(); await settle();
    expect(geometry.a.offset).toBeCloseTo(840.5, 6);
  });

  it('keeps the original source cell intersecting the window after its editor collapses', async () => {
    await park(880.25); await switchTo('b'); await settle();
    geometry.a.tallHeight = 100;
    await switchTo('a'); writes.mockClear(); await settle();
    expect(geometry.a.offset).toBeGreaterThanOrEqual(230);
    expect(geometry.a.offset).toBeLessThan(330);
    expect(visibleIndices('a')).toContain(10);
  });

  it('bounds a captured within-card position when return geometry shrinks below the viewport', async () => {
    await park(880.25); await switchTo('b'); await settle();
    geometry.a.tallHeight = 100; geometry.a.contentLimit = 500;
    await switchTo('a'); writes.mockClear(); await settle();
    expect(geometry.a.offset).toBe(100);
    expect(writes.mock.calls.filter(([key]) => key === 'a').every(([, offset]) => offset >= 0 && offset <= 100)).toBe(true);
  });

  it('corrects a late measured row origin without changing the captured within-row offset', async () => {
    await park(880.25); await roundTrip();
    for (let index = 0; index < 4; index++) await tick();
    geometry.a.header = 70; publishGeometry(); await settle();
    expect(geometry.a.offset).toBeCloseTo(920.25, 6);
  });

  it('lets a new touch review supersede the returning pixel restore', async () => {
    await park(880.25); await roundTrip();
    await beginReview(430.5); writes.mockClear(); await settle();
    expect(geometry.a.offset).toBeCloseTo(430.5, 6);
    expect(writes.mock.calls).toEqual([]);
  });

  it('rejects retired restore frames and native callbacks after another session takes over', async () => {
    await park(880.25); await roundTrip();
    const retiredFrames = [...frames.values()]; const retired = viewport;
    await switchTo('b'); await park(630.5); writes.mockClear();
    await act(async () => {
      retiredFrames.forEach(callback => callback(now));
      retired.onContentSizeChange(400, 9_000); retired.onScrollBeginDrag();
    });
    await settle();
    expect(session).toBe('b'); expect(geometry.b.offset).toBeCloseTo(630.5, 6); expect(writes.mock.calls).toEqual([]);
  });
});
