// @vitest-environment jsdom
import React, { act, startTransition, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
vi.mock('react-native', () => ({ Platform: { constants: { reactNativeVersion: { major: 0, minor: 86, patch: 3 } } } }));
import { useRecyclerViewManager } from '../../node_modules/@shopify/flash-list/dist/recyclerview/hooks/useRecyclerViewManager';
import { RecyclerViewManager } from '../../node_modules/@shopify/flash-list/dist/recyclerview/RecyclerViewManager';
// Hook boundary of the canonical FlashList patch with the installed manager.
// The full component, layout and native-target contracts are covered by
// flashListCommitBoundary.test.tsx.
const pending = new Promise<never>(() => {});
let root: ReturnType<typeof createRoot>;
let manager: RecyclerViewManager<string>;
let renderedData: unknown[];
let ownedGeometry: boolean[];
let acceptedUpdates: () => number;
function Owner({ data }: { data: string[] }) {
  const owner = useRecyclerViewManager({ data } as never) as unknown as { recyclerViewManager: RecyclerViewManager<string>; renderView: RecyclerViewManager<string> };
  manager = owner.recyclerViewManager;
  renderedData.push(owner.renderView.props.data);
  ownedGeometry.push(Object.prototype.hasOwnProperty.call(owner.renderView, 'layoutManager'));
  return null;
}
function Block({ blocked }: { blocked: boolean }) { if (blocked) throw pending; return null; }
function Scene({ data, blocked = false }: { data: string[]; blocked?: boolean }) { return <Suspense fallback={null}><Owner data={data} /><Block blocked={blocked} /></Suspense>; }
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  root = createRoot(document.createElement('div'));
  renderedData = [];
  ownedGeometry = [];
  const update = vi.spyOn(RecyclerViewManager.prototype, 'processDataUpdate');
  acceptedUpdates = () => update.mock.contexts.filter(context => context === manager).length;
});
afterEach(async () => { await act(async () => root.unmount()); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
it('renders a suspended replacement from a projection without publishing it to the accepted manager', async () => {
  const original = Array.from({ length: 100 }, (_, i) => String(i));
  await act(async () => root.render(<Scene data={original} />));
  const accepted = manager; const baseline = acceptedUpdates();
  const replacement = ['other'];
  await act(async () => startTransition(() => root.render(<Scene data={replacement} blocked />)));
  expect(renderedData.at(-1)).toBe(replacement); // The speculative render ran.
  expect(manager).toBe(accepted);
  expect(manager.props.data).toBe(original);
  expect(manager.getDataLength()).toBe(100);
  expect(acceptedUpdates()).toBe(baseline);
});
it('publishes an accepted replacement exactly once and does not readmit a same-data render', async () => {
  const original = ['a', 'b']; const next = ['c'];
  await act(async () => root.render(<Scene data={original} />));
  const baseline = acceptedUpdates();
  await act(async () => root.render(<Scene data={next} />));
  expect(manager.props.data).toBe(next);
  expect(acceptedUpdates()).toBe(baseline + 1);
  expect(ownedGeometry.at(-1)).toBe(true); // A data revision renders forked geometry.
  await act(async () => root.render(<Scene data={next} />));
  expect(acceptedUpdates()).toBe(baseline + 1);
  expect(renderedData.at(-1)).toBe(next);
  // Same-data props, such as per-keystroke extraData, must not copy geometry.
  expect(ownedGeometry.at(-1)).toBe(false);
});
