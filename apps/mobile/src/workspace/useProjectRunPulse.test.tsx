// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const native = vi.hoisted(() => ({
  state: 'active', scene: undefined as undefined | ((state: string) => void),
  motion: undefined as undefined | ((value: boolean) => void),
  read: vi.fn<() => Promise<boolean>>(), timing: vi.fn(),
  loops: [] as { start: ReturnType<typeof vi.fn>; stop: ReturnType<typeof vi.fn> }[],
  sceneRemoved: vi.fn(), motionRemoved: vi.fn(),
}));
vi.mock('react-native', () => ({
  AppState: { get currentState() { return native.state; }, addEventListener: (_: string, callback: (state: string) => void) => {
    native.scene = callback; return { remove: native.sceneRemoved };
  } },
  AccessibilityInfo: { isReduceMotionEnabled: () => native.read(), addEventListener: (_: string, callback: (value: boolean) => void) => {
    native.motion = callback; return { remove: native.motionRemoved };
  } },
  Easing: { ease: 'ease', inOut: (value: unknown) => value },
  Animated: {
    Value: class { constructor(public value: number) {} setValue(value: number) { this.value = value; } },
    timing: (...args: unknown[]) => native.timing(...args), sequence: (steps: unknown) => steps,
    loop: () => { const loop = { start: vi.fn(), stop: vi.fn() }; native.loops.push(loop); return loop; },
  },
}));
import { useProjectRunPulse } from './useProjectRunPulse';

let root: Root, node: HTMLDivElement, value: ReturnType<typeof useProjectRunPulse>;
function Probe({ enabled, phase = 'running' }: { enabled: boolean; phase?: string }) {
  value = useProjectRunPulse(enabled); return <span>{phase}</span>;
}
async function render(enabled: boolean, phase?: string) {
  await act(async () => root.render(<Probe enabled={enabled} {...(phase ? { phase } : {})} />));
}
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  native.state = 'active'; native.loops = []; native.scene = undefined; native.motion = undefined;
  vi.clearAllMocks(); native.read.mockResolvedValue(false);
  node = document.createElement('div'); document.body.appendChild(node); root = createRoot(node);
});
afterEach(async () => { await act(async () => root.unmount()); node.remove(); });

it('shares one native non-interaction pulse across ongoing phase and row updates', async () => {
  await render(true, 'accepted'); const original = value;
  await render(true, 'running'); await render(true, 'waiting');
  expect(value).toBe(original); expect(native.loops).toHaveLength(1);
  expect(native.loops[0]!.start).toHaveBeenCalledOnce();
  expect(native.timing.mock.calls.map(call => call[1])).toEqual([
    expect.objectContaining({ toValue: 0.55, duration: 500, useNativeDriver: true, isInteraction: false }),
    expect.objectContaining({ toValue: 1, duration: 500, useNativeDriver: true, isInteraction: false }),
  ]);
});

it('stops for hidden rail or no visible running cards and disposes both subscriptions', async () => {
  await render(true); await render(false);
  expect(native.loops[0]!.stop).toHaveBeenCalledOnce();
  expect(native.sceneRemoved).toHaveBeenCalledOnce(); expect(native.motionRemoved).toHaveBeenCalledOnce();
  expect((value as unknown as { value: number }).value).toBe(1);
  await render(true); expect(native.loops).toHaveLength(2);
});

it('stops on inactive/background and resumes only on active', async () => {
  await render(true);
  native.scene!('inactive'); native.scene!('background');
  expect(native.loops[0]!.stop).toHaveBeenCalledOnce();
  expect((value as unknown as { value: number }).value).toBe(1);
  native.scene!('active'); expect(native.loops).toHaveLength(2);
  await act(async () => root.unmount());
  expect(native.loops[1]!.stop).toHaveBeenCalledOnce();
});

it('honours live Reduce Motion changes and rejects an older initial setting read', async () => {
  let resolve!: (value: boolean) => void;
  native.read.mockReturnValue(new Promise(done => { resolve = done; }));
  await render(true); expect(native.loops).toHaveLength(0);
  native.motion!(true); resolve(false); await act(async () => {});
  expect(native.loops).toHaveLength(0);
  native.motion!(false); expect(native.loops).toHaveLength(1);
  native.motion!(true); expect(native.loops[0]!.stop).toHaveBeenCalledOnce();
});

it('does not animate before activation, after disposal, or after a failed preference read', async () => {
  native.state = 'background'; await render(true); expect(native.loops).toHaveLength(0);
  await render(false);
  let resolve!: (value: boolean) => void;
  native.state = 'active'; native.read.mockReturnValue(new Promise(done => { resolve = done; }));
  await render(true); await render(false); resolve(false); await act(async () => {});
  expect(native.loops).toHaveLength(0);
  native.read.mockRejectedValue(new Error('unavailable')); await render(true);
  expect(native.loops).toHaveLength(0);
});
