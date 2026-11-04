// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import type { WorkspaceProject } from './workspaceTypes';
const probe = vi.hoisted(() => ({ enabled: [] as boolean[], viewable: undefined as undefined | ((args: unknown) => void) }));
vi.mock('./useProjectRunPulse', () => ({ useProjectRunPulse: (enabled: boolean) => { probe.enabled.push(enabled); return 1; } }));
vi.mock('../lifecycle/useActiveInterval', () => ({ useActiveInterval: () => {} }));
vi.mock('./ProjectRunDot', () => ({ ProjectRunDot: () => null }));
vi.mock('react-native', async () => {
  const { createElement } = await import('react');
  const Element = ({ children }: { children?: React.ReactNode }) => createElement('div', {}, children);
  return { View: Element, Text: Element, Pressable: Element, StyleSheet: { create: (s: unknown) => s },
    FlatList: ({ onViewableItemsChanged }: { onViewableItemsChanged: (args: unknown) => void }) => { probe.viewable = onViewableItemsChanged; return null; } };
});
import { ProjectRail } from './ProjectRail';

it('animates only visible running cards, not a closed drawer or offscreen run', async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const node = document.createElement('div'); const root = createRoot(node);
  const base: WorkspaceProject = { id: 'run', sessionKey: 'run', name: 'run', path: '', branch: '', starred: false, threadCount: 1, state: 'running', runPhase: 'running' };
  const idle: WorkspaceProject = { ...base, id: 'idle', sessionKey: 'idle', runPhase: 'completed' };
  const noop = () => {};
  const render = async (visible: boolean, projects = [base, idle]) => act(async () => root.render(<ProjectRail projects={projects} visible={visible} emptyLabel="empty" activeKey="run" focusedKey="" focused={false} fontScale={1} reflowSuppressed={false} sortMode="manual" collapsedRootKeys={new Set()} onToggleSort={noop} onSelect={noop} onToggleFold={noop} onToggleStar={noop} onRefresh={noop} />));
  const show = async (items: WorkspaceProject[]) => act(async () => probe.viewable!({ viewableItems: items.map((item, index) => ({ item, index, isViewable: true })) }));
  try {
    await render(true); expect(probe.enabled.at(-1)).toBe(false);
    await show([base]); expect(probe.enabled.at(-1)).toBe(true);
    await render(false); expect(probe.enabled.at(-1)).toBe(false);
    await render(true); expect(probe.enabled.at(-1)).toBe(true);
    await show([idle]); expect(probe.enabled.at(-1)).toBe(false);
    await show([base]); await render(true, [{ ...base, runPhase: 'needs-user' }, idle]);
    expect(probe.enabled.at(-1)).toBe(false);
  } finally { await act(async () => root.unmount()); }
});
