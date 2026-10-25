import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FlashListRef } from '@shopify/flash-list';

const hooks = vi.hoisted(() => ({ effects: [] as Array<() => void | (() => void)>,
  state: 'active', listeners: new Set<(state: string) => void>() }));
vi.mock('react', () => ({
  useMemo: (factory: () => unknown) => factory(),
  useRef: (current: unknown) => ({ current }), useCallback: (callback: unknown) => callback,
  useEffect: (effect: () => void | (() => void)) => { hooks.effects.push(effect); },
  useInsertionEffect: (effect: () => void | (() => void)) => { hooks.effects.push(effect); },
  useLayoutEffect: (effect: () => void | (() => void)) => { hooks.effects.push(effect); },
}));
vi.mock('react-native', () => ({ AppState: {
  get currentState() { return hooks.state; },
  addEventListener: (_event: string, callback: (state: string) => void) => {
    hooks.listeners.add(callback); return { remove: () => hooks.listeners.delete(callback) };
  },
} }));
vi.mock('../../modules/vimicate-diagnostics', () => ({ recordViewportDiagnostic: vi.fn() }));
import { useTranscriptViewport } from './useTranscriptViewport';

function setup(initialState = 'active', cursorRow = 40, itemCount = 100) {
  hooks.state = initialState; let next = 1;
  const queued = new Map<number, FrameRequestCallback>();
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    const id = next++; queued.set(id, callback); return id;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => { queued.delete(id); });
  const reviewIntent = vi.fn(); const userReachedEnd = vi.fn();
  const viewport = useTranscriptViewport('one', {}, itemCount, cursorRow, cursorRow, reviewIntent, undefined, userReachedEnd);
  const list = { scrollToEnd: vi.fn(), scrollToIndex: vi.fn(), scrollToOffset: vi.fn(),
    getLayout: vi.fn((index: number) => ({ x: 0, y: index * 20, width: 400, height: 20 })),
    getWindowSize: () => ({ width: 400, height: 400 }),
    getChildContainerDimensions: () => ({ width: 400, height: 2_000 }),
    getFirstItemOffset: () => 0, getAbsoluteLastScrollOffset: () => 0 };
  viewport.list.current = list as unknown as FlashListRef<unknown>;
  let cleanup = hooks.effects.map(effect => effect());
  const scene = (state: string) => { hooks.state = state; hooks.listeners.forEach(listener => listener(state)); };
  const tick = () => { const callbacks = [...queued.values()]; queued.clear(); callbacks.forEach(callback => callback(0)); };
  return { viewport, list, queued, scene, tick, reviewIntent, userReachedEnd,
    replayEffects: () => { cleanup.forEach(dispose => dispose?.()); cleanup = hooks.effects.map(effect => effect()); },
    unmount: () => { cleanup.forEach(dispose => dispose?.()); viewport.list.current = null; } };
}

beforeEach(() => { hooks.effects = []; hooks.listeners.clear(); hooks.state = 'active'; });
afterEach(() => { vi.unstubAllGlobals(); });

