// @vitest-environment jsdom
import React, { act, useLayoutEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppShellFixtureProps } from './appShellFixtures';

const probe = vi.hoisted(() => ({
  active: [] as boolean[],
  saved: [] as Array<[string, string]>,
  finishReset: undefined as (() => void) | undefined,
  shell: undefined as AppShellFixtureProps | undefined,
}));

vi.mock('react-native', async () => {
  const { createElement } = await import('react');
  return {
    View: ({ children, accessibilityLabel }: { children?: React.ReactNode; accessibilityLabel?: string }) => createElement('div', { 'aria-label': accessibilityLabel }, children),
    Text: ({ children }: { children?: React.ReactNode }) => createElement('span', null, children),
  };
});
vi.mock('../storage/workspaceStore', () => ({
  setWorkspacePersistenceActive: (active: boolean) => { probe.active.push(active); },
  saveDraft: (sessionKey: string, body: string) => {
    probe.saved.push([sessionKey, body]);
    return new Promise<void>((resolve) => { probe.finishReset = resolve; });
  },
}));
vi.mock('./AppShell', () => ({
  AppShell: (props: AppShellFixtureProps) => {
    useLayoutEffect(() => { probe.shell = props; });
    return null;
  },
}));

import {
  SIMULATOR_TOUCH_FIXTURE_MODE,
  SIMULATOR_TOUCH_FIXTURE_ROOT,
  SIMULATOR_TOUCH_SESSION_KEY,
  SimulatorTouchFixtureApp,
} from './simulatorTouchFixtures';

let container: HTMLDivElement;
let root: Root;

describe('isolated simulator touch fixture', () => {
  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    probe.active = [];
    probe.saved = [];
    probe.finishReset = undefined;
    probe.shell = undefined;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });
  afterEach(async () => {
    await act(async () => { root.unmount(); });
    container.remove();
    vi.unstubAllGlobals();
  });

  it('clears only its own durable draft before mounting the real AppShell owner', async () => {
    expect(SIMULATOR_TOUCH_FIXTURE_MODE).toBe('qa-touch-v1');
    await act(async () => { root.render(<SimulatorTouchFixtureApp />); });
    expect(probe.active).toEqual([true]);
    expect(probe.saved).toEqual([[SIMULATOR_TOUCH_SESSION_KEY, '']]);
    expect(probe.shell).toBeUndefined();
    expect(container.textContent).toContain(SIMULATOR_TOUCH_FIXTURE_ROOT);

    await act(async () => { probe.finishReset?.(); });
    expect(probe.shell?.fixtureProjectRail?.selectedKey).toBe(SIMULATOR_TOUCH_SESSION_KEY);
    expect(probe.shell?.fixtureMessages?.[0]?.text).toContain(SIMULATOR_TOUCH_FIXTURE_ROOT);
    expect(probe.shell?.fixtureRunActive).toBeUndefined();
  });
});
