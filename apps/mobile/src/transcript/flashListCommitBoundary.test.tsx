// @vitest-environment jsdom
// Commit-boundary regression for the canonical FlashList 2.3.2 patch, through
// the installed library with only the native host substituted. It is not a
// Fabric execution, native receipt or physical proof. Negative controls run
// with scripts/fixtures/flashListCommitBoundary.vitest.mjs.
import React, { act, startTransition, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

type HostProps = { children?: React.ReactNode; index?: number;
  onLayout?: (event: { nativeEvent: { layout: { x: number; y: number; width: number; height: number } } }) => void;
  onScroll?: (event: { nativeEvent: Record<string, { x?: number; y?: number; width?: number; height?: number }> }) => void };
type NativeCell = { currentProps: HostProps; committedProps: HostProps; mounted: boolean; measuredHeight: number };
const { nativeCells } = vi.hoisted(() => ({ nativeCells: new Set<NativeCell>() }));
const sizeEvent = (height = 20) => ({ nativeEvent: { layout: { x: 0, y: 0, width: 400, height } } });

// This host models Fabric's shared canonical.currentProps publication during
// completeWork, before commit. The registry retains accepted native targets.
// Native-target dispatch reads CURRENT props. Separate retained-callback
// controls below are explicitly not native-delivery proofs.
// It is a renderer-ordering model, not execution of Fabric or native acceptance.
// Only the native host is substituted. RecyclerView, ViewHolderCollection,
// ViewHolder, manager, layout manager, render stack and hooks are installed code.
vi.mock('react-native', async () => {
  const React = await import('react');
  const Host = React.forwardRef(function Host(
    props: HostProps, ref,
  ) {
    const { children, index } = props;
    const [cell] = React.useState<NativeCell>(() => ({ currentProps: props, committedProps: props, mounted: false, measuredHeight: index === undefined ? 200 : 20 }));
    cell.currentProps = props;
    React.useLayoutEffect(() => {
      cell.committedProps = props;
      cell.mounted = true;
      nativeCells.add(cell);
      return () => { cell.mounted = false; nativeCells.delete(cell); };
    });
    React.useImperativeHandle(ref, () => ({
      measureLayout: (_relative: unknown, receive: (...values: number[]) => void) =>
        receive(0, 0, 400, cell.measuredHeight),
      scrollTo: () => undefined,
      getNativeScrollRef: () => null,
    }), []);
    return <div data-native-index={index}>{children}</div>;
  });
  return {
    View: Host, ScrollView: Host, RefreshControl: Host,
    I18nManager: { isRTL: false },
    PixelRatio: { getPixelSizeForLayoutSize: (value: number) => value,
      roundToNearestPixel: (value: number) => value },
    Animated: { View: Host, ScrollView: Host, Value: class {},
      createAnimatedComponent: (component: unknown) => component },
  };
});

import { RecyclerView } from '../../node_modules/@shopify/flash-list/dist/recyclerview/RecyclerView';
import { RecyclerViewManager } from '../../node_modules/@shopify/flash-list/dist/recyclerview/RecyclerViewManager';
import type { FlashListRef } from '@shopify/flash-list';

type Row = { id: string };
const original = Array.from({ length: 100 }, (_, index) => ({ id: `old-${index}` }));
const replacement = [{ id: 'new-0' }, { id: 'new-1' }];
const pending = new Promise<never>(() => {});
let gate: { promise: Promise<unknown>; open: boolean; release: () => void };
function openableGate() {
  let release!: () => void;
  const promise = new Promise<void>(resolve => { release = resolve; });
  gate = { promise, open: false, release: () => { gate.open = true; release(); } };
  return gate;
}
const scrollEvent = (y: number) => ({ nativeEvent: { contentOffset: { x: 0, y },
  contentSize: { width: 400, height: 2000 }, layoutMeasurement: { width: 400, height: 200 } } });
const keyExtractor = (row: Row) => row.id;
const renderItem = ({ item, index }: { item: Row; index: number }) =>
  <span data-row-id={item?.id ?? 'MISSING'} data-row-index={index}>{item?.id ?? 'MISSING'}</span>;
let root: ReturnType<typeof createRoot>;
let container: HTMLDivElement;
let manager: RecyclerViewManager<Row>;
let list: React.RefObject<FlashListRef<Row> | null>;
let renderedReplacement: boolean;
let commits: number;

function Block({ blocked }: { blocked: boolean }) {
  if (blocked && !gate.open) { renderedReplacement = true; throw gate.promise; }
  return null;
}
function Scene({ data = original, blocked = false, extraData }: { data?: Row[]; blocked?: boolean; extraData?: number }) {
  return <Suspense fallback={<span>pending</span>}>
    <RecyclerView data={data} ref={list} keyExtractor={keyExtractor} renderItem={renderItem} extraData={extraData}
      maintainVisibleContentPosition={{ disabled: true }} onCommitLayoutEffect={() => commits++} />
    <Interleave />
    <CommitFrame />
    <Block blocked={blocked} />
  </Suspense>;
}
// Runs once after the list subtree rendered and before that render commits,
// like native work handled between concurrent render slices.
let interleave: (() => void) | null = null;
function Interleave() {
  const run = interleave;
  interleave = null;
  run?.();
  return null;
}
// Records the rows present in every committed DOM frame of the list subtree.
let frames: string[][] = [];
function CommitFrame() {
  React.useLayoutEffect(() => {
    frames.push(Array.from(container.querySelectorAll('[data-row-id]'), node => node.getAttribute('data-row-id')!));
  });
  return null;
}
// App-shaped owner. Data is published in a transition while focus/cursor style
// updates (here extraData) remain urgent, as in the transcript pane.
const live = { setData: (_data: Row[]) => undefined as void, setExtra: (_extra: number) => undefined as void };
function LiveScene() {
  const [data, setData] = React.useState(original);
  const [extra, setExtra] = React.useState(0);
  live.setData = setData; live.setExtra = setExtra;
  return <Scene data={data} extraData={extra} blocked={data !== original} />;
}

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) =>
    setTimeout(() => callback(performance.now()), 0));
  vi.stubGlobal('cancelAnimationFrame', clearTimeout);
  container = document.createElement('div');
  root = createRoot(container);
  list = React.createRef<FlashListRef<Row>>();
  renderedReplacement = false;
  commits = 0;
  frames = [];
  interleave = null;
  gate = { promise: pending, open: false, release: () => undefined };
  nativeCells.clear();
  const originalUpdate = RecyclerViewManager.prototype.updateLayoutParams;
  vi.spyOn(RecyclerViewManager.prototype, 'updateLayoutParams').mockImplementation(function (this: RecyclerViewManager<Row>, ...args) {
    manager = this;
    return originalUpdate.apply(this, args);
  });
});
afterEach(async () => {
  await act(async () => root.unmount());
  vi.restoreAllMocks(); vi.unstubAllGlobals();
});

