// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useWorkspaceHardwareKeys } from './useWorkspaceHardwareKeys';

let root: Root;
let node: HTMLDivElement;
let keys: ReturnType<typeof useWorkspaceHardwareKeys>;
let context: ReturnType<Parameters<typeof useWorkspaceHardwareKeys>[1]>;
const dispatch = vi.fn();
const frames = new Map<number, FrameRequestCallback>();
let nextFrame = 0;
const key = (value: string) => ({ key: value, isRepeat: true, control: false, shift: false, option: false, command: false });
function Probe({ owner = 'session:transcript' }) { keys = useWorkspaceHardwareKeys(dispatch, () => context, owner); return null; }

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.useFakeTimers(); frames.clear(); nextFrame = 0; dispatch.mockClear();
  vi.stubGlobal('requestAnimationFrame', (fn: FrameRequestCallback) => { frames.set(++nextFrame, fn); return nextFrame; });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
  context = { pane: 'transcript', pending: '', commandLineActive: false, scope: 'session' };
  node = document.createElement('div'); root = createRoot(node);
});
afterEach(async () => { await act(async () => root.unmount()); node.remove(); vi.useRealTimers(); vi.unstubAllGlobals(); });
const flushFrame = () => { const callbacks = [...frames.values()]; frames.clear(); callbacks.forEach(callback => callback(0)); };

it('coalesces held movements and releases the repeat affordance after the quiet period', async () => {
  await act(async () => root.render(<Probe />));
  await act(async () => { keys.onHardwareKey(key('j')); keys.onHardwareKey(key('k')); });
  expect(dispatch).not.toHaveBeenCalled(); expect(keys.repeating).toBe(true);
  await act(async () => flushFrame());
  expect(dispatch).toHaveBeenCalledExactlyOnceWith(key('k'));
  await act(async () => vi.advanceTimersByTime(250)); expect(keys.repeating).toBe(false);
});

it('rejects queued motions when focus changes synchronously before React commits', async () => {
  await act(async () => root.render(<Probe />));
  await act(async () => keys.onHardwareKey(key('j')));
  context = { ...context, pane: 'files' };
  await act(async () => flushFrame()); expect(dispatch).not.toHaveBeenCalled();
  await act(async () => keys.onHardwareKey(key('j')));
  context = { ...context, scope: 'other-session' };
  await act(async () => flushFrame()); expect(dispatch).not.toHaveBeenCalled();
});

it('cancels queued frames on owner changes and leaves captured handlers inert after unmount', async () => {
  await act(async () => root.render(<Probe />));
  await act(async () => keys.onHardwareKey(key('j')));
  await act(async () => root.render(<Probe owner="session:files" />));
  expect(frames.size).toBe(0); expect(keys.repeating).toBe(false);
  const captured = keys.onHardwareKey;
  await act(async () => root.unmount());
  captured(key('j')); flushFrame();
  expect(dispatch).not.toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0);
});

it.each(['w', 'W', 'b', 'B', 'e', 'E'])('advances real transcript word motion %s across held-key frames', async value => {
  const { createTranscriptBuffer, createTranscriptVimState, handleTranscriptKey } = await import('../transcript/transcriptVim');
  const buffer = createTranscriptBuffer([{ id: 'words', role: 'assistant', text: 'one two three four five six seven' }]);
  let state = createTranscriptVimState(buffer);
  const column = value.toLowerCase() === 'b' ? 28 : 0;
  state = { ...state, cursor: { row: 0, column }, desiredColumn: column, followTail: false };
  dispatch.mockImplementation(event => { state = handleTranscriptKey(buffer, state, event).state; });
  await act(async () => root.render(<Probe />));
  const positions: number[] = [];
  for (let index = 0; index < 3; index++) {
    await act(async () => keys.onHardwareKey(key(value)));
    expect(keys.repeating).toBe(true);
    await act(async () => flushFrame());
    positions.push(state.cursor.column);
  }
  expect(new Set(positions).size).toBe(3);
  expect(value.toLowerCase() === 'b' ? positions[2]! < column : positions[2]! > column).toBe(true);
  dispatch.mockReset();
});

it('drops queued word and search motions after scope/focus changes or a pending command', async () => {
  await act(async () => root.render(<Probe />));
  for (const value of ['w', 'b', 'e', 'n', 'N']) {
    context = { pane: 'transcript', pending: '', commandLineActive: false, scope: 'session' };
    await act(async () => keys.onHardwareKey(key(value)));
    context = { ...context, scope: 'other-session' };
    await act(async () => flushFrame());
    context = { ...context, scope: 'session' };
    await act(async () => keys.onHardwareKey(key(value)));
    context = { ...context, pane: 'files' };
    await act(async () => flushFrame());
    context = { ...context, pane: 'transcript' };
    await act(async () => keys.onHardwareKey(key(value)));
    context = { ...context, pending: 'y' };
    await act(async () => flushFrame());
  }
  expect(dispatch).not.toHaveBeenCalled();
});

it.each(['transcript', 'prompt', 'projects', 'files'] as const)('dispatches held G only once in %s', async pane => {
  context = { ...context, pane };
  await act(async () => root.render(<Probe />));
  const initial = { ...key('g'), shift: true, isRepeat: false };
  await act(async () => keys.onHardwareKey(initial));
  for (let index = 0; index < 4; index++) {
    await act(async () => keys.onHardwareKey({ ...initial, isRepeat: true }));
    await act(async () => flushFrame());
  }
  expect(dispatch).toHaveBeenCalledExactlyOnceWith(initial);
  expect(keys.repeating).toBe(false);
});
