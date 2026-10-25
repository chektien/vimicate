// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { WorkspaceProject } from './workspaceTypes';
vi.mock('../storage/workspaceStore', () => ({ loadValue: async () => null, saveValue: async () => {} }));
import { useProjectRailController } from './useProjectRailController';

const parent: WorkspaceProject = { id: 'example-research', sessionKey: 'root', name: 'Example Research', path: '', branch: '', starred: false, threadCount: 2, state: 'idle', kind: 'project', rootSessionKey: 'root' };
const child: WorkspaceProject = { ...parent, id: 'durable-child', sessionKey: 'child', name: 'example review', kind: 'thread', rootSessionKey: 'root', threadCount: 0 };
const projects = [parent, child];
const activate = vi.fn();
let root: Root, node: HTMLDivElement, rail: ReturnType<typeof useProjectRailController>;
function Probe({ rows, selected }: { rows: WorkspaceProject[]; selected: string }) {
  rail = useProjectRailController(rows, selected, activate, () => {});
  return null;
}
const render = (rows: WorkspaceProject[], selected: string) => act(async () => root.render(<Probe rows={rows} selected={selected} />));
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); activate.mockClear();
  node = document.createElement('div'); document.body.append(node); root = createRoot(node);
});
afterEach(async () => { await act(async () => root.unmount()); node.remove(); vi.unstubAllGlobals(); });

it('waits for the registry before placing a restored child cursor, then Enter activates that child', async () => {
  await render([], '');
  await render([], child.sessionKey);
  await render(projects, child.sessionKey);
  expect(rail.focusedKey).toBe(child.sessionKey);
  await act(async () => rail.handleKey({ key: 'enter', shift: false, control: false, option: false, command: false }, () => {}));
  expect(activate).toHaveBeenCalledExactlyOnceWith(child.sessionKey);
});

it('keeps deliberate browsing on a sibling/root through ordinary session refreshes', async () => {
  await render(projects, child.sessionKey);
  await act(async () => rail.handleKey({ key: 'k', shift: false, control: false, option: false, command: false }, () => {}));
  expect(rail.focusedKey).toBe(parent.sessionKey);
  await render(projects.map(row => ({ ...row, updatedAt: 1234 })), child.sessionKey);
  expect(rail.focusedKey).toBe(parent.sessionKey);
  expect(activate).not.toHaveBeenCalled();
});

it('moves the cursor to an externally restored/rebound selection even when the old cursor still exists', async () => {
  await render(projects, parent.sessionKey);
  await render(projects, child.sessionKey);
  expect(rail.focusedKey).toBe(child.sessionKey);
  const rebound = { ...child, sessionKey: 'new-binding' };
  await render([...projects, rebound], rebound.sessionKey);
  expect(rail.focusedKey).toBe(rebound.sessionKey);
  expect(activate).not.toHaveBeenCalled();
});

it('uses a collapsed parent only as a visible cursor without activating or expanding it', async () => {
  await render(projects, parent.sessionKey);
  await act(async () => rail.toggleFold(parent.sessionKey, 'collapse'));
  await render(projects, child.sessionKey);
  expect(rail.focusedKey).toBe(parent.sessionKey);
  expect(rail.collapsedRootKeys.has(parent.sessionKey)).toBe(true);
  expect(activate).not.toHaveBeenCalled();
});

it('recovers the visible selected child when a browsing row disappears', async () => {
  const sibling = { ...child, id: 'sibling', sessionKey: 'sibling' };
  await render([...projects, sibling], child.sessionKey);
  await act(async () => rail.setFocusedKey(sibling.sessionKey));
  await render(projects, child.sessionKey);
  expect(rail.focusedKey).toBe(child.sessionKey);
});

it('closes with plain q, but not modified q or shifted Q', async () => {
  await render(projects, child.sessionKey);
  const close = vi.fn();
  const key = (key: string, modifiers: { control?: boolean; command?: boolean; option?: boolean; shift?: boolean } = {}) =>
    rail.handleKey({ key, shift: false, control: false, option: false, command: false, ...modifiers }, close);
  await act(async () => { key('q', { control: true }); key('q', { command: true }); key('q', { option: true }); key('q', { shift: true }); });
  expect(close).not.toHaveBeenCalled();
  await act(async () => key('g'));
  await act(async () => key('q'));
  expect(close).toHaveBeenCalledTimes(1);
  expect(rail.focusedKey).toBe(child.sessionKey);
  await act(async () => key('g'));
  await act(async () => key('g'));
  expect(rail.focusedKey).toBe(parent.sessionKey);
});
