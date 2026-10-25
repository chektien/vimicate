// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
vi.mock('react-native', () => ({ I18nManager: { isRTL: false } }));
vi.mock('../../node_modules/@shopify/flash-list/dist/native/config/PlatformHelper', () => ({ PlatformConfig: { supportsOffsetCorrection: true } }));
import { useRecyclerViewController } from '../../node_modules/@shopify/flash-list/dist/recyclerview/hooks/useRecyclerViewController';

let root: ReturnType<typeof createRoot>;
beforeEach(() => { vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); root = createRoot(document.createElement('div')); });
afterEach(async () => { await act(async () => root.unmount()); vi.unstubAllGlobals(); });

it.each([
  { label: 'same-length replacement outside engaged window', count: 120, trim: true, remove: false },
  { label: 'same-length replacement inside engaged window', count: 20, trim: true, remove: false },
  { label: 'growing prepend outside engaged window', count: 120, trim: false, remove: false },
  { label: 'removed anchor', count: 480, trim: true, remove: true },
])('preserves or retires the exact anchor: $label', async ({ count, trim, remove }) => {
  const original = Array.from({ length: 480 }, (_, i) => ({ key: `row-${i}` }));
  const manager = {
    props: { data: original, horizontal: false }, ignoreScrollEvents: false, animationOptimizationsEnabled: false,
    getDataLength: () => manager.props.data.length,
    getIsFirstLayoutComplete: () => true, hasStableDataKeys: () => true, shouldMaintainVisibleContentPosition: () => true,
    computeVisibleIndices: () => ({ startIndex: 0, endIndex: 20 }),
    getDataKey: (index: number) => manager.props.data[index]?.key,
    getLayout: (index: number) => ({ x: 0, y: index * 20, width: 400, height: 20 }),
    getEngagedIndices: () => ({ findValue: (predicate: (i: number) => boolean) => Array.from({ length: 50 }, (_, i) => i).find(predicate) }),
    getAbsoluteLastScrollOffset: () => 0,
    updateScrollOffset: vi.fn(() => undefined),
  };
  const anchor = { current: { scrollBy: vi.fn() } };
  let controller!: ReturnType<typeof useRecyclerViewController>;
  function Owner() { controller = useRecyclerViewController(manager as never, null, { current: null } as never, anchor as never); return null; }
  await act(async () => root.render(<Owner />));
  controller.computeFirstVisibleIndexForOffsetCorrection();
  manager.props.data = [...Array.from({ length: count }, (_, i) => ({ key: `older-${i}` })), ...(trim ? original.slice(0, 480 - count) : original)];
  await act(async () => controller.applyOffsetCorrection());
  if (remove) { expect(anchor.current.scrollBy).not.toHaveBeenCalled(); return; }
  expect(anchor.current.scrollBy).toHaveBeenCalledExactlyOnceWith(count * 20);
  if (trim && count < 50) return; // Existing in-window correction may not need manager readmission.
  expect(manager.updateScrollOffset).toHaveBeenCalledWith(count * 20);
});

