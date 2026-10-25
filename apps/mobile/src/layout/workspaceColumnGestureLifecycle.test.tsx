// @vitest-environment jsdom
import React, { act, startTransition, Suspense } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  loadValue: vi.fn<() => Promise<string | null>>(),
  listeners: new Set<(state: string) => void>(),
  saveValue: vi.fn<(key: string, value: string) => Promise<void>>(),
}));
vi.mock('react-native', async () => {
  // Execute the installed native gesture accumulator, not a callback-only mock.
  // @ts-expect-error Node is provided by the test runner.
  const { createRequire } = await import('node:module');
  // @ts-expect-error Node is provided by the test runner.
  const { readFileSync } = await import('node:fs');
  const require = createRequire(import.meta.url);
  const expoRequire = createRequire(require.resolve('expo/package.json'));
  const presetRequire = createRequire(expoRequire.resolve('babel-preset-expo'));
  const babel = expoRequire('@babel/core');
  const nativeRequire = createRequire(require.resolve('react-native/package.json'));
  const load = (name: string): any => {
    const path = nativeRequire.resolve(`./Libraries/Interaction/${name}.js`);
    const code = babel.transformSync(readFileSync(path, 'utf8'), {
      babelrc: false, configFile: false,
      plugins: [[presetRequire.resolve('babel-plugin-syntax-hermes-parser'), { parseLangTypes: 'flow' }], presetRequire.resolve('@babel/plugin-transform-flow-strip-types'), presetRequire.resolve('@babel/plugin-transform-modules-commonjs')],
    }).code;
    const module = { exports: {} };
    new Function('module', 'exports', 'require', code)(module, module.exports, (id: string) => {
      if (id === './TouchHistoryMath') return load('TouchHistoryMath');
      throw new Error(`Unexpected native dependency: ${id}`);
    });
    return module.exports;
  };
  return {
    PanResponder: load('PanResponder').default,
    AppState: { currentState: 'active', addEventListener: (_: string, listener: (state: string) => void) => {
      mocks.listeners.add(listener);
      return { remove: () => mocks.listeners.delete(listener) };
    } },
  };
});
vi.mock('../storage/workspaceStore', () => ({ loadValue: mocks.loadValue, saveValue: mocks.saveValue }));
import { useWorkspaceColumns } from './useWorkspaceColumns';

let root: Root;
let node: HTMLDivElement;
let columns: ReturnType<typeof useWorkspaceColumns>;
function Probe({ width = 1024, projectsVisible = true, filesVisible = true }) {
  columns = useWorkspaceColumns({ width, projectsVisible, filesVisible });
  return null;
}

// The renderer routes each native event through the current View props. This
// exposes a responder replacement instead of retaining old mock callbacks.
function finger(side: 'projects' | 'files') {
  let x = 400;
  let timestamp = 1;
  const handlers = () => side === 'projects' ? columns.leftDividerPanHandlers : columns.rightDividerPanHandlers;
  const event = (nextX: number) => {
    const previous = x;
    x = nextX;
    return {
      nativeEvent: { touches: [{}] },
      touchHistory: { numberActiveTouches: 1, indexOfSingleActiveTouch: 0, mostRecentTimeStamp: timestamp++, touchBank: [{
        touchActive: true, startPageX: 400, startPageY: 0, currentPageX: x, previousPageX: previous,
        currentPageY: 0, previousPageY: 0, currentTimeStamp: timestamp,
      }] },
    } as any;
  };
  return {
    grant: () => { const e = event(400); handlers().onStartShouldSetResponderCapture?.(e); handlers().onResponderGrant?.(e); },
    move: (dx: number) => handlers().onResponderMove?.(event(400 + dx)),
    release: () => handlers().onResponderRelease?.(event(x)),
    terminate: () => handlers().onResponderTerminate?.(event(x)),
  };
}

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  mocks.loadValue.mockReset().mockResolvedValue(null);
  mocks.saveValue.mockReset().mockResolvedValue(undefined);
  node = document.createElement('div'); document.body.append(node); root = createRoot(node);
});
afterEach(async () => { await act(async () => root.unmount()); node.remove(); vi.unstubAllGlobals(); });

