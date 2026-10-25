// @vitest-environment jsdom
import React, { act, forwardRef, startTransition, Suspense, useImperativeHandle, useLayoutEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const native = vi.hoisted(() => ({ pending: [] as ((y: number) => void)[] }));
vi.mock('react-native', () => ({ View: forwardRef<unknown, { children?: React.ReactNode }>((props, ref) => {
  useImperativeHandle(ref, () => ({ measureLayout: (_owner: unknown, done: (x: number, y: number, w: number, h: number) => void) => {
    native.pending.push(y => done(0, y, 400, 40));
  } }), []);
  return <div>{props.children}</div>;
}) }));
import { View } from 'react-native';
import { QuestionTargetScope, useQuestionTarget } from './QuestionTargetScope';
let root: Root;
let target: ReturnType<typeof useQuestionTarget>;
let committed: string;
const reveal = vi.fn(); const capture = vi.fn((_owner: string) => ({ y: -80, height: 400 })); const cancel = vi.fn();
const pending = new Promise<never>(() => {});
function Target({ active, revision }: { active: boolean; revision: number }) {
  const binding = useQuestionTarget(active, 'option', revision);
  useLayoutEffect(() => { target = binding; });
  return <View {...binding} />;
}
function Pause({ suspend }: { suspend: boolean }) { if (suspend) throw pending; return null; }
function Scene({ owner = 'a', dataset = 'a', active = true, revision = 0, suspend = false, show = true } = {}) {
  useLayoutEffect(() => { committed = owner; });
  return <Suspense fallback={null}><QuestionTargetScope key={dataset} capture={() => capture(owner)}
    reveal={region => reveal(owner, region)} cancel={() => cancel(owner)}>
    {show && <Target active={active} revision={revision} />}
  </QuestionTargetScope><Pause suspend={suspend} /></Suspense>;
}
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); native.pending = []; vi.clearAllMocks();
  root = createRoot(document.createElement('div'));
});
afterEach(async () => { await act(async () => root.unmount()); vi.unstubAllGlobals(); });
it('uses the latest committed row callback without remeasuring and restores the original capture', async () => {
  await act(async () => root.render(<Scene />));
  expect(native.pending).toHaveLength(1);
  await act(async () => root.render(<Scene owner="moved-row" />));
  expect(native.pending).toHaveLength(1); expect(cancel).not.toHaveBeenCalled();
  await act(async () => native.pending.shift()!(900));
  expect(reveal).toHaveBeenCalledExactlyOnceWith('moved-row', { y: 900, height: 40 });
  await act(async () => root.render(<Scene owner="moved-row" active={false} revision={1} />));
  expect(reveal).toHaveBeenLastCalledWith('moved-row', { y: -80, height: 400 });
  expect(capture).toHaveBeenCalledExactlyOnceWith('a'); expect(cancel).toHaveBeenCalledExactlyOnceWith('moved-row');
});
it('retires older same-target measurements even when native callbacks complete backwards', async () => {
  await act(async () => root.render(<Scene />));
  target.onLayout(); target.onLayout();
  expect(native.pending).toHaveLength(3);
  const callbacks = native.pending.splice(0);
  callbacks[2]!(900); callbacks[1]!(500); callbacks[0]!(100);
  expect(reveal).toHaveBeenCalledExactlyOnceWith('a', { y: 900, height: 40 });
  target.onLayout(); await act(async () => root.render(<Scene show={false} />));
  native.pending.splice(0).forEach(done => done(1_300));
  expect(reveal).toHaveBeenCalledTimes(1);
});
it('never leaks a suspended replacement callback or an old cell measurement into the next dataset', async () => {
  await act(async () => root.render(<Scene />));
  const visibleMeasurement = native.pending.shift()!;
  await act(async () => startTransition(() => root.render(<Scene owner="b" suspend />)));
  // Only the scope's committed callback matters, not a speculative parent render.
  visibleMeasurement(100);
  expect(reveal).toHaveBeenCalledExactlyOnceWith('a', { y: 100, height: 40 });
  target.onLayout(); const retiredMeasurement = native.pending.shift()!;
  await act(async () => root.render(<Scene owner="b" dataset="b" />));
  expect(committed).toBe('b'); reveal.mockClear(); retiredMeasurement(900);
  expect(reveal).not.toHaveBeenCalled();
  native.pending.splice(0).forEach(done => done(200));
  expect(reveal).toHaveBeenCalledExactlyOnceWith('b', { y: 200, height: 40 });
});