describe('actual viewport hook scene lifetime', () => {
  it.each(['inactive', 'background'])('does not infer reader review from a passive scroll while %s', state => {
    const test = setup('active', 99);
    const sample = (offset: number) => ({ nativeEvent: { contentOffset: { x: 0, y: offset },
      contentSize: { width: 400, height: 2000 }, layoutMeasurement: { width: 400, height: 400 } } } as never);
    test.viewport.onLayout({ nativeEvent: { layout: { height: 400 } } } as never);
    test.viewport.onContentSizeChange(400, 2000); test.tick();
    test.viewport.onScroll(sample(1600)); test.list.scrollToOffset.mockClear();
    test.scene(state);
    test.viewport.onScroll(sample(1200)); // Native geometry while the app cannot receive reader input.
    test.tick(); expect(test.list.scrollToOffset).not.toHaveBeenCalled();
    expect(test.reviewIntent).not.toHaveBeenCalled();
    test.scene('active'); test.tick();
    expect(test.list.scrollToOffset).toHaveBeenLastCalledWith(expect.objectContaining({ offset: 1600 }));
    test.unmount();
  });

  it('gives automatic latest and downward final-line navigation the same 24-point measured tail without resuming review', () => {
    const test = setup('active', 99);
    test.list.getChildContainerDimensions = () => ({ width: 400, height: 2024 });
    test.list.getLayout.mockImplementation(index => ({ x: 0, y: index * 20, width: 400, height: index === 99 ? 44 : 20 }));
    test.viewport.onLayout({ nativeEvent: { layout: { height: 400 } } } as never);
    test.viewport.onContentSizeChange(400, 2024); test.tick();
    expect(test.list.scrollToOffset).toHaveBeenLastCalledWith(expect.objectContaining({ offset: 1624 }));
    test.viewport.onScroll({ nativeEvent: { contentOffset: { x: 0, y: 1550 }, contentSize: { width: 400, height: 2024 }, layoutMeasurement: { width: 400, height: 400 } } } as never);
    test.viewport.reveal(98, false, 'review', 97); test.tick();
    test.list.scrollToOffset.mockClear();
    test.viewport.reveal(99, false, 'review', 98);
    expect(test.viewport.viewPositionForRow(99)).toBeCloseTo(1); // Switching before its frame must capture the same gap.
    test.tick();
    expect(test.list.scrollToOffset).toHaveBeenCalledExactlyOnceWith({ offset: 1624, animated: false, skipFirstItemOffset: true });
    test.list.scrollToOffset.mockClear();
    test.viewport.onContentSizeChange(400, 2224); test.tick();
    test.scene('background'); test.scene('active'); test.tick();
    expect(test.list.scrollToOffset).not.toHaveBeenCalled();
    test.unmount();
  });

  it.each(['stationary growth', 'forward return placement', 'viewport resize'])('does not turn %s into a saved review intent', (kind) => {
    const test = setup('active', 99);
    const sample = (offset: number, height = 2000, window = 400) => ({ nativeEvent: {
      contentOffset: { x: 0, y: offset }, contentSize: { width: 400, height }, layoutMeasurement: { width: 400, height: window },
    } } as never);
    test.viewport.onLayout({ nativeEvent: { layout: { height: 400 } } } as never);
    test.viewport.onContentSizeChange(400, 2000); test.tick();
    test.viewport.onScroll(sample(1600)); test.list.scrollToOffset.mockClear();
    if (kind === 'stationary growth') test.viewport.onScroll(sample(1600, 2400));
    if (kind === 'forward return placement') test.viewport.onScroll(sample(1700, 2400));
    if (kind === 'viewport resize') {
      test.viewport.onLayout({ nativeEvent: { layout: { height: 200 } } } as never);
      test.tick(); test.viewport.onScroll(sample(1500, 2000, 200));
    }
    expect(test.reviewIntent).not.toHaveBeenCalled();
    test.tick();
    expect(test.list.scrollToOffset).toHaveBeenCalledWith(expect.objectContaining({ offset: kind === 'viewport resize' ? 1800 : 2000 }));
    test.viewport.onContentSizeChange(400, 2400); test.tick();
    expect(test.list.scrollToOffset).toHaveBeenLastCalledWith(expect.objectContaining({ offset: kind === 'viewport resize' ? 2200 : 2000 }));
    test.unmount();
  });

  it.each(['tail', 'review', 'touch'] as const)('reasserts only following intent on foreground with no layout event (%s)', (intent) => {
    const test = setup('active', 99);
    test.viewport.onLayout({ nativeEvent: { layout: { height: 400 } } } as never);
    test.viewport.onContentSizeChange(400, 2000); test.tick();
    if (intent === 'review') { test.viewport.reveal(40, true, 'review'); test.tick(); }
    if (intent === 'touch') { test.viewport.onScrollBeginDrag(); test.viewport.onScrollEndDrag({ nativeEvent: { velocity: { y: 0 } } } as never); }
    test.list.scrollToOffset.mockClear();
    test.scene('background'); test.scene('active'); test.tick();
    if (intent === 'tail') expect(test.list.scrollToOffset).toHaveBeenCalledWith(expect.objectContaining({ offset: 1600 }));
    else expect(test.list.scrollToOffset).not.toHaveBeenCalled();
    test.unmount();
  });

  it('does not consume a bottom sample after geometry changes or an unowned gesture end', () => {
    const test = setup();
    const event = { nativeEvent: { contentOffset: { x: 0, y: 1600 }, contentSize: { width: 400, height: 2000 }, layoutMeasurement: { width: 400, height: 400 } } } as never;
    test.viewport.onScroll(event); test.viewport.onScrollEndDrag(event);
    expect(test.userReachedEnd).not.toHaveBeenCalled();
    test.viewport.onScrollBeginDrag(); test.viewport.onScroll(event);
    test.viewport.onContentSizeChange(400, 2200); test.viewport.onScrollEndDrag(event);
    expect(test.userReachedEnd).not.toHaveBeenCalled();
    test.viewport.onScrollBeginDrag(); test.viewport.onScroll(event); test.viewport.onScrollEndDrag(event);
    expect(test.userReachedEnd).toHaveBeenCalledTimes(1);
    test.unmount();
  });

  it('lets an unowned upward scroll cancel a queued stream-tail write when drag-start is omitted', () => {
    const test = setup();
    const sample = (offset: number, height = 2000) => ({ nativeEvent: { contentOffset: { x: 0, y: offset }, contentSize: { width: 400, height }, layoutMeasurement: { width: 400, height: 400 } } } as never);
    test.viewport.onLayout({ nativeEvent: { layout: { height: 400 } } } as never);
    test.viewport.onContentSizeChange(400, 2000); test.tick();
    test.viewport.onScroll(sample(1600));
    test.viewport.onViewableItemsChanged({ viewableItems: [{ index: 99 }], changed: [] } as never);
    test.list.scrollToOffset.mockClear();
    test.viewport.onContentSizeChange(400, 2200); // Tail frame pending.
    test.viewport.onScroll(sample(800, 2200)); // Trackpad; no begin-drag.
    test.tick();
    expect(test.reviewIntent).toHaveBeenCalledWith('one');
    expect(test.list.scrollToOffset).not.toHaveBeenCalled();
    test.unmount();
  });

  it.each([false, true])('keeps following through initial recycler offset refinements with no current range (retained proof %s)', (retainedProof) => {
    const test = setup('active', 419, 420);
    const sample = (offset: number, height: number) => ({ nativeEvent: {
      contentOffset: { x: 0, y: offset }, contentSize: { width: 400, height },
      layoutMeasurement: { width: 400, height: 1069 },
    } } as never);
    test.viewport.onLayout({ nativeEvent: { layout: { height: 1069 } } } as never);
    test.viewport.onContentSizeChange(400, 25202); test.tick();
    if (retainedProof) {
      test.viewport.onViewableItemsChanged({ viewableItems: [{ index: 411 }], changed: [] } as never);
      test.viewport.onViewableItemsChanged({ viewableItems: [], changed: [] } as never);
    }
    // Exact iPad simulator cold-entry order. No touch, drag or visible rows.
    test.viewport.onScroll(sample(24205, 25274));
    test.viewport.onContentSizeChange(400, 25393);
    test.viewport.onScroll(sample(24133, 25311));
    expect(test.reviewIntent).not.toHaveBeenCalled();
    test.list.scrollToOffset.mockClear();
    test.viewport.onContentSizeChange(400, 25400); test.tick();
    expect(test.list.scrollToOffset).toHaveBeenCalled();
    test.unmount();
  });

  it('keeps touch review through a bottom geometry sample until an explicit latest action', () => {
    const test = setup();
    const sample = (offset: number) => ({ nativeEvent: { contentOffset: { x: 0, y: offset }, contentSize: { width: 400, height: 2000 }, layoutMeasurement: { width: 400, height: 400 } } } as never);
    test.viewport.onLayout({ nativeEvent: { layout: { height: 400 } } } as never);
    test.viewport.onContentSizeChange(400, 2000); test.tick();
    test.viewport.onScrollBeginDrag(); test.viewport.onScroll(sample(600));
    // Resize/recycler correction during the gesture reports bottom briefly.
    test.viewport.onScroll(sample(1600)); test.viewport.onScrollEndDrag(sample(1600));
    test.list.scrollToOffset.mockClear();
    test.viewport.onContentSizeChange(400, 2200); test.tick();
    expect(test.list.scrollToOffset).not.toHaveBeenCalled();
    test.viewport.reveal(99, true, 'tail'); test.tick();
    expect(test.list.scrollToOffset).toHaveBeenCalledWith(expect.objectContaining({ offset: 1800 }));
    test.unmount();
  });

  it('cancels pending platform frames as soon as the scene becomes inactive', () => {
    const test = setup(); test.viewport.onContentSizeChange(400, 2_000);
    expect(test.queued.size).toBeGreaterThan(0);
    test.scene('inactive'); expect(test.queued.size).toBe(0);
    test.tick(); expect(test.list.scrollToEnd).not.toHaveBeenCalled();
    test.unmount();
  });

  it('defers indexed reveal while backgrounded and resumes its target once active', () => {
    const test = setup(); test.viewport.reveal(40, true, 'review');
    test.scene('background'); test.tick();
    expect(test.list.scrollToOffset).not.toHaveBeenCalled();
    test.scene('active'); test.tick();
    expect(test.list.scrollToOffset).toHaveBeenCalledOnce();
    test.unmount();
  });

  it('keeps an adjacent k motion on the prior cursor screen row when crossing the scroll band', () => {
    const test = setup('active', 33);
    test.list.getLayout.mockImplementation((index: number) => ({ x: 0, y: index * 20, width: 400, height: 20 }));
    test.viewport.onScroll({ nativeEvent: {
      contentOffset: { x: 0, y: 600 },
      contentSize: { width: 400, height: 2_000 },
      layoutMeasurement: { width: 400, height: 400 },
    } } as never);
    test.viewport.onViewableItemsChanged({
      viewableItems: Array.from({ length: 11 }, (_, offset) => ({ index: 30 + offset })),
      changed: [],
    } as never);

    test.viewport.reveal(32, false, 'review', 33);
    test.tick();

    expect(test.list.scrollToOffset).toHaveBeenCalledExactlyOnceWith({
      offset: 580,
      animated: false,
      skipFirstItemOffset: true,
    });
    test.unmount();
  });

  it.each([
    ['k', 1_000, 36, 700],
    ['j', 200, 34, 320],
  ])('follows a Visual-mode %s cursor past the painted viewport even when recycler viewability is stale', (_key, offset, previous, expectedOffset) => {
    const test = setup('active', 35);
    test.viewport.reveal(35, true, 'review'); test.tick();
    test.list.scrollToOffset.mockClear();
    test.viewport.onScroll({ nativeEvent: {
      contentOffset: { x: 0, y: offset },
      contentSize: { width: 400, height: 2_000 },
      layoutMeasurement: { width: 400, height: 400 },
    } } as never);
    // A preceding native write can move the painted viewport before FlashList
    // publishes a fresh viewability interval. Row 35 is now beyond the screen.
    test.viewport.onViewableItemsChanged({
      viewableItems: Array.from({ length: 11 }, (_, offset) => ({ index: 30 + offset })),
      changed: [],
    } as never);

    test.viewport.reveal(35, false, 'review', previous); test.tick();

    expect(test.list.scrollToOffset).toHaveBeenCalledWith(expect.objectContaining({ offset: expectedOffset }));
    test.unmount();
  });

  it('keeps the block cursor center fixed when adjacent scroll-band rows have different heights', () => {
    const test = setup('active', 33);
    test.list.getLayout.mockImplementation((index: number) => ({
      x: 0,
      y: index * 20,
      width: 400,
      height: index === 32 ? 34 : 20,
    }));
    test.viewport.onScroll({ nativeEvent: {
      contentOffset: { x: 0, y: 600 },
      contentSize: { width: 400, height: 2_000 },
      layoutMeasurement: { width: 400, height: 400 },
    } } as never);
    test.viewport.onViewableItemsChanged({
      viewableItems: Array.from({ length: 11 }, (_, offset) => ({ index: 30 + offset })),
      changed: [],
    } as never);

    test.viewport.reveal(32, false, 'review', 33);
    test.tick();

    // Row 33's center is y=70 in the viewport. Row 32 is 14 points taller,
    // so preserving only its normalized top position displaces the cursor.
    expect(test.list.scrollToOffset).toHaveBeenCalledExactlyOnceWith({
      offset: 587,
      animated: false,
      skipFirstItemOffset: true,
    });
    test.unmount();
  });

  it('does not schedule platform work on a cold inactive mount or late layout callback', () => {
    const test = setup('background'); test.viewport.onContentSizeChange(400, 2_000);
    expect(test.queued.size).toBe(0);
    test.scene('active'); test.viewport.onLayout({ nativeEvent: { layout: { height: 400 } } } as never); test.tick();
    expect(test.list.scrollToOffset).toHaveBeenCalledExactlyOnceWith({
      offset: 1_600, animated: false, skipFirstItemOffset: true,
    });
    expect(test.list.scrollToEnd).not.toHaveBeenCalled();
    test.unmount();
  });

  it('cannot schedule another frame from a stale native callback after unmount', () => {
    const test = setup(); test.unmount();
    test.viewport.onContentSizeChange(400, 2_000);
    expect(test.queued.size).toBe(0);
    expect(hooks.listeners.size).toBe(0);
  });

  it('does not let a canceled native frame execute after a quick background/foreground round-trip', () => {
    const test = setup(); test.viewport.onLayout({ nativeEvent: { layout: { height: 400 } } } as never); test.tick();
    test.viewport.onContentSizeChange(400, 2_000);
    const stale = [...test.queued.values()];
    test.scene('inactive'); test.scene('active'); stale.forEach(callback => callback(0));
    expect(test.list.scrollToEnd).not.toHaveBeenCalled();
    test.tick(); expect(test.list.scrollToOffset).toHaveBeenCalledOnce();
    test.unmount();
  });

  it('still coalesces ordinary active tail placement and clears all frames on unmount', () => {
    const test = setup(); test.viewport.onLayout({ nativeEvent: { layout: { height: 400 } } } as never); test.tick();
    test.viewport.onContentSizeChange(400, 2_000);
    test.viewport.onContentSizeChange(400, 2_010); test.tick();
    expect(test.list.scrollToOffset).toHaveBeenCalledExactlyOnceWith({
      offset: 1_610, animated: false, skipFirstItemOffset: true,
    });
    expect(test.list.scrollToEnd).not.toHaveBeenCalled();
    test.unmount(); expect(test.queued.size).toBe(0);
  });

  it('uses the exact post-OTA tail geometry without starting FlashList final-row admission', () => {
    const test = setup('active', 416);
    test.viewport.onScroll({ nativeEvent: {
      contentOffset: { x: 0, y: 16_980 },
      contentSize: { width: 400, height: 17_964 },
      layoutMeasurement: { width: 400, height: 959 },
    } } as never);
    test.viewport.onViewableItemsChanged({
      viewableItems: Array.from({ length: 37 }, (_, index) => ({ index: 378 + index })),
      changed: [],
    } as never);
    test.viewport.onContentSizeChange(400, 18_004);
    test.tick();

    expect(test.list.scrollToOffset).toHaveBeenCalledExactlyOnceWith({
      offset: 17_045, animated: false, skipFirstItemOffset: true,
    });
    expect(test.list.scrollToEnd).not.toHaveBeenCalled();
    test.unmount();
  });

  it('bounds stale middle-range recovery to one recycler admission of the actual tail', () => {
    const test = setup('active', 155, 156);
    test.viewport.onScroll({ nativeEvent: {
      contentOffset: { x: 0, y: 3_520 },
      contentSize: { width: 400, height: 5_121 },
      layoutMeasurement: { width: 400, height: 642 },
    } } as never);
    test.viewport.onViewableItemsChanged({
      viewableItems: Array.from({ length: 12 }, (_, index) => ({ index: 108 + index })),
      changed: [],
    } as never);
    test.tick(); test.tick(); test.tick();

    expect(test.list.scrollToIndex).toHaveBeenCalledExactlyOnceWith({
      index: 155, animated: false, viewPosition: 1,
    });
    test.viewport.onViewableItemsChanged({
      viewableItems: Array.from({ length: 16 }, (_, index) => ({ index: 140 + index })),
      changed: [],
    } as never);
    test.tick(); test.tick(); test.tick();
    expect(test.list.scrollToIndex).toHaveBeenCalledOnce();
    test.unmount();
  });

  it('keeps suspended navigation coalesced and resumes only its latest target, not a stale tail', () => {
    const test = setup(); test.scene('background');
    for (let index = 0; index < 200; index += 1) {
      test.viewport.onContentSizeChange(400, 2_000 + index);
      test.viewport.reveal(index % 100, true, 'review');
    }
    expect(test.queued.size).toBe(0);
    test.scene('active'); expect(test.queued.size).toBeLessThanOrEqual(3);
    test.tick();
    expect(test.list.getLayout).toHaveBeenCalledExactlyOnceWith(99);
    expect(test.list.scrollToOffset).toHaveBeenCalledOnce();
    expect(test.list.scrollToEnd).not.toHaveBeenCalled();
    test.unmount();
  });

  it('retains the exact pending review restore through suspension between its two frames', () => {
    const test = setup(); test.viewport.revealAfterRevision(40, 0.22); test.tick();
    test.scene('inactive'); expect(test.queued.size).toBe(0);
    test.scene('active'); test.tick(); test.tick();
    expect(test.list.getLayout).toHaveBeenCalledWith(40);
    expect(test.list.scrollToOffset).toHaveBeenCalledOnce();
    expect(test.list.scrollToEnd).not.toHaveBeenCalled();
    test.unmount();
  });

  it('retains a delivered review restore through an empty recycler viewability sample', () => {
    let now = 1_000;
    vi.stubGlobal('performance', { now: () => now });
    const test = setup('active', 40);
    const sample = (offset: number) => ({ nativeEvent: {
      contentOffset: { x: 0, y: offset }, contentSize: { width: 400, height: 2_000 },
      layoutMeasurement: { width: 400, height: 400 },
    } } as never);
    const visible = () => test.viewport.onViewableItemsChanged({
      viewableItems: Array.from({ length: 11 }, (_, offset) => ({ index: 35 + offset })), changed: [],
    } as never);
    test.viewport.revealAfterRevision(40, 0.22);
    test.tick(); test.tick(); test.tick();
    test.viewport.onScroll(sample(716.4)); visible();
    test.list.scrollToOffset.mockClear();
    // Captured iPad sequence: a native refinement moves the offset, then the
    // recycler momentarily withdraws all visible tokens without a begin-drag.
    // Absence of a range is not a measured range excluding the reader's row.
    test.viewport.onScroll(sample(680));
    test.viewport.onViewableItemsChanged({ viewableItems: [], changed: [] } as never);
    expect(test.reviewIntent).not.toHaveBeenCalled();
    now = 2_000; visible();
    test.tick(); test.tick(); test.tick();
    expect(test.list.scrollToOffset).toHaveBeenCalledWith({ offset: 716.4, animated: false, skipFirstItemOffset: true });
    expect(test.reviewIntent).not.toHaveBeenCalled();
    test.unmount();
  });

  it('lets an idle reader move retire a delivered review restore when iOS omits begin-drag', () => {
    let now = 1_000;
    vi.stubGlobal('performance', { now: () => now });
    const test = setup('active', 40);

    // Returning to a reviewed thread owns one exact restore. The native
    // acknowledgement is delivered, but its bounded verifier is still armed
    // while FlashList settles measured geometry.
    test.viewport.revealAfterRevision(40, 0.22);
    test.tick(); test.tick(); test.tick();
    expect(test.list.scrollToOffset).toHaveBeenCalledOnce();
    test.list.scrollToOffset.mockClear();
    test.viewport.onScroll({ nativeEvent: {
      contentOffset: { x: 0, y: 712 },
      contentSize: { width: 400, height: 2_000 },
      layoutMeasurement: { width: 400, height: 400 },
    } } as never);
    test.viewport.onViewableItemsChanged({
      viewableItems: Array.from({ length: 11 }, (_, offset) => ({ index: 35 + offset })),
      changed: [],
    } as never);

    // UIKit can omit onScrollBeginDrag for the next reader gesture. This
    // native move is far from the delivered restore and the restored target is
    // no longer visible. It must revoke the verifier instead of snapping back
    // after the transcript has otherwise become idle.
    now = 2_000;
    expect(test.reviewIntent).not.toHaveBeenCalled();
    test.viewport.onScroll({ nativeEvent: {
      contentOffset: { x: 0, y: 300 },
      contentSize: { width: 400, height: 2_000 },
      layoutMeasurement: { width: 400, height: 400 },
    } } as never);
    test.viewport.onViewableItemsChanged({
      viewableItems: Array.from({ length: 21 }, (_, offset) => ({ index: 15 + offset })),
      changed: [],
    } as never);
    test.tick(); test.tick(); test.tick();

    expect(test.reviewIntent).toHaveBeenCalledExactlyOnceWith('one');
    expect(test.list.scrollToOffset).not.toHaveBeenCalled();
    expect(test.list.scrollToIndex).not.toHaveBeenCalled();
    test.unmount();
  });

  it('still honors cancellation from a newer drag while suspended', () => {
    const test = setup(); test.viewport.reveal(40, true, 'review'); test.scene('inactive');
    test.viewport.onScrollBeginDrag(); test.scene('active'); test.tick();
    expect(test.list.scrollToOffset).not.toHaveBeenCalled();
    expect(test.list.scrollToEnd).not.toHaveBeenCalled();
    test.unmount();
  });

  it('does not turn a transient empty viewability report after touch review into a cursor snap', () => {
    const test = setup('active', 40);
    test.viewport.onScroll({ nativeEvent: {
      contentOffset: { x: 0, y: 600 },
      contentSize: { width: 400, height: 2_000 },
      layoutMeasurement: { width: 400, height: 400 },
    } } as never);
    test.viewport.onViewableItemsChanged({
      viewableItems: Array.from({ length: 11 }, (_, offset) => ({ index: 30 + offset })),
      changed: [],
    } as never);

    test.viewport.onScrollBeginDrag();
    test.viewport.onScroll({ nativeEvent: {
      contentOffset: { x: 0, y: 300 },
      contentSize: { width: 400, height: 2_000 },
      layoutMeasurement: { width: 400, height: 400 },
    } } as never);
    test.viewport.onViewableItemsChanged({ viewableItems: [], changed: [] } as never);
    test.viewport.onScrollEndDrag({ nativeEvent: { velocity: { y: 0 } } } as never);
    test.tick(); test.tick(); test.tick();

    expect(test.list.scrollToOffset).not.toHaveBeenCalled();
    expect(test.list.scrollToIndex).not.toHaveBeenCalled();
    test.unmount();
  });

  it('does not let a missing tail acknowledgement mask the first later idle-review scroll', () => {
    const test = setup('active', 40);
    test.viewport.onLayout({ nativeEvent: { layout: { height: 400 } } } as never);
    test.viewport.onContentSizeChange(400, 2_000);
    test.tick();
    test.viewport.onViewableItemsChanged({
      viewableItems: Array.from({ length: 20 }, (_, offset) => ({ index: 80 + offset })),
      changed: [],
    } as never);
    test.list.scrollToOffset.mockClear();

    // No native callback acknowledges the requested 1,600 tail offset. The
    // next callback is the reader reviewing the middle of a static transcript,
    // not a wildly inaccurate acknowledgement of that old writer.
    test.viewport.onScroll({ nativeEvent: {
      contentOffset: { x: 0, y: 600 },
      contentSize: { width: 400, height: 2_000 },
      layoutMeasurement: { width: 400, height: 400 },
    } } as never);
    test.viewport.onViewableItemsChanged({
      viewableItems: Array.from({ length: 11 }, (_, offset) => ({ index: 30 + offset })),
      changed: [],
    } as never);
    test.tick(); test.tick(); test.tick();

    expect(test.list.scrollToOffset).not.toHaveBeenCalled();
    expect(test.list.scrollToIndex).not.toHaveBeenCalled();
    test.unmount();
  });

  it('does not let a late empty callback withdraw mounted-cell proof for the same static generation', () => {
    const test = setup('active', 40);
    test.viewport.onLayout({ nativeEvent: { layout: { height: 400 } } } as never);
    test.viewport.onContentSizeChange(400, 2_000);
    test.tick();
    test.viewport.onScroll({ nativeEvent: {
      contentOffset: { x: 0, y: 1_600 },
      contentSize: { width: 400, height: 2_000 },
      layoutMeasurement: { width: 400, height: 400 },
    } } as never);
    test.viewport.onViewableItemsChanged({
      viewableItems: Array.from({ length: 20 }, (_, offset) => ({ index: 80 + offset })),
      changed: [],
    } as never);
    test.list.scrollToOffset.mockClear();

    test.viewport.onScrollBeginDrag();
    test.viewport.onScroll({ nativeEvent: {
      contentOffset: { x: 0, y: 600 },
      contentSize: { width: 400, height: 2_000 },
      layoutMeasurement: { width: 400, height: 400 },
    } } as never);
    test.viewport.onViewableItemsChanged({
      viewableItems: Array.from({ length: 11 }, (_, offset) => ({ index: 30 + offset })),
      changed: [],
    } as never);
    test.viewport.onScrollEndDrag({ nativeEvent: { velocity: { y: 0 } } } as never);
    test.tick();

    // FlashList can publish an empty viewability callback after UIKit has
    // already ended the gesture. No content or viewport generation changed,
    // so the preceding mounted-cell proof still owns this static window.
    test.viewport.onViewableItemsChanged({ viewableItems: [], changed: [] } as never);
    test.tick(); test.tick(); test.tick();

    expect(test.list.scrollToOffset).not.toHaveBeenCalled();
    expect(test.list.scrollToIndex).not.toHaveBeenCalled();
    test.unmount();
  });

  it('treats an unowned native scroll away from a settled tail as review intent', () => {
    const test = setup('active', 99);
    test.viewport.onLayout({ nativeEvent: { layout: { height: 400 } } } as never);
    test.viewport.onContentSizeChange(400, 2_000);
    test.tick();
    test.list.scrollToOffset.mockClear();
    test.viewport.onScroll({ nativeEvent: {
      // Native tail placement can settle a few points away from the requested
      // offset. That first callback still belongs to the writer, but it must
      // not leave writer ownership armed for the next real gesture.
      contentOffset: { x: 0, y: 1_590 },
      contentSize: { width: 400, height: 2_000 },
      layoutMeasurement: { width: 400, height: 400 },
    } } as never);
    test.viewport.onViewableItemsChanged({
      viewableItems: Array.from({ length: 20 }, (_, offset) => ({ index: 80 + offset })),
      changed: [],
    } as never);

    // iPad occasionally omits begin-drag while still delivering the native
    // offset/viewability sequence. The moved viewport must own review even
    // without that optional callback.
    expect(test.reviewIntent).not.toHaveBeenCalled();
    test.viewport.onScroll({ nativeEvent: {
      contentOffset: { x: 0, y: 600 },
      contentSize: { width: 400, height: 2_000 },
      layoutMeasurement: { width: 400, height: 400 },
    } } as never);
    test.viewport.onViewableItemsChanged({
      viewableItems: Array.from({ length: 11 }, (_, offset) => ({ index: 30 + offset })),
      changed: [],
    } as never);
    test.tick(); test.tick(); test.tick();

    expect(test.reviewIntent).toHaveBeenCalledExactlyOnceWith('one');
    expect(test.list.scrollToOffset).not.toHaveBeenCalled();
    expect(test.list.scrollToIndex).not.toHaveBeenCalled();
    test.unmount();
  });

  it('supports React effect replay without reviving a disposed platform callback', () => {
    const test = setup(); test.viewport.onLayout({ nativeEvent: { layout: { height: 400 } } } as never); test.tick();
    test.viewport.onContentSizeChange(400, 2_000);
    const stale = [...test.queued.values()]; test.replayEffects();
    stale.forEach(callback => callback(0));
    expect(test.list.scrollToEnd).not.toHaveBeenCalled();
    test.viewport.onContentSizeChange(400, 2_000); test.tick();
    expect(test.list.scrollToOffset).toHaveBeenCalledOnce();
    expect(test.list.scrollToEnd).not.toHaveBeenCalled();
    expect(hooks.listeners.size).toBe(1);
    test.unmount(); expect(hooks.listeners.size).toBe(0);
  });
});