it('cancels a drag on container geometry change without rebuilding native responders, then reacquires normally', async () => {
  await act(async () => root.render(<Probe />));
  const before = columns.projectsWidth;
  const nativeHandlers = columns.leftDividerPanHandlers;
  const left = finger('projects');
  await act(async () => { left.grant(); left.move(30); });
  expect(columns.projectsWidth).toBe(before + 30);
  expect(columns.leftDividerPanHandlers.onResponderTerminationRequest?.({} as any)).toBe(false);
  await act(async () => root.render(<Probe width={1023} />));
  expect(columns.projectsWidth).toBe(before);
  expect(columns.leftDividerPanHandlers).toBe(nativeHandlers);
  expect(columns.leftDividerPanHandlers.onResponderTerminationRequest?.({} as any)).toBe(true);
  await act(async () => { left.move(32); left.release(); });
  expect(columns.projectsWidth).toBe(before);
  expect(mocks.saveValue).not.toHaveBeenCalled();
  await act(async () => { left.grant(); left.move(20); left.release(); });
  expect(columns.projectsWidth).toBe(before + 20);
  expect(mocks.saveValue).toHaveBeenCalledTimes(1);
});

it('cancels when a pane hides and does not commit a late release after it returns', async () => {
  await act(async () => root.render(<Probe />));
  const before = columns.filesWidth;
  const right = finger('files');
  await act(async () => { right.grant(); right.move(30); });
  await act(async () => root.render(<Probe filesVisible={false} />));
  await act(async () => root.render(<Probe />));
  expect(columns.filesWidth).toBe(before);
  await act(async () => right.release());
  expect(columns.filesWidth).toBe(before);
  expect(mocks.saveValue).not.toHaveBeenCalled();
  await act(async () => { right.grant(); right.move(15); right.release(); });
  expect(columns.filesWidth).toBe(before - 15);
  expect(mocks.saveValue).toHaveBeenCalledTimes(1);
});

it('retires terminated callbacks so they cannot undo or persist the next divider drag', async () => {
  await act(async () => root.render(<Probe />));
  const before = columns.projectsWidth;
  const left = finger('projects'); const right = finger('files');
  await act(async () => { left.grant(); left.move(30); left.terminate(); });
  expect(columns.projectsWidth).toBe(before);
  await act(async () => { right.grant(); right.move(20); });
  const files = columns.filesWidth;
  await act(async () => { left.move(40); left.release(); left.terminate(); });
  expect(columns.projectsWidth).toBe(before);
  expect(columns.filesWidth).toBe(files);
  expect(mocks.saveValue).not.toHaveBeenCalled();
  await act(async () => right.release());
  expect(columns.filesWidth).toBe(files);
  expect(mocks.saveValue).toHaveBeenCalledTimes(1);
});

it('cancels suspended gestures and does not restore their authority on foreground', async () => {
  await act(async () => root.render(<Probe />));
  const before = columns.projectsWidth; const left = finger('projects');
  await act(async () => { left.grant(); left.move(30); });
  await act(async () => mocks.listeners.forEach((listener) => listener('inactive')));
  expect(columns.projectsWidth).toBe(before);
  await act(async () => mocks.listeners.forEach((listener) => listener('active')));
  await act(async () => { left.move(40); left.release(); });
  expect(columns.projectsWidth).toBe(before);
  expect(mocks.saveValue).not.toHaveBeenCalled();
  await act(async () => { left.grant(); left.move(20); left.release(); });
  expect(columns.projectsWidth).toBe(before + 20);
  expect(mocks.saveValue).toHaveBeenCalledTimes(1);
});

it('lets accessibility resizing retire a gesture without a late touch rollback', async () => {
  await act(async () => root.render(<Probe />));
  const before = columns.filesWidth; const right = finger('files');
  await act(async () => { right.grant(); right.move(30); });
  await act(async () => columns.resizeFiles(-1));
  const adjusted = columns.filesWidth;
  expect(adjusted).toBe(before - 24);
  await act(async () => { right.terminate(); right.release(); });
  expect(columns.filesWidth).toBe(adjusted);
  expect(mocks.saveValue).toHaveBeenCalledTimes(1);
});

