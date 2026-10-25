// @vitest-environment jsdom
import React, { act, startTransition, Suspense, useLayoutEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { FlashListRef } from '@shopify/flash-list';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const probe = vi.hoisted(() => ({ record: vi.fn() }));
vi.mock('../../modules/vimicate-diagnostics', () => ({ recordViewportDiagnostic: probe.record }));
import { useTranscriptLayoutDiagnostics } from './useTranscriptLayoutDiagnostics';

let root: Root;
let callback: () => void;
let attempts: number;
const tasks: Array<() => void> = [];
const topology = {}, presentation = {};
const pending = new Promise<never>(() => {});
const geometry = { getWindowSize: () => ({ width: 1044, height: 477 }), computeVisibleIndices: () => ({ startIndex: 425, endIndex: 441 }),
  getChildContainerDimensions: () => ({ width: 1044, height: 11471 }), getAbsoluteLastScrollOffset: () => 10994, getFirstItemOffset: () => 30 };
const list = { current: geometry as FlashListRef<unknown> };
function Pending({ blocked }: { blocked: boolean }) { if (blocked) throw pending; return null; }
function Probe({ dataset = 'private:/Users/fixture/notes', data = topology, rows = presentation }: { dataset?: string; data?: object; rows?: object }) {
  attempts++;
  const onCommit = useTranscriptLayoutDiagnostics(dataset, data, rows, list);
  useLayoutEffect(() => { callback = onCommit; });
  return null;
}
const commit = (count: number, target = callback) => { for (let i = 0; i < count; i++) target(); };
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); vi.stubGlobal('React', React);
  vi.stubGlobal('queueMicrotask', (task: () => void) => tasks.push(task));
  root = createRoot(document.createElement('div')); attempts = 0; tasks.length = 0; probe.record.mockReset();
});
afterEach(async () => { await act(async () => root.unmount()); vi.unstubAllGlobals(); });

describe('committed dataset layout observer', () => {
  it('records numeric native geometry without publishing React updates or private identity', async () => {
    await act(async () => root.render(<Probe />));
    const renders = attempts; commit(100);
    expect(attempts).toBe(renders); expect(probe.record).toHaveBeenCalledTimes(4);
    expect(probe.record.mock.calls[0]?.[0]).toMatch(/^layout-burst ds=[0-9a-f]{8} v=425-441 o=10994 h=11471 vh=477 w=1044 lc=8 pc=1 dc=1 rc=1 i=30$/);
    for (const [message] of probe.record.mock.calls) {
      expect(message).not.toMatch(/private|Users|notes/); expect(message.length).toBeLessThan(280);
    }
  });
  it('retains callback identity across presentation commits and retires it across A→B→A', async () => {
    await act(async () => root.render(<Probe dataset="a" />)); const a = callback;
    await act(async () => root.render(<Probe dataset="a" rows={{}} />)); expect(callback).toBe(a);
    await act(async () => root.render(<Probe dataset="b" />)); const b = callback;
    await act(async () => root.render(<Probe dataset="a" />));
    commit(50, a); commit(50, b); expect(probe.record).not.toHaveBeenCalled();
    commit(8); expect(probe.record).toHaveBeenCalledOnce();
    await act(async () => root.unmount()); commit(100); tasks.splice(0).forEach((task) => task());
    expect(probe.record).toHaveBeenCalledOnce();
  });
  it('does not publish a suspended presentation or dataset into the committed observer', async () => {
    await act(async () => root.render(<Suspense><Probe /><Pending blocked={false} /></Suspense>));
    const committed = callback; const previousAttempts = attempts;
    await act(async () => startTransition(() => root.render(<Suspense><Probe dataset="foreign" rows={{}} /><Pending blocked /></Suspense>)));
    expect(attempts).toBeGreaterThan(previousAttempts); expect(callback).toBe(committed);
    commit(8); expect(probe.record.mock.calls[0]?.[0]).toContain('lc=8 pc=1 dc=1 rc=1');
  });
});
