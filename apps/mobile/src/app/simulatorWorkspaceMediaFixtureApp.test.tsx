// @vitest-environment jsdom
import React, { act, useLayoutEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppShellFixtureProps } from './appShellFixtures';

const probe = vi.hoisted(() => ({ props: {} as AppShellFixtureProps }));
const lifecycle = vi.hoisted(() => ({
  calls: [] as string[],
  listener: undefined as ((state: string) => void) | undefined,
  rejectSeed: false,
}));
vi.mock('react-native', async () => {
  const { createElement } = await import('react');
  return {
    AppState: {
      currentState: 'active',
      addEventListener: (_event: string, listener: (state: string) => void) => {
        lifecycle.listener = listener;
        return { remove: () => { lifecycle.calls.push('remove-listener'); } };
      },
    },
    View: ({ children, accessibilityLabel }: { children?: React.ReactNode; accessibilityLabel?: string }) => createElement('div', { 'aria-label': accessibilityLabel }, children),
    Text: ({ children, accessibilityLabel }: { children?: React.ReactNode; accessibilityLabel?: string }) => createElement('span', { 'aria-label': accessibilityLabel }, children),
    Pressable: ({ children, accessibilityLabel, accessibilityState, onPress }: { children?: React.ReactNode; accessibilityLabel?: string; accessibilityState?: { selected?: boolean }; onPress?: () => void }) => createElement('button', { 'aria-label': accessibilityLabel, 'aria-pressed': accessibilityState?.selected, onClick: onPress }, children),
    StyleSheet: { create: (styles: unknown) => styles },
  };
});
vi.mock('../storage/workspaceStore', () => ({
  setWorkspacePersistenceActive: (active: boolean) => { lifecycle.calls.push(`active:${active}`); },
  saveDraft: (key: string) => {
    lifecycle.calls.push(`save:${key}`);
    return lifecycle.rejectSeed ? Promise.reject(new Error('synthetic reset failure')) : Promise.resolve();
  },
}));
vi.mock('react-native-safe-area-context', async () => {
  const { createElement } = await import('react');
  return { SafeAreaView: ({ children }: { children?: React.ReactNode }) => createElement('section', null, children) };
});
vi.mock('./AppShell', () => ({ AppShell: (props: AppShellFixtureProps) => { useLayoutEffect(() => { probe.props = props; }); return null; } }));

import { SimulatorWorkspaceMediaFixtureApp } from './simulatorWorkspaceMediaFixtureApp';

let root: Root;
let container: HTMLDivElement;

async function select(label: string) {
  const button = container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
  expect(button).not.toBeNull();
  await act(async () => { button!.click(); });
}

describe('deterministic workspace/media QA payload driver', () => {
  beforeEach(async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    lifecycle.calls = [];
    lifecycle.listener = undefined;
    lifecycle.rejectSeed = false;
    probe.props = {};
    container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container);
  });
  afterEach(async () => { await act(async () => { root.unmount(); }); container.remove(); vi.unstubAllGlobals(); });

  it('publishes only the explicitly selected raw payload milestone', async () => {
    await act(async () => { root.render(<SimulatorWorkspaceMediaFixtureApp />); });
    expect(lifecycle.calls.slice(0, 3)).toEqual([
      'active:true',
      'save:fixture-workspace-media-a',
      'save:fixture-workspace-media-b',
    ]);
    expect(probe.props.fixtureProjectRailStartup).toEqual({ paired: true, registryReady: false });
    expect(probe.props.fixtureProjectRail).toBeUndefined();
    expect(probe.props.fixtureMessages).toBeUndefined();

    await select('QA phase ready');
    expect(probe.props.fixtureProjectRail?.selectedKey).toBe('fixture-workspace-media-a');
    expect(probe.props.fixtureMessages?.[0]?.approval).toMatchObject({ resolved: false });
    expect(probe.props.fixtureMessages?.find(row => row.id === 'simwm-dynamic-media')?.attachments?.[0]?.filename).toBe('obsolete-attempt.png');

    await select('QA phase decode');
    expect(probe.props.fixtureMessages?.find(row => row.id === 'simwm-dynamic-media')?.attachments?.[0]?.filename).toBe('managed-remount.png');
    await select('QA phase expiry');
    expect(probe.props.fixtureMessages?.[0]?.approval).toMatchObject({ resolved: true, outcome: 'expired' });
    await select('QA phase beta');
    expect(probe.props.fixtureProjectRail?.selectedKey).toBe('fixture-workspace-media-b');
    await select('QA phase four page');
    expect(probe.props.fixtureMessages?.find(row => row.id === 'simwm-dynamic-media')?.attachments).toHaveLength(4);
    await select('QA phase alpha return');
    expect(probe.props.fixtureProjectRail?.selectedKey).toBe('fixture-workspace-media-a');
    expect(probe.props.fixtureMessages?.find(row => row.id === 'simwm-dynamic-media')?.attachments).toHaveLength(4);
  });

  it('forwards scene activity and reports reset failure instead of mounting stale drafts', async () => {
    lifecycle.rejectSeed = true;
    await act(async () => { root.render(<SimulatorWorkspaceMediaFixtureApp />); });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(container.querySelector('[aria-label="SIMWM-FIXTURE-ROOT initialization failed: synthetic reset failure"]')).not.toBeNull();
    expect(probe.props.fixtureProjectRail).toBeUndefined();

    await act(async () => { lifecycle.listener?.('background'); });
    expect(lifecycle.calls.at(-1)).toBe('active:false');
  });
});
