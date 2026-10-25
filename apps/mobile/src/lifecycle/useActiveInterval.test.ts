import { describe, expect, it, vi } from 'vitest';
import { ActiveIntervalController, type ActiveIntervalScheduler } from './activeIntervalController';

describe('foreground-owned periodic work', () => {
  it('starts once while active, stops immediately on suspension and restarts once on resume', () => {
    let nextHandle = 1;
    const callbacks = new Map<number, () => void>();
    const scheduler: ActiveIntervalScheduler = {
      set: vi.fn((callback) => {
        const handle = nextHandle++ as ReturnType<typeof setInterval>;
        callbacks.set(handle as number, callback);
        return handle;
      }),
      clear: vi.fn((handle) => { callbacks.delete(handle as number); }),
    };
    const callback = vi.fn();
    const controller = new ActiveIntervalController(callback, 30_000, scheduler);

    controller.sync(false, true, true);
    expect(callback).not.toHaveBeenCalled();
    expect(callbacks.size).toBe(0);

    controller.sync(true, true, true);
    controller.sync(true, true, true);
    expect(callback).toHaveBeenCalledTimes(1);
    expect(scheduler.set).toHaveBeenCalledTimes(1);
    expect(callbacks.size).toBe(1);

    callbacks.values().next().value?.();
    expect(callback).toHaveBeenCalledTimes(2);

    controller.sync(false, true, true);
    expect(scheduler.clear).toHaveBeenCalledTimes(1);
    expect(callbacks.size).toBe(0);

    controller.sync(true, true, true);
    expect(callback).toHaveBeenCalledTimes(3);
    expect(scheduler.set).toHaveBeenCalledTimes(2);
    expect(callbacks.size).toBe(1);

    controller.dispose();
    expect(scheduler.clear).toHaveBeenCalledTimes(2);
    expect(callbacks.size).toBe(0);
  });

  it('does not fire or schedule while disabled, even if the scene is active', () => {
    const callback = vi.fn();
    const scheduler: ActiveIntervalScheduler = {
      set: vi.fn(() => 1 as ReturnType<typeof setInterval>),
      clear: vi.fn(),
    };
    const controller = new ActiveIntervalController(callback, 1_000, scheduler);

    controller.sync(true, false, true);
    expect(callback).not.toHaveBeenCalled();
    expect(scheduler.set).not.toHaveBeenCalled();

    controller.sync(true, true, false);
    expect(callback).not.toHaveBeenCalled();
    expect(scheduler.set).toHaveBeenCalledTimes(1);

    controller.sync(true, false, false);
    expect(scheduler.clear).toHaveBeenCalledTimes(1);
  });

  it('cancels a deferred activation callback when its interval is retired', () => {
    const activations: (() => void)[] = [];
    const callback = vi.fn();
    const scheduler: ActiveIntervalScheduler = {
      set: vi.fn(() => 1 as ReturnType<typeof setInterval>),
      clear: vi.fn(),
    };
    const controller = new ActiveIntervalController(callback, 1_000, scheduler, (activation) => activations.push(activation));

    controller.sync(true, true, true);
    controller.sync(true, true, true);
    expect(activations).toHaveLength(1);
    expect(callback).not.toHaveBeenCalled();

    controller.dispose();
    activations[0]!();
    expect(callback).not.toHaveBeenCalled();
  });
});
