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
  AppState: { currentState: 'active', addEventListener: () => ({ remove() {} }) },
  PanResponder: { create: (handlers: PanHandlers) => { mocks.responders.push(handlers); return { panHandlers: handlers }; } },
}));
vi.mock('../storage/workspaceStore', () => ({ loadValue: mocks.loadValue, saveValue: mocks.saveValue }));
import { useWorkspaceColumns, WORKSPACE_COLUMN_WIDTHS_KEY } from './useWorkspaceColumns';

let root: Root;
let node: HTMLDivElement;
let columns: ReturnType<typeof useWorkspaceColumns>;

function Probe({ width = 1024, projectsVisible = true, filesVisible = true }) {
  columns = useWorkspaceColumns({ width, projectsVisible, filesVisible });
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

it('uses opposite physical drag signs for the left and right side columns and persists only on release', async () => {
  await act(async () => root.render(<Probe />));
  const left = mocks.responders[0];
  const right = mocks.responders[1];
  const leftStart = columns.projectsWidth;
  left?.onPanResponderGrant?.({}, { stateID: 1 });
  await act(async () => left?.onPanResponderMove?.({}, { stateID: 1, dx: 30 }));
  expect(columns.projectsWidth).toBe(leftStart + 30);
  const filesHeldDuringLeftDrag = columns.filesWidth;
  expect(mocks.saveValue).not.toHaveBeenCalled();
  await act(async () => left?.onPanResponderRelease?.({}, { stateID: 1, dx: 30 }));
  expect(mocks.saveValue).toHaveBeenCalledTimes(1);

  const rightStart = columns.filesWidth;
  expect(rightStart).toBe(filesHeldDuringLeftDrag);
  right?.onPanResponderGrant?.({}, { stateID: 1 });
  await act(async () => right?.onPanResponderMove?.({}, { stateID: 1, dx: 30 }));
  expect(columns.filesWidth).toBe(rightStart - 30);
  expect(mocks.saveValue).toHaveBeenCalledTimes(1);
  await act(async () => right?.onPanResponderRelease?.({}, { stateID: 1, dx: 30 }));
  expect(mocks.saveValue).toHaveBeenCalledTimes(2);
  expect(mocks.saveValue.mock.calls[1]?.[0]).toBe(WORKSPACE_COLUMN_WIDTHS_KEY);
});

it('does not normalize preferences or write storage when a divider is only tapped', async () => {
  await act(async () => root.render(<Probe width={820} />));
  const left = mocks.responders[0];
  left?.onPanResponderGrant?.({}, { stateID: 1 });
  await act(async () => left?.onPanResponderRelease?.({}, { stateID: 1, dx: 0 }));
  expect(mocks.saveValue).not.toHaveBeenCalled();

  await act(async () => root.render(<Probe width={1024} />));
  expect(columns.projectsWidth).toBe(224);
  expect(columns.filesWidth).toBeCloseTo(820 * 0.36);
});

it('restores the pre-drag preferences when travel returns to zero or responder ownership is cancelled', async () => {
  await act(async () => root.render(<Probe />));
  const left = mocks.responders[0];
  const startingProjects = columns.projectsWidth;
  left?.onPanResponderGrant?.({}, { stateID: 1 });
  await act(async () => left?.onPanResponderMove?.({}, { stateID: 1, dx: 35 }));
  expect(columns.projectsWidth).toBe(startingProjects + 35);
  await act(async () => left?.onPanResponderRelease?.({}, { stateID: 1, dx: 1 }));
  expect(columns.projectsWidth).toBe(startingProjects);
  expect(mocks.saveValue).not.toHaveBeenCalled();

  left?.onPanResponderGrant?.({}, { stateID: 1 });
  await act(async () => left?.onPanResponderMove?.({}, { stateID: 1, dx: -30 }));
  await act(async () => left?.onPanResponderTerminate?.({}, { stateID: 1 }));
  expect(columns.projectsWidth).toBe(startingProjects);
  expect(mocks.saveValue).not.toHaveBeenCalled();
});

it('holds the opposite divider still and clamps expansion before the center minimum', async () => {
  await act(async () => root.render(<Probe width={820} />));
  const left = mocks.responders[0];
  const before = { projects: columns.projectsWidth, files: columns.filesWidth };
  left?.onPanResponderGrant?.({}, { stateID: 1 });
  await act(async () => left?.onPanResponderMove?.({}, { stateID: 1, dx: 60 }));
  expect(columns.projectsWidth).toBeCloseTo(before.projects);
  expect(columns.filesWidth).toBeCloseTo(before.files);
  expect(columns.conversationWidth).toBeGreaterThanOrEqual(300);
});

it('restores persisted preferences when no local interaction wins the race', async () => {
  mocks.loadValue.mockResolvedValue('{"projects":280,"files":500}');
  await act(async () => root.render(<Probe width={1400} />));
  expect(columns.projectsWidth).toBe(280);
  expect(columns.filesWidth).toBe(500);
});

it('restores persisted preferences but never lets late hydration overwrite a manually resized side', async () => {
  let resolveLoad: ((value: string | null) => void) | undefined;
  mocks.loadValue.mockReturnValue(new Promise((resolve) => { resolveLoad = resolve; }));
  await act(async () => root.render(<Probe />));
  const left = mocks.responders[0];
  left?.onPanResponderGrant?.({}, { stateID: 1 });
  await act(async () => left?.onPanResponderRelease?.({}, { stateID: 1, dx: 40 }));
  const manualProjectsWidth = columns.projectsWidth;

  await act(async () => resolveLoad?.('{"projects":180,"files":300}'));
  expect(columns.projectsWidth).toBe(manualProjectsWidth);
  expect(columns.filesWidth).toBeCloseTo(1024 * 0.36);
});

it('ignores hydration that resolves after unmount', async () => {
  let resolveLoad: ((value: string | null) => void) | undefined;
  mocks.loadValue.mockReturnValue(new Promise((resolve) => { resolveLoad = resolve; }));
  await act(async () => root.render(<Probe />));
  const captured = mocks.responders[0];
  await act(async () => root.unmount());
  await act(async () => resolveLoad?.('{"projects":180,"files":300}'));
  captured?.onPanResponderGrant?.({}, { stateID: 1 });
  captured?.onPanResponderMove?.({}, { stateID: 1, dx: 40 });
  captured?.onPanResponderRelease?.({}, { stateID: 1, dx: 40 });
  expect(mocks.saveValue).not.toHaveBeenCalled();
});
