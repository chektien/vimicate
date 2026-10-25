// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

vi.mock('expo-application', () => ({ nativeApplicationVersion: '0.1.0', nativeBuildVersion: '1' }));
vi.mock('expo-updates', () => ({ updateId: null, isEmbeddedLaunch: true }));
vi.mock('react-native', () => ({
  View: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  Text: ({ children, style, ellipsizeMode }: { children?: React.ReactNode; style?: unknown; ellipsizeMode?: string }) =>
    <span data-style={JSON.stringify(style)} data-ellipsize={ellipsizeMode}>{children}</span>,
  StyleSheet: { create: (styles: unknown) => styles },
}));

import { WorkspaceHeader } from './WorkspaceHeader';

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
beforeEach(() => { vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); container = document.createElement('div'); document.body.append(container); root = createRoot(container); });
afterEach(async () => { await act(async () => root.unmount()); container.remove(); });

it.each([true, false])('lets the title and model identity use spare width at compact=%s', async (compact) => {
  await act(async () => root.render(<WorkspaceHeader compact={compact} project={{
    id: 'project', kind: 'project', name: 'example-project', agentRuntime: 'claude-cli',
    model: 'claude-opus-5-5', thinkingLevel: 'high',
  } as Parameters<typeof WorkspaceHeader>[0]['project']} />));

  const title = [...container.querySelectorAll('span')].find(node => node.textContent === 'example-project')!;
  const identity = [...container.querySelectorAll('span')].find(node => node.textContent === 'claude-cli · claude-opus-5-5 · high')!;
  const titleStyle = Object.assign({}, ...JSON.parse(title.dataset.style!));
  const identityStyle = Object.assign({}, ...JSON.parse(identity.dataset.style!));
  expect(titleStyle.maxWidth).toBeUndefined();
  expect(titleStyle.flex).toBeUndefined();
  expect(titleStyle.flexShrink).toBe(1);
  expect(titleStyle.minWidth).toBeGreaterThanOrEqual(80);
  expect(identityStyle.maxWidth).toBeUndefined();
  expect(identityStyle.flexShrink).toBe(1);
  expect(identityStyle.minWidth).toBeGreaterThanOrEqual(120);
  expect(identity.dataset.ellipsize).toBe('head');
});