async function mountAtRow70(element: React.ReactElement = <Scene />) {
  await act(async () => {
    root.render(element);
    await new Promise(resolve => setTimeout(resolve, 10));
  });
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)); });
  await act(async () => list.current!.scrollToOffset({ offset: 1400, animated: false }));
  expect(manager.getIsFirstLayoutComplete()).toBe(true);
  expect(manager.getDataLength()).toBe(100);
  expect(manager.getDataKey(70)).toBe('old-70');
  expect(manager.getLayout(70).y).toBe(1400);
  expect(container.querySelector('[data-row-id="old-70"]')).not.toBeNull();
}

it('preserves committed data, keys, layouts and mounted cells while a replacement suspends', async () => {
  await mountAtRow70();
  const layout70 = { ...manager.getLayout(70) };
  const stack = Array.from(manager.getRenderStack(), ([key, value]) => [key, { ...value }]);
  const painted = container.innerHTML;
  const committed = commits;
  await act(async () => startTransition(() => root.render(<Scene data={replacement} blocked />)));
  expect(renderedReplacement).toBe(true); // The speculative list render actually ran.
  expect(commits).toBe(committed);
  expect(container.innerHTML).toBe(painted);
  expect.soft(manager.props.data === original).toBe(true);
  expect.soft(manager.getDataLength()).toBe(100);
  expect.soft(manager.props.data?.[70]?.id).toBe('old-70');
  expect.soft(manager.tryGetLayout(70)).toEqual(layout70);
  expect.soft(Array.from(manager.getRenderStack(), ([key, value]) => [key, { ...value }]))
    .toEqual(stack);
  // Abort the suspended tree. A later normal commit must still show the old row.
  await act(async () => root.render(<Scene />));
  expect(manager.props.data).toBe(original);
  expect(container.querySelector('[data-row-id="old-70"]')).not.toBeNull();
});

it('accepts a 100-to-2 replacement through the real component without a stale-ref layout crash', async () => {
  await mountAtRow70();
  await act(async () => root.render(<Scene data={replacement} />));
  expect(manager.props.data).toBe(replacement);
  expect(manager.getDataLength()).toBe(2);
  expect(manager.tryGetLayout(2)).toBeUndefined();
  expect(container.querySelector('[data-row-id="MISSING"]')).toBeNull();
  expect(container.querySelector('[data-row-id="new-0"]')).not.toBeNull();
  expect(container.querySelector('[data-row-id="new-1"]')).not.toBeNull();
});

