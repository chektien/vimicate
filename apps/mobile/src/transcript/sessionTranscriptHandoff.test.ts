import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SetStateAction } from 'react';
import type { TranscriptPaneHandle } from './TranscriptPane';
import { createTranscriptBuffer, createTranscriptVimState, type TranscriptBuffer, type TranscriptVimState } from './transcriptVim';

// This driver runs the actual hook across committed revisions with preserved
// refs/dependencies and a controlled display-frame queue. It does not model
// React's renderer or native FlashList geometry, and is not a crash reproducer.
const hooks = vi.hoisted(() => ({
  index: 0,
  slots: [] as Array<{ current?: unknown; value?: unknown; deps?: unknown[]; cleanup?: (() => void) | undefined }>,
  effects: [] as Array<() => void>,
}));
vi.mock('react', () => {
  const same = (a: unknown[] | undefined, b: unknown[]) => a?.length === b.length && b.every((v, i) => Object.is(v, a[i]));
  return {
    useRef: (current: unknown) => {
      const index = hooks.index++;
      return hooks.slots[index] ??= { current };
    },
    useCallback: (callback: unknown, deps: unknown[]) => {
      const index = hooks.index++; const prior = hooks.slots[index];
      if (!prior || !same(prior.deps, deps)) hooks.slots[index] = { value: callback, deps };
      return hooks.slots[index]!.value;
    },
    useLayoutEffect: (effect: () => void | (() => void), deps: unknown[]) => {
      const index = hooks.index++; const prior = hooks.slots[index];
      if (prior && same(prior.deps, deps)) return;
      hooks.effects.push(() => {
        prior?.cleanup?.();
        hooks.slots[index] = { deps, cleanup: effect() ?? undefined };
      });
    },
  };
});
import { useSessionTranscriptNavigation } from './useSessionTranscriptNavigation';

function buffer(text = 'one\ntwo\nthree') {
  return createTranscriptBuffer([{ id: 'answer', role: 'assistant', source: 'history', text }]);
}

function setup() {
  let nextFrame = 0;
  const frames = new Map<number, FrameRequestCallback>();
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    const id = ++nextFrame; frames.set(id, callback); return id;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
  const navigationRef = { current: createTranscriptVimState(buffer()) };
  const viewport = { reveal: vi.fn(), revealAfterRevision: vi.fn(), viewPositionForSourceRow: vi.fn(() => 0.31) };
  const viewportRef = { current: viewport as unknown as TranscriptPaneHandle };
  const setNavigation = (value: SetStateAction<TranscriptVimState>) => {
    navigationRef.current = typeof value === 'function' ? value(navigationRef.current) : value;
  };
  const tailReveal = { consumeIfAdvanced: vi.fn(() => false) };
  const render = (sessionKey: string, next: TranscriptBuffer) => {
    hooks.index = 0;
    const result = useSessionTranscriptNavigation({ sessionKey, buffer: next, navigationRef,
      setNavigation, viewportRef, tailReveal });
    const effects = hooks.effects.splice(0); effects.forEach(effect => effect());
    return result;
  };
  const tick = () => {
    const queued = [...frames.values()]; frames.clear(); queued.forEach(callback => callback(0));
  };
  const unmount = () => { hooks.slots.forEach(slot => slot.cleanup?.()); };
  return { render, tick, frames, viewport, navigationRef, tailReveal, unmount };
}

beforeEach(() => { hooks.index = 0; hooks.slots = []; hooks.effects = []; });
afterEach(() => { vi.unstubAllGlobals(); });