it('rolls back the first divider before a new divider takes ownership, even within one native event batch', async () => {
  await act(async () => root.render(<Probe />));
  const before = { projects: columns.projectsWidth, files: columns.filesWidth };
  const left = finger('projects'); const right = finger('files');
  await act(async () => { left.grant(); left.move(30); });
  await act(async () => { right.grant(); right.move(20); right.release(); });
  expect(columns.projectsWidth).toBe(before.projects);
  expect(columns.filesWidth).toBe(before.files - 20);
  expect(mocks.saveValue).toHaveBeenCalledTimes(1);
});

it('tracks accumulated native travel and cleanly releases/reacquires both dividers across 18 ordinary drags', async () => {
  await act(async () => root.render(<Probe />));
  const before = { projects: columns.projectsWidth, files: columns.filesWidth };
  for (let index = 0; index < 18; index += 1) {
    const side = index % 2 ? 'files' : 'projects';
    const drag = finger(side);
    const start = side === 'projects' ? columns.projectsWidth : columns.filesWidth;
    await act(async () => { drag.grant(); drag.move(5); });
    await act(async () => drag.move(12));
    expect(side === 'projects' ? columns.projectsWidth : columns.filesWidth).toBeCloseTo(start + (side === 'projects' ? 12 : -12));
    await act(async () => drag.release());
    expect(mocks.saveValue).toHaveBeenCalledTimes(index + 1);
  }
  expect(columns.projectsWidth).toBe(before.projects + 108);
  expect(columns.filesWidth).toBeCloseTo(before.files - 108);
});

it('ignores fresh grants while suspended and all callbacks after disposal', async () => {
  await act(async () => root.render(<Probe />));
  const left = finger('projects');
  const captured = columns.leftDividerPanHandlers;
  await act(async () => mocks.listeners.forEach((listener) => listener('background')));
  await act(async () => { left.grant(); left.move(30); left.release(); columns.resizeProjects(1); });
  expect(mocks.saveValue).not.toHaveBeenCalled();
  await act(async () => root.unmount());
  expect(mocks.listeners.size).toBe(0);
  captured.onResponderGrant?.({ touchHistory: { touchBank: [], numberActiveTouches: 0 } } as any);
  captured.onResponderTerminate?.({} as any);
  captured.onResponderRelease?.({} as any);
  columns.resizeProjects(1);
  expect(mocks.saveValue).not.toHaveBeenCalled();
});

it('retires an untouched grant if preference hydration changes its starting geometry', async () => {
  let resolveLoad: (value: string) => void = () => undefined;
  mocks.loadValue.mockReturnValue(new Promise((resolve) => { resolveLoad = resolve; }));
  await act(async () => root.render(<Probe />));
  const left = finger('projects');
  await act(async () => left.grant());
  await act(async () => resolveLoad('{"projects":180,"files":300}'));
  expect(columns.projectsWidth).toBe(180);
  await act(async () => { left.move(20); left.release(); });
  expect(columns.projectsWidth).toBe(180);
  expect(mocks.saveValue).not.toHaveBeenCalled();
  await act(async () => { left.grant(); left.move(20); left.release(); });
  expect(columns.projectsWidth).toBe(200);
  expect(mocks.saveValue).toHaveBeenCalledTimes(1);
});

it('keeps native drag callbacks on committed geometry while a pane replacement suspends', async () => {
  const pending = new Promise<never>(() => {});
  let attempted = false;
  function Block({ blocked }: { blocked: boolean }) {
    if (blocked) { attempted = true; throw pending; }
    return null;
  }
  function Scene({ blocked = false }) {
    return <Suspense fallback={null}>
      <Probe width={blocked ? 400 : 1024} projectsVisible={!blocked} />
      <Block blocked={blocked} />
    </Suspense>;
  }
  await act(async () => root.render(<Scene />));
  const before = columns.projectsWidth;
  const left = finger('projects');
  await act(async () => { left.grant(); left.move(20); });
  await act(async () => startTransition(() => root.render(<Scene blocked />)));
  expect(attempted).toBe(true);
  await act(async () => { left.move(40); left.release(); });
  expect(mocks.saveValue).toHaveBeenCalledTimes(1);
  expect(JSON.parse(mocks.saveValue.mock.calls[0]![1]).projects).toBe(before + 40);
  await act(async () => root.render(<Scene />));
  expect(columns.projectsWidth).toBe(before + 40);
});