it('ignores a late retired-cell measurement after an accepted shrink already truncated layouts', async () => {
  await mountAtRow70();
  await act(async () => root.render(<Scene data={replacement} />));
  // Preserve the two-call ordering. Combining truncation and the stale input in
  // one modifyChildrenLayout call exercises the library's existing guard instead.
  expect(manager.tryGetLayout(70)).toBeUndefined();
  expect(() => manager.modifyChildrenLayout([
    { index: 70, dimensions: { width: 400, height: 20 } },
  ], 2)).not.toThrow();
  expect(manager.tryGetLayout(70)).toBeUndefined();
  await act(async () => root.render(<Scene data={replacement} />));
  expect(manager.getDataLength()).toBe(2);
  expect(container.querySelector('[data-row-id="new-1"]')).not.toBeNull();
});

function acceptedCell(index: number) {
  const cell = Array.from(nativeCells).find(cell => cell.mounted && cell.committedProps.index === index);
  expect(cell, `accepted native target for row ${index}`).toBeDefined();
  return cell!;
}

it('keeps a still-visible native target measurable while its replacement suspends', async () => {
  await mountAtRow70();
  const cell = acceptedCell(70);
  const painted = container.innerHTML;
  await act(async () => startTransition(() => root.render(<Scene data={replacement} blocked />)));
  expect(renderedReplacement).toBe(true);
  expect(cell.mounted).toBe(true);
  expect(cell.committedProps.index).toBe(70);
  expect(container.innerHTML).toBe(painted);
  cell.measuredHeight = 25; // The visible native cell really changed size.
  // A native event on an accepted target resolves through latest currentProps.
  // This is not a direct call to the callback saved before the transition.
  await act(async () => {
    expect(() => cell.currentProps.onLayout?.(sizeEvent(25))).not.toThrow();
  });
  expect(container.querySelector('[data-row-id="old-70"]')).not.toBeNull();
  expect(manager.getDataKey(70)).toBe('old-70');
  expect(manager.getLayout(70).height).toBe(25);
});

it('does not route an accepted old target event into a speculative recycled index', async () => {
  await mountAtRow70();
  // Key 0 is assigned to old-52 after scrolling and recycled for new-0.
  // Discover the assignment instead of depending on that allocation detail.
  const cell = Array.from(nativeCells).find(cell => cell.mounted && cell.committedProps.index !== undefined)!;
  const acceptedIndex = cell.committedProps.index!;
  await act(async () => startTransition(() => root.render(<Scene data={replacement} blocked />)));
  expect(renderedReplacement).toBe(true);
  expect(cell.committedProps.index).toBe(acceptedIndex);
  const read = vi.spyOn(manager, 'getLayout');
  cell.measuredHeight = 27;
  await act(async () => {
    expect(() => cell.currentProps.onLayout?.(sizeEvent(27))).not.toThrow();
    // Inspect the synchronous event read before React can run subsequent renders.
    expect(read.mock.calls[0]?.[0]).toBe(acceptedIndex);
  });
});

it('does not admit a callback retained from a retired row after accepted shrink', async () => {
  await mountAtRow70();
  const cell = acceptedCell(70);
  const retiredCallback = cell.currentProps.onLayout!;
  await act(async () => root.render(<Scene data={replacement} />));
  expect(cell.mounted).toBe(false);
  expect(manager.tryGetLayout(70)).toBeUndefined();
  await act(async () => { expect(() => retiredCallback(sizeEvent(30))).not.toThrow(); });
  expect(manager.getDataLength()).toBe(2);
  expect(manager.tryGetLayout(70)).toBeUndefined();
});

it('does not read disposed manager layouts through retained cell callbacks', async () => {
  await mountAtRow70();
  const retiredCallback = acceptedCell(70).currentProps.onLayout!;
  await act(async () => root.render(null));
  expect(manager.isDisposed).toBe(true);
  const read = vi.spyOn(manager, 'getLayout');
  await act(async () => retiredCallback(sizeEvent(32)));
  expect(read).not.toHaveBeenCalled();
});

it('accepts a prepend with coherent data, recycled keys, layouts and cells', async () => {
  await mountAtRow70();
  const prepended = [{ id: 'before-0' }, { id: 'before-1' }, { id: 'before-2' }, ...original];
  await act(async () => root.render(<Scene data={prepended} />));
  expect(manager.props.data).toBe(prepended);
  expect(manager.getDataLength()).toBe(103);
  expect(manager.getDataKey(73)).toBe('old-70');
  expect(manager.getLayout(73).y).toBe(1460);
  expect(container.querySelector('[data-row-id="old-70"]')?.getAttribute('data-row-index')).toBe('73');
  expect(container.querySelector('[data-row-id="MISSING"]')).toBeNull();
});

