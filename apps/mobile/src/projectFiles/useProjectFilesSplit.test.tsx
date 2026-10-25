// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

type PanHandlers = Record<string, (...args: any[]) => unknown>;
const mocks = vi.hoisted(() => ({
  responders: [] as PanHandlers[],
  loadValue: vi.fn<(key: string) => Promise<string | null>>(),
  saveValue: vi.fn<(key: string, value: string) => Promise<void>>(),
}));
vi.mock('react-native', () => ({
  PanResponder: { create: (handlers: PanHandlers) => { mocks.responders.push(handlers); return { panHandlers: handlers }; } },
}));
vi.mock('../storage/workspaceStore', () => ({ loadValue: mocks.loadValue, saveValue: mocks.saveValue }));
import { useProjectFilesSplit, PROJECT_FILES_SPLIT_KEY } from './useProjectFilesSplit';

let root: Root;
let node: HTMLDivElement;
let split: ReturnType<typeof useProjectFilesSplit>;

function Probe({ active = true }: { active?: boolean }) {
  split = useProjectFilesSplit(active);
  return null;
}

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  mocks.responders.length = 0;
  mocks.loadValue.mockReset().mockResolvedValue(null);
  mocks.saveValue.mockReset().mockResolvedValue(undefined);
  node = document.createElement('div');
  document.body.append(node);
  root = createRoot(node);
});

afterEach(async () => {
  await act(async () => root.unmount());
  node.remove();
  vi.unstubAllGlobals();
});

async function renderAt(height = 500) {
  await act(async () => root.render(<Probe />));
  await act(async () => split.onLayoutHeight(height));
  return mocks.responders[0]!;
}

it('restores its global ratio independent of project scope', async () => {
  mocks.loadValue.mockResolvedValue('{"listRatio":0.55}');
  await renderAt();
  expect(mocks.loadValue).toHaveBeenCalledWith(PROJECT_FILES_SPLIT_KEY);
  expect(split.listRatio).toBe(0.55);
  expect(split.listHeight).toBeCloseTo(265.1);
});

it('updates throughout a drag but writes storage only once on release', async () => {
  const responder = await renderAt();
  responder.onPanResponderGrant?.();
  await act(async () => responder.onPanResponderMove?.({}, { dy: 20 }));
  await act(async () => responder.onPanResponderMove?.({}, { dy: 40 }));
  expect(split.listHeight).toBeCloseTo(184.6);
  expect(mocks.saveValue).not.toHaveBeenCalled();
  await act(async () => responder.onPanResponderRelease?.({}, { dy: 40 }));
  expect(mocks.saveValue).toHaveBeenCalledTimes(1);
  expect(mocks.saveValue.mock.calls[0]?.[0]).toBe(PROJECT_FILES_SPLIT_KEY);
});

it('does not let late restoration overwrite a newer user drag', async () => {
  let resolveLoad: ((value: string | null) => void) | undefined;
  mocks.loadValue.mockReturnValue(new Promise((resolve) => { resolveLoad = resolve; }));
  const responder = await renderAt();
  responder.onPanResponderGrant?.();
  await act(async () => responder.onPanResponderMove?.({}, { dy: 40 }));
  const draggedRatio = split.listRatio;
  await act(async () => resolveLoad?.('{"listRatio":0.7}'));
  expect(split.listRatio).toBe(draggedRatio);
  await act(async () => responder.onPanResponderRelease?.({}, { dy: 40 }));
  expect(split.listRatio).toBe(draggedRatio);
});

it('defers restoration during a tap and applies it when the gesture cancels', async () => {
  let resolveLoad: ((value: string | null) => void) | undefined;
  mocks.loadValue.mockReturnValue(new Promise((resolve) => { resolveLoad = resolve; }));
  const responder = await renderAt();
  responder.onPanResponderGrant?.();
  await act(async () => resolveLoad?.('{"listRatio":0.6}'));
  expect(split.listRatio).toBe(0.3);
  await act(async () => responder.onPanResponderTerminate?.());
  expect(split.listRatio).toBe(0.6);
  expect(mocks.saveValue).not.toHaveBeenCalled();
});

it('cancels an in-flight drag when the Files pane closes and retains the preference on reopen', async () => {
  const responder = await renderAt();
  responder.onPanResponderGrant?.();
  await act(async () => responder.onPanResponderMove?.({}, { dy: 40 }));
  expect(split.listRatio).not.toBe(0.3);
  await act(async () => root.render(<Probe active={false} />));
  expect(split.listRatio).toBe(0.3);
  expect(mocks.saveValue).not.toHaveBeenCalled();
  await act(async () => root.render(<Probe active />));
  expect(split.listRatio).toBe(0.3);
});

it('ignores restoration after unmount', async () => {
  let resolveLoad: ((value: string | null) => void) | undefined;
  mocks.loadValue.mockReturnValue(new Promise((resolve) => { resolveLoad = resolve; }));
  await act(async () => root.render(<Probe />));
  await act(async () => root.unmount());
  await act(async () => resolveLoad?.('{"listRatio":0.7}'));
  expect(mocks.saveValue).not.toHaveBeenCalled();
});
