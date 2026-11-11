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
import { recordViewportDiagnostic } from '../../modules/vimicate-diagnostics';

// Real committed React owners, synthetic native geometry. No Fabric, keyboard,
// Gateway, or claim that these controlled event timings occurred on a device.
type Session = 'a' | 'b';
type PixelViewport = ReturnType<typeof useTranscriptViewport> & {
  captureSessionReviewAnchor?: () => { row: number; rowOffset: number } | null;
};
type Geometry = { offset: number; tallHeight: number; header: number; contentLimit?: number; viewportHeight?: number; staleRange?: { startIndex: number; endIndex: number } };
let root: Root;
let viewport: PixelViewport;
let navigation: ReturnType<typeof useSessionTranscriptNavigation>;
let session: Session;
let geometry: Record<Session, Geometry>;
let frames: Map<number, FrameRequestCallback>;
let now: number;
let nextFrame: number;
let historyLoading: boolean;
let canonicalKeys: boolean;
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
    return top + layout.height > state.offset && top < state.offset + (state.viewportHeight ?? 400);
  });
}
function scrollSample(key = session) {
  return { nativeEvent: { contentOffset: { x: 0, y: geometry[key].offset }, contentSize: { width: 400, height: contentHeight(key) }, layoutMeasurement: { width: 400, height: geometry[key].viewportHeight ?? 400 }, velocity: { x: 0, y: 0 } } } as never;
}
function reportNativeScroll() {
  viewport.onScroll(scrollSample());
  viewport.onViewableItemsChanged({ viewableItems: visibleIndices(session).map(index => ({ index, key: keys[session][index], isViewable: true })), changed: [] } as never);
}
const writes = vi.fn<(key: Session, offset: number) => void>();
const owners = Object.fromEntries((['a', 'b'] as const).map(key => [key, {
  getLayout: (index: number) => cell(key, index),
  getWindowSize: () => ({ width: 400, height: geometry[key].viewportHeight ?? 400 }),
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
  const current = useTranscriptViewport(selected, buffers[selected], 100, state.cursor.row, state.cursor.row, navigation.onViewportReview, canonicalKeys ? keys[selected].map(key => `${key}:canonical`) : keys[selected], undefined, {
    onSessionRetire: (key, capture) => navigation.onViewportRetire(key, capture?.kind === 'anchor' ? { ...capture, sourceRow: capture.row } : capture),
    historyLoading,
    resolveSessionAnchor: anchor => buffers[selected].messages!.findIndex(message => message.id === anchor.messageId),
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
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); historyLoading = false; canonicalKeys = false; now = 0; nextFrame = 0; frames = new Map();
  vi.spyOn(performance, 'now').mockImplementation(() => now);
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { frames.set(++nextFrame, callback); return nextFrame; });
  vi.stubGlobal('cancelAnimationFrame', (frame: number) => frames.delete(frame));
  geometry = { a: { offset: 0, tallHeight: 1_000, header: 30 }, b: { offset: 0, tallHeight: 20, header: 30 } };
  session = 'a'; writes.mockClear(); root = createRoot(document.createElement('div'));
  await render('a'); publishGeometry(); await settle(); writes.mockClear();
});
afterEach(async () => { await act(async () => root.unmount()); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('session-return lease across real owner lifetimes', () => {
  it('captures every committed dataset retirement without a rail callback', async () => {
    await park(880.25); await roundTrip(); await settle();
    expect(geometry.a.offset).toBeCloseTo(880.25, 6);
  });

  it('captures the native landing instead of the preceding unacknowledged write', async () => {
    viewport.reveal(50, true); await tick();
    const painted = geometry.a.offset + 150;
    geometry.a.offset = painted; reportNativeScroll();
    await switchTo('b'); await settle(); await switchTo('a'); await settle();
    expect(geometry.a.offset).toBeCloseTo(painted, 6);
  });

  it.each(['native-offset', 'observed-offset', 'recycler-offset'] as const)('retires the accepted %s provenance with its exact capture', async work => {
    await park(880.25);
    vi.spyOn(owners.a, 'getAbsoluteLastScrollOffset').mockReturnValue(1713.6);
    const native = vi.spyOn(owners.a, 'getNativeScrollRef').mockImplementation(() => ({
      getNativeScrollRef: () => work === 'native-offset' ? { isConnected: true, scrollTop: 880.25 } : {},
    }) as never);
    if (work === 'observed-offset') viewport.onScroll(scrollSample());
    else viewport.onViewableItemsChanged({ viewableItems: visibleIndices('a').map(index => ({ index, key: keys.a[index], isViewable: true })), changed: [] } as never);
    expect(native).toHaveBeenCalledTimes(1); // Offset and provenance share one read.
    native.mockImplementation(() => ({ getNativeScrollRef: () => ({ isConnected: true, scrollTop: 42 }) }) as never);
    vi.mocked(recordViewportDiagnostic).mockClear();
    await switchTo('b');
    const capture = vi.mocked(recordViewportDiagnostic).mock.calls.map(([line]) => line).find(line => line.startsWith('session-capture '));
    expect(capture).toContain(`o=${work === 'recycler-offset' ? 1714 : 880} `);
    expect(capture).toMatch(/ f=0(?: |$)/);
    expect(capture).toContain(`work=${work}`);
    expect(native).toHaveBeenCalledTimes(1); // Retirement preserves the sample, not a new probe.
  });

  it.each([600, 1800])('keeps an end-attended question whole after delayed growth at %s ms', async delay => {
    await park(contentHeight('a') - 400); await switchTo('b'); await settle();
    geometry.a.tallHeight -= 280;
    await switchTo('a');
    for (let i = 0; i < delay / 100; i++) await tick();
    geometry.a.tallHeight += 280; publishGeometry(); await settle();
    expect(geometry.a.offset).toBe(contentHeight('a') - 400);
  });

  it.each([true, false])('handles keyboard insets without promoting review to tail (end=%s)', async end => {
    const parked = end ? contentHeight('a') - 400 : 880.25;
    await park(parked); await roundTrip();
    for (let i = 0; i < 6; i++) await tick();
    geometry.a.viewportHeight = 340;
    viewport.onLayout({ nativeEvent: { layout: { height: 340 } } } as never); await settle();
    expect(geometry.a.offset).toBeCloseTo(end ? contentHeight('a') - 340 : parked, 6);
    geometry.a.viewportHeight = 440;
    viewport.onLayout({ nativeEvent: { layout: { height: 440 } } } as never);
    await settle();
    expect(geometry.a.offset).toBeCloseTo(end ? contentHeight('a') - 440 : parked, 6);
  });

  it('holds through the current selection history request beyond the ordinary quiet window', async () => {
    await park(contentHeight('a') - 400); await switchTo('b'); await settle();
    historyLoading = true; await switchTo('a');
    for (let i = 0; i < 40; i++) await tick();
    geometry.a.tallHeight += 280; historyLoading = false; await render('a'); publishGeometry(); await settle();
    expect(geometry.a.offset).toBe(contentHeight('a') - 400);
  });

  it('re-resolves a canonicalized row key by message and line during the lease', async () => {
    await park(880.25); await roundTrip(); for (let i = 0; i < 6; i++) await tick();
    canonicalKeys = true; await render('a'); geometry.a.header += 40; publishGeometry(); await settle();
    expect(geometry.a.offset).toBeCloseTo(920.25, 6);
    expect(JSON.stringify(vi.mocked(recordViewportDiagnostic).mock.calls)).not.toContain('anchor-missing');
  });

  it('keeps a resolvable canonical anchor before the initial handoff writes', async () => {
    await park(880.25); await roundTrip(); canonicalKeys = true; await render('a'); await settle();
    expect(geometry.a.offset).toBeCloseTo(880.25, 6);
  });

  it('does not cancel on a pure focus-style render with unchanged geometry', async () => {
    await park(contentHeight('a') - 400); await roundTrip(); for (let i = 0; i < 6; i++) await tick();
    await render('a'); geometry.a.tallHeight += 280; publishGeometry(); await settle();
    expect(geometry.a.offset).toBe(contentHeight('a') - 400);
  });

  it('ends on an inferred reader move without begin-drag before issuing another correction', async () => {
    await park(880.25); await roundTrip(); for (let i = 0; i < 8; i++) await tick();
    geometry.a.offset = 1800; reportNativeScroll(); writes.mockClear();
    geometry.a.header += 40; publishGeometry(); await settle();
    expect(geometry.a.offset).toBe(1800); expect(writes.mock.calls).toEqual([]);
  });

  it('caps geometry corrections independently of the absolute lifetime', async () => {
    await park(contentHeight('a') - 400); await roundTrip();
    for (let i = 0; i < 12; i++) {
      geometry.a.tallHeight += 20; publishGeometry(); for (let f = 0; f < 5; f++) await tick();
    }
    const commands = writes.mock.calls.filter(([key]) => key === 'a');
    expect(commands.length).toBeLessThanOrEqual(8);
    writes.mockClear(); geometry.a.tallHeight += 100; publishGeometry(); await tick();
    expect(writes.mock.calls).toEqual([]);
  });

  it('does not keep streaming after the finite quiet lease', async () => {
    await park(contentHeight('a') - 400); await roundTrip();
    for (let i = 0; i < 40; i++) await tick();
    const parked = geometry.a.offset; writes.mockClear(); geometry.a.tallHeight += 280; publishGeometry(); await settle();
    expect(geometry.a.offset).toBe(parked); expect(writes.mock.calls).toEqual([]);
  });

  it.each(['drag', 'motion', 'fold', 'question', 'region', 'G', 'submit', 'latest'] as const)('deliberate %s cancels the lease immediately', async input => {
    await park(880.25); await roundTrip(); for (let i = 0; i < 6; i++) await tick();
    if (input === 'drag') await beginReview(430.5);
    else if (input === 'fold') viewport.holdReviewAnchor('fold');
    else if (input === 'question') viewport.captureRegionPosition(10);
    else if (input === 'region') viewport.revealRegion(10, { y: 200, height: 40 });
    else viewport.reveal(20, true, ['G', 'submit', 'latest'].includes(input) ? 'tail' : 'review');
    await tick(); const parked = geometry.a.offset; writes.mockClear();
    geometry.a.header += 40; publishGeometry(); await settle();
    if (!['G', 'submit', 'latest'].includes(input)) {
      expect(geometry.a.offset).toBe(parked); expect(writes.mock.calls).toEqual([]);
    }
  });

  it('targets the session source rather than the Vim cursor when recovery follows exhaustion', async () => {
    await park(880.25); await switchTo('b'); await settle();
    const blocked = vi.spyOn(owners.a, 'scrollToOffset').mockImplementation(() => {});
    await switchTo('a'); for (let i = 0; i < 40; i++) await tick();
    blocked.mockRestore(); writes.mockClear();
    geometry.a.offset = contentHeight('a') + 400; reportNativeScroll(); await tick();
    expect(writes.mock.calls.length).toBeGreaterThan(0);
    expect(geometry.a.offset).toBeLessThan(1500); // The unrelated Vim cursor is row 99 at the tail.
  });

  it.each(['budget', 'deadline'] as const)('hands a %s-ended restore over an unmounted viewport to bounded blank recovery', async reason => {
    await park(880.25); await switchTo('b'); await settle();
    const blocked = vi.spyOn(owners.a, 'scrollToOffset').mockImplementation(() => {});
    const indexed = vi.mocked(owners.a.scrollToIndex); indexed.mockClear();
    geometry.a.offset = 0; await render('a');
    viewport.onLayout({ nativeEvent: { layout: { height: 400 } } } as never);
    viewport.onContentSizeChange(400, contentHeight('a'));
    viewport.onScroll(scrollSample());
    // The recycler mounts nothing and publishes no further native callback.
    viewport.onViewableItemsChanged({ viewableItems: [], changed: [] } as never);
    vi.mocked(recordViewportDiagnostic).mockClear();
    for (let i = 0; i < 40; i++) { if (reason === 'deadline' && i === 3) now += 11_000; await tick(); }
    const lines = vi.mocked(recordViewportDiagnostic).mock.calls.map(([line]) => line);
    const ended = lines.findIndex(line => line.startsWith('session-lease-end') && line.includes(`work=${reason}`));
    expect(ended).toBeGreaterThanOrEqual(0);
    const recovered = lines.findIndex(line => line.startsWith('blank-content'));
    expect(recovered).toBeGreaterThan(ended);
    expect(blocked.mock.calls.length + indexed.mock.calls.length).toBeGreaterThan(0);
    blocked.mockRestore();
  });

  it('retires the exhausted source hint when a later reader move omits begin-drag', async () => {
    await park(880.25); await roundTrip(); for (let i = 0; i < 40; i++) await tick();
    geometry.a.offset = 1800; reportNativeScroll(); writes.mockClear();
    geometry.a.offset = contentHeight('a') + 400; reportNativeScroll(); await tick();
    expect(writes.mock.calls.length).toBeGreaterThan(0);
    expect(geometry.a.offset).toBeGreaterThan(1500);
  });

  it('stops perpetual geometry corrections at its absolute lifetime and on unmount', async () => {
    await park(contentHeight('a') - 400); await roundTrip();
    for (let i = 0; i < 110; i++) { geometry.a.tallHeight += 2; publishGeometry(); await tick(); }
    writes.mockClear(); geometry.a.tallHeight += 100; publishGeometry(); await settle();
    expect(writes.mock.calls).toEqual([]);
    await act(async () => root.unmount());
    expect(frames.size).toBe(0);
  });

  it('question entry retires an already queued session indexed write', async () => {
    await park(880.25); await roundTrip();
    for (let i = 0; i < 3; i++) await tick();
    writes.mockClear(); viewport.captureRegionPosition(10); await tick();
    expect(writes.mock.calls).toEqual([]);
  });

  it('does not pull back a reader move within the same oversized visible row', async () => {
    await park(880.25); await roundTrip();
    for (let i = 0; i < 8; i++) await tick();
    geometry.a.offset = 905.25; reportNativeScroll(); writes.mockClear(); await settle();
    expect(geometry.a.offset).toBe(905.25); expect(writes.mock.calls).toEqual([]);
  });

  it.each([1, 2, 3])('rejects paused session work beyond its deadline at admission phase %s', async phase => {
    await park(880.25); await roundTrip();
    for (let i = 0; i < phase; i++) await tick();
    writes.mockClear(); now += 11_000; await tick();
    await settle();
    expect(writes.mock.calls).toEqual([]);
  });

  it('does not infer reader intent from the first delayed native landing of its own write', async () => {
    await park(880.25); await roundTrip();
    vi.spyOn(owners.a, 'scrollToOffset').mockImplementationOnce(({ offset }) => {
      writes('a', offset); geometry.a.offset = offset;
      viewport.onViewableItemsChanged({ viewableItems: visibleIndices('a').map(index => ({ index, key: keys.a[index], isViewable: true })), changed: [] } as never);
    });
    for (let i = 0; i < 8; i++) await tick();
    geometry.a.offset = 905.25; reportNativeScroll(); await settle();
    expect(geometry.a.offset).toBe(880.25);
  });
});