it('remeasures the current cell after an old native size arrives following ABA reuse', async () => {
  await mountAtRow70();
  const cell = acceptedCell(52);
  const originalHost = container.querySelector('[data-native-index="52"]');
  await act(async () => root.render(<Scene data={replacement} />));
  expect(acceptedCell(0)).toBe(cell);
  await act(async () => root.render(<Scene />));
  expect(acceptedCell(52)).toBe(cell);
  expect(container.querySelector('[data-native-index="52"]')).toBe(originalHost);
  // Latest-listener delivery may invalidate layout. It must not install the
  // obsolete event dimensions as the current cell's measured dimensions.
  await act(async () => cell.currentProps.onLayout!(sizeEvent(40)));
  expect(manager.getDataKey(52)).toBe('old-52');
  expect(manager.getLayout(52).height).toBe(20);
  expect(container.querySelector('[data-row-id="old-52"]')).not.toBeNull();
  await act(async () => cell.currentProps.onLayout!(sizeEvent(20)));
  expect(manager.getLayout(52).height).toBe(20);
  expect(container.querySelector('[data-row-id="MISSING"]')).toBeNull();
});

function scrollHost() {
  const cell = Array.from(nativeCells).find(cell => cell.mounted && typeof cell.committedProps.onScroll === 'function');
  expect(cell, 'accepted native scroll target').toBeDefined();
  return cell!;
}

it('renders committed rows when urgent work lands on the old tree while a replacement suspends', async () => {
  await mountAtRow70(<LiveScene />);
  await act(async () => startTransition(() => live.setData(replacement)));
  expect(renderedReplacement).toBe(true);
  frames = [];
  await act(async () => live.setExtra(1)); // An urgent same-data list render.
  expect(frames.length).toBeGreaterThan(0);
  expect.soft(frames.filter(frame => !frame.includes('old-70')), 'committed frames without visible old-70').toEqual([]);
  expect.soft(manager.props.data).toBe(original);
  expect.soft(manager.getDataLength()).toBe(100);
  expect.soft(manager.getDataKey(70)).toBe('old-70');
  expect.soft(container.querySelector('[data-row-id="old-70"]')?.getAttribute('data-row-index')).toBe('70');
  // The native scroll target dispatches through current props, like Fabric.
  await act(async () => scrollHost().currentProps.onScroll!(scrollEvent(1300)));
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)); });
  expect.soft(container.querySelector('[data-row-id="old-65"]')?.getAttribute('data-row-index')).toBe('65');
  expect(container.querySelector('[data-row-id="MISSING"]')).toBeNull();
});

it('keeps an old-tree scroll made during suspension when that replacement is accepted', async () => {
  await mountAtRow70(<LiveScene />);
  const grown = [...original, ...Array.from({ length: 20 }, (_, index) => ({ id: `new-${index}` }))];
  const opened = openableGate();
  await act(async () => startTransition(() => live.setData(grown)));
  expect(renderedReplacement).toBe(true);
  await act(async () => scrollHost().currentProps.onScroll!(scrollEvent(600)));
  expect(manager.getAbsoluteLastScrollOffset()).toBe(600);
  await act(async () => { opened.release(); await opened.promise; });
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)); });
  expect(manager.props.data).toBe(grown);
  expect(manager.getDataLength()).toBe(120);
  // A projection forked before the scroll must not reinstate offset 1400.
  expect(manager.getAbsoluteLastScrollOffset()).toBe(600);
  expect(container.querySelector('[data-row-id="old-30"]')?.getAttribute('data-row-index')).toBe('30');
  expect(container.querySelector('[data-row-id="MISSING"]')).toBeNull();
});

it('replays accepted scroll admitted between a projection render and its commit', async () => {
  await mountAtRow70(<LiveScene />);
  gate.open = true; // This revision renders and commits without suspending.
  const grown = [...original, ...Array.from({ length: 20 }, (_, index) => ({ id: `new-${index}` }))];
  // An accepted scroll without a React update yet, e.g. a native scroll whose
  // render request is still queued when the pending projection commits.
  interleave = () => manager.updateScrollOffset(600);
  await act(async () => startTransition(() => live.setData(grown)));
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)); });
  expect(interleave).toBeNull();
  expect(manager.props.data).toBe(grown);
  expect(manager.getAbsoluteLastScrollOffset()).toBe(600);
  expect(container.querySelector('[data-row-id="old-30"]')?.getAttribute('data-row-index')).toBe('30');
  expect(container.querySelector('[data-row-id="MISSING"]')).toBeNull();
});