// An explicit navigation write supersedes a recycler correction still awaiting
// native delivery; otherwise continuous streaming suppresses its only onScroll.
it.each([false, true])('immediate navigation owns its anchor; animated=%s retains native progression', async (animated) => {
  const data = Array.from({ length: 150 }, (_, i) => ({ key: `row-${i}` }));
  let offset = 2000;
  const manager = {
    props: { data, horizontal: false }, ignoreScrollEvents: true, animationOptimizationsEnabled: false,
    getDataLength: () => manager.props.data.length, getIsFirstLayoutComplete: () => true,
    hasStableDataKeys: () => true, shouldMaintainVisibleContentPosition: () => true,
    computeVisibleIndices: () => ({ startIndex: Math.floor(offset / 20), endIndex: Math.floor(offset / 20) + 10 }),
    getDataKey: (index: number) => manager.props.data[index]?.key,
    getLayout: (index: number) => ({ x: 0, y: index * 20, width: 400, height: 20 }),
    getEngagedIndices: () => ({ findValue: (predicate: (i: number) => boolean) => Array.from({ length: 30 }, (_, i) => i + Math.floor(offset / 20)).find(predicate) }),
    getAbsoluteLastScrollOffset: () => offset,
    updateScrollOffset: vi.fn((next: number) => { offset = next; return undefined; }),
  };
  const anchor = { current: { scrollBy: vi.fn() } };
  const scroll = { current: { scrollTo: vi.fn() } };
  const ref = React.createRef<{ scrollToOffset(options: { offset: number; animated: boolean }): void }>();
  let controller!: ReturnType<typeof useRecyclerViewController>;
  function Owner() { controller = useRecyclerViewController(manager as never, ref as never, scroll as never, anchor as never); return null; }
  await act(async () => root.render(<Owner />));
  controller.computeFirstVisibleIndexForOffsetCorrection();
  await act(async () => ref.current!.scrollToOffset({ offset: 0, animated }));
  if (animated) {
    expect(manager.ignoreScrollEvents).toBe(true); expect(offset).toBe(2000);
    expect(manager.updateScrollOffset).not.toHaveBeenCalled();
    expect(scroll.current.scrollTo).toHaveBeenCalledWith({ x: 0, y: 0, animated: true });
    return;
  }
  expect(manager.ignoreScrollEvents).toBe(false);
  expect(offset).toBe(0);
  expect(scroll.current.scrollTo).toHaveBeenCalledWith({ x: 0, y: 0, animated: false });
  manager.props.data = [...data.slice(0, 50), { key: 'insert-above-old-tail' }, ...data.slice(50)];
  await act(async () => controller.applyOffsetCorrection());
  expect(anchor.current.scrollBy).not.toHaveBeenCalled();
});

it('readmits measurement-only anchor corrections while native scroll events are suppressed', async () => {
  const original = Array.from({ length: 480 }, (_, i) => ({ key: `row-${i}` }));
  let offset = 0; let refinement = 0;
  const manager = {
    props: { data: original, horizontal: false }, ignoreScrollEvents: false, animationOptimizationsEnabled: false,
    getDataLength: () => manager.props.data.length, getIsFirstLayoutComplete: () => true,
    hasStableDataKeys: () => true, shouldMaintainVisibleContentPosition: () => true,
    computeVisibleIndices: () => ({ startIndex: manager.props.data.findIndex((_, i) => manager.getLayout(i).y + manager.getLayout(i).height > offset) }),
    getDataKey: (index: number) => manager.props.data[index]?.key,
    getLayout: (index: number) => ({ x: 0, y: index * 20 + (index >= 120 ? refinement : 0), width: 400, height: 20 + (index === 119 ? refinement : 0) }),
    getEngagedIndices: () => ({ findValue: (predicate: (i: number) => boolean) => manager.props.data.findIndex((_, i) => predicate(i)) }),
    getAbsoluteLastScrollOffset: () => offset,
    updateScrollOffset: vi.fn((next: number) => { offset = next; return undefined; }),
  };
  const anchor = { current: { scrollBy: vi.fn() } };
  let controller!: ReturnType<typeof useRecyclerViewController>;
  function Owner() { controller = useRecyclerViewController(manager as never, null, { current: null } as never, anchor as never); return null; }
  await act(async () => root.render(<Owner />));
  controller.computeFirstVisibleIndexForOffsetCorrection();
  manager.props.data = [...Array.from({ length: 120 }, (_, i) => ({ key: `older-${i}` })), ...original.slice(0, 360)];
  await act(async () => controller.applyOffsetCorrection());
  expect(offset).toBe(2400); expect(manager.ignoreScrollEvents).toBe(true);
  // Same data object; a newly measured older row grows before native delivery.
  refinement = 172;
  await act(async () => controller.applyOffsetCorrection());
  expect(offset).toBe(2572);
  refinement = 184;
  await act(async () => controller.applyOffsetCorrection());
  expect(offset).toBe(2584);
  expect(anchor.current.scrollBy.mock.calls.map(args => args[0])).toEqual([2400, 172, 12]);
});