it('keeps the measured reading position when blank-viewability recovery follows a prepend', () => {
  const test = setup('active', 80, 200);
  test.viewport.onLayout({ nativeEvent: { layout: { height: 400 } } } as never);
  test.viewport.onContentSizeChange(400, 4000);
  test.viewport.reveal(80, true, 'review');
  test.viewport.onScrollBeginDrag(); // cancel the unissued navigation request
  test.list.getAbsoluteLastScrollOffset = () => 1572;
  test.viewport.onScrollEndDrag({ nativeEvent: { velocity: { y: 0 } } } as never);
  test.viewport.onViewableItemsChanged({ viewableItems: [], changed: [] } as never);
  for (let frame = 0; frame < 6; frame++) test.tick();
  // Native anchoring already leaves row80 at y28. Empty viewability is not
  // permission for the fallback to recenter that same row at 45% (offset1429).
  expect(test.list.scrollToOffset).toHaveBeenCalledExactlyOnceWith({
    offset: 1572, animated: false, skipFirstItemOffset: true,
  });
  expect(test.list.scrollToIndex).not.toHaveBeenCalled();
  test.unmount();
});

it.each(['before tail frame', 'after tail frame'])('keeps the resized tail authoritative over an old-window scroll sample %s', (order) => {
  const test = setup('active', 99);
  const layout = (height: number) => test.viewport.onLayout({ nativeEvent: { layout: { height } } } as never);
  const scroll = (offset: number, height: number) => test.viewport.onScroll({ nativeEvent: {
    contentOffset: { x: 0, y: offset }, contentSize: { width: 400, height: 2000 }, layoutMeasurement: { width: 400, height },
  } } as never);
  layout(400); test.viewport.onContentSizeChange(400, 2000); test.tick(); scroll(1600, 400);
  test.list.scrollToOffset.mockClear();
  layout(200);
  if (order === 'after tail frame') { test.tick(); scroll(1800, 200); }
  // An in-flight scroll publication still describes the keyboard-hidden window.
  scroll(1600, 400); test.tick();
  expect(test.list.scrollToOffset).toHaveBeenLastCalledWith(expect.objectContaining({ offset: 1800 }));
  expect(test.reviewIntent).not.toHaveBeenCalled();
  test.viewport.onContentSizeChange(400, 2200); test.tick();
  expect(test.list.scrollToOffset).toHaveBeenLastCalledWith(expect.objectContaining({ offset: 2000 }));
  layout(400); scroll(1800, 200); test.tick();
  expect(test.list.scrollToOffset).toHaveBeenLastCalledWith(expect.objectContaining({ offset: 1800 }));
  test.unmount();
});

it('does not reclaim deliberate review on resize or a delayed old-window scroll sample', () => {
  const test = setup();
  test.viewport.onLayout({ nativeEvent: { layout: { height: 400 } } } as never);
  test.viewport.onContentSizeChange(400, 2000); test.tick();
  test.viewport.onScrollBeginDrag();
  test.viewport.onScroll({ nativeEvent: { contentOffset: { x: 0, y: 600 }, contentSize: { width: 400, height: 2000 }, layoutMeasurement: { width: 400, height: 400 } } } as never);
  test.viewport.onScrollEndDrag({ nativeEvent: { velocity: { y: 0 } } } as never);
  test.list.scrollToOffset.mockClear();
  test.viewport.onLayout({ nativeEvent: { layout: { height: 200 } } } as never);
  test.viewport.onScroll({ nativeEvent: { contentOffset: { x: 0, y: 600 }, contentSize: { width: 400, height: 2000 }, layoutMeasurement: { width: 400, height: 400 } } } as never);
  test.viewport.onContentSizeChange(400, 2200); test.tick();
  expect(test.list.scrollToOffset).not.toHaveBeenCalled();
  test.unmount();
});