describe('session viewport handoff across committed revisions', () => {
  it('restores a cached tail on an ordinary return with no intervening refresh', () => {
    const test = setup(); const first = buffer();
    test.render('a', first).captureCurrentSession();
    test.render('b', buffer('other')); test.tick(); test.viewport.reveal.mockClear();
    test.render('a', first); test.tick();
    expect(test.viewport.reveal).toHaveBeenCalledExactlyOnceWith(2, true, 'tail');
    test.unmount();
  });

  it('restores deliberate review on an ordinary return, without tail promotion', () => {
    const test = setup(); const first = buffer();
    const session = test.render('a', first);
    test.navigationRef.current = { ...test.navigationRef.current, followTail: false, cursor: { row: 1, column: 0 } };
    session.captureCurrentSession();
    test.render('b', buffer('other')); test.tick(); test.viewport.reveal.mockClear();
    test.render('a', first); test.tick();
    expect(test.viewport.revealAfterRevision).toHaveBeenCalledExactlyOnceWith(1, 0.31);
    expect(test.viewport.reveal).not.toHaveBeenCalled();
    test.unmount();
  });

  it('allows visible-fold projection to retain an explicitly tail-owned request', () => {
    const test = setup(); test.render('a', buffer()); test.render('b', buffer());
    test.navigationRef.current = { ...test.navigationRef.current, cursor: { row: 0, column: 0 } };
    test.tick();
    expect(test.viewport.reveal).toHaveBeenCalledExactlyOnceWith(2, true, 'tail');
    test.unmount();
  });

  it('reveals the newest tail when history refreshes before the return frame', () => {
    const test = setup(); const first = buffer();
    test.render('a', first).captureCurrentSession();
    test.render('b', buffer('other')); test.tick(); test.viewport.reveal.mockClear();
    test.render('a', first);
    const latest = buffer('one\ntwo\nthree\nfour');
    test.render('a', latest); test.tick();
    expect(test.viewport.reveal).toHaveBeenCalledExactlyOnceWith(latest.lines.length - 1, true, 'tail');
    test.unmount();
  });

  it('keeps a same-height refresh from discarding a parked review restore', () => {
    const test = setup(); const first = buffer();
    const session = test.render('a', first);
    test.navigationRef.current = { ...test.navigationRef.current, followTail: false, cursor: { row: 1, column: 0 } };
    session.captureCurrentSession();
    test.render('b', buffer('other')); test.tick();
    test.render('a', first);
    test.render('a', buffer()); test.tick();
    expect(test.viewport.revealAfterRevision).toHaveBeenCalledExactlyOnceWith(1, 0.31);
    test.unmount();
  });

  it('remaps pending review to its source identity without losing the saved screen position', () => {
    const test = setup(); const first = buffer();
    const session = test.render('a', first);
    test.navigationRef.current = { ...test.navigationRef.current, followTail: false, cursor: { row: 1, column: 0 } };
    session.captureCurrentSession();
    test.render('b', buffer('other')); test.tick(); test.viewport.reveal.mockClear();
    test.render('a', first);
    const prepended = createTranscriptBuffer([
      { id: 'older', role: 'assistant', source: 'history', text: 'zero' },
      { id: 'answer', role: 'assistant', source: 'history', text: 'one\ntwo\nthree' },
    ]);
    test.render('a', prepended); test.tick();
    expect(test.viewport.revealAfterRevision).toHaveBeenCalledExactlyOnceWith(2, 0.31);
    expect(test.viewport.reveal).not.toHaveBeenCalled();
    test.unmount();
  });

  it('does not let the return frame reclaim tail after a newer explicit review motion', () => {
    const test = setup(); test.render('a', buffer()); test.render('b', buffer());
    test.navigationRef.current = { ...test.navigationRef.current, followTail: false, cursor: { row: 0, column: 0 } };
    test.tick();
    expect(test.viewport.reveal).not.toHaveBeenCalled();
    test.unmount();
  });

  it('does not rebase an obsolete return request onto a newer user-selected review row', () => {
    const test = setup(); test.render('a', buffer()); test.render('b', buffer());
    test.navigationRef.current = { ...test.navigationRef.current, followTail: false, cursor: { row: 0, column: 0 } };
    test.render('b', buffer('one\ntwo\nthree\nfour')); test.tick();
    expect(test.viewport.reveal).not.toHaveBeenCalled();
    expect(test.viewport.revealAfterRevision).not.toHaveBeenCalled();
    test.unmount();
  });

  it('keeps an explicit submission tail request through a second history publication', () => {
    const test = setup(); test.render('a', buffer());
    test.navigationRef.current = { ...test.navigationRef.current, followTail: false, cursor: { row: 0, column: 0 } };
    test.tailReveal.consumeIfAdvanced.mockReturnValueOnce(true);
    test.render('a', buffer('one\ntwo\nthree\nsubmitted'));
    test.render('a', buffer('one\ntwo\nthree\nsubmitted\nreply')); test.tick();
    expect(test.viewport.reveal).toHaveBeenCalledExactlyOnceWith(4, true, 'tail');
    test.unmount();
  });

  it('keeps the admitted return position when a later capture and page arrive before its frame', () => {
    const test = setup(); const first = buffer();
    const session = test.render('a', first);
    test.navigationRef.current = { ...test.navigationRef.current, followTail: false, cursor: { row: 1, column: 0 } };
    session.captureCurrentSession();
    test.render('b', buffer('other')); test.tick();
    test.render('a', first);
    test.viewport.viewPositionForSourceRow.mockReturnValue(0.6);
    test.render('a', first).captureCurrentSession();
    test.render('a', buffer()); test.render('a', buffer()); test.tick();
    expect(test.viewport.revealAfterRevision).toHaveBeenCalledExactlyOnceWith(1, 0.31);
    test.unmount();
  });

  it('coalesces revisions without moving the handoff behind a queued list geometry writer', () => {
    const test = setup(); test.render('a', buffer()); test.render('b', buffer());
    const admitted = [...test.frames.keys()];
    const order: string[] = [];
    test.viewport.reveal.mockImplementation(() => { order.push('handoff'); });
    requestAnimationFrame(() => order.push('geometry'));
    test.render('b', buffer('one\ntwo\nthree\nfour'));
    expect(test.viewport.reveal).not.toHaveBeenCalled();
    expect([...test.frames.keys()][0]).toBe(admitted[0]);
    test.tick(); expect(test.viewport.reveal).toHaveBeenCalledExactlyOnceWith(3, true, 'tail');
    expect(order).toEqual(['handoff', 'geometry']);
    test.unmount();
  });

  it('does not revive a canceled callback even after returning to the identical session buffer', () => {
    const test = setup(); const same = buffer();
    test.render('a', same); test.render('b', same);
    const canceled = [...test.frames.values()];
    test.render('a', same); test.render('b', same);
    canceled.forEach(callback => callback(0));
    expect(test.viewport.reveal).not.toHaveBeenCalled();
    test.tick(); expect(test.viewport.reveal).toHaveBeenCalledOnce();
    test.unmount();
  });

  it('revokes pending callbacks on disposal, even if the platform delivers one late', () => {
    const test = setup(); test.render('a', buffer()); test.render('b', buffer());
    const canceled = [...test.frames.values()]; test.unmount();
    expect(test.frames.size).toBe(0);
    canceled.forEach(callback => callback(0));
    expect(test.viewport.reveal).not.toHaveBeenCalled();
  });

  it('coalesces repeated revisions into one current handoff and does not schedule work when idle', () => {
    const test = setup(); test.render('a', buffer()); test.render('b', buffer());
    for (let i = 0; i < 50; i += 1) {
      test.render('b', buffer(`one\ntwo\n${i}`));
      expect(test.frames.size).toBe(1);
    }
    test.tick(); expect(test.viewport.reveal).toHaveBeenCalledOnce();
    test.render('b', buffer('one\ntwo\nsettled'));
    expect(test.frames.size).toBe(0);
    test.unmount();
  });
});
