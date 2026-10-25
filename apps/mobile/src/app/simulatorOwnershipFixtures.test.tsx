// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => ({
  calls: [] as string[],
  appStateListener: undefined as ((state: string) => void) | undefined,
  rejectSeed: false,
}));

vi.mock('react-native', async () => {
  const { createElement } = await import('react');
  return {
    AppState: {
      currentState: 'active',
      addEventListener: (_event: string, listener: (state: string) => void) => {
        fixture.appStateListener = listener;
        return { remove: () => { fixture.calls.push('remove-listener'); } };
      },
    },
    Pressable: ({ children }: { children?: React.ReactNode }) => createElement('button', null, children),
    ScrollView: ({ children }: { children?: React.ReactNode }) => createElement('div', null, children),
    StyleSheet: { create: (styles: unknown) => styles },
    Text: ({ children, accessibilityLabel }: { children?: React.ReactNode; accessibilityLabel?: string }) => createElement('span', { 'aria-label': accessibilityLabel }, children),
    View: ({ children }: { children?: React.ReactNode }) => createElement('div', null, children),
  };
});
vi.mock('react-native-safe-area-context', async () => {
  const { createElement } = await import('react');
  return { SafeAreaView: ({ children }: { children?: React.ReactNode }) => createElement('main', null, children) };
});
vi.mock('expo-crypto', () => ({
  CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
  digestStringAsync: async () => 'fixture-digest',
}));
vi.mock('expo-device', () => ({
  deviceName: 'simulator fixture',
  modelName: 'simulator fixture',
  osName: 'iOS',
  osVersion: 'fixture',
}));
vi.mock('expo', () => ({ requireOptionalNativeModule: () => null }));
vi.mock('../storage/workspaceStore', () => ({
  setWorkspacePersistenceActive: (active: boolean) => { fixture.calls.push(`active:${active}`); },
  saveDraft: (key: string) => {
    fixture.calls.push(`save:${key}`);
    if (fixture.rejectSeed) return Promise.reject(new Error('synthetic SQLite failure'));
    return new Promise<void>(() => undefined);
  },
}));

let SimulatorOwnershipFixtureApp: typeof import('./simulatorOwnershipFixtures').SimulatorOwnershipFixtureApp;

describe('simulator ownership persistence lifecycle', () => {
  let root: Root;
  let container: HTMLDivElement;
  let unmounted: boolean;

  beforeAll(async () => {
    vi.stubGlobal('__DEV__', false);
    ({ SimulatorOwnershipFixtureApp } = await import('./simulatorOwnershipFixtures'));
  });

  afterAll(() => { vi.unstubAllGlobals(); });

  beforeEach(() => {
    fixture.calls = [];
    fixture.appStateListener = undefined;
    fixture.rejectSeed = false;
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    unmounted = false;
  });

  afterEach(async () => {
    if (!unmounted) await act(async () => { root.unmount(); });
    container.remove();
    delete (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT;
  });

  it('activates the production persistence queue before seeding and suspends it on cleanup', async () => {
    await act(async () => { root.render(<SimulatorOwnershipFixtureApp />); });
    expect(fixture.calls.slice(0, 3)).toEqual([
      'active:true',
      'save:fixture:ownership:draft-a',
      'save:fixture:ownership:draft-b',
    ]);

    await act(async () => { fixture.appStateListener?.('background'); });
    expect(fixture.calls.at(-1)).toBe('active:false');
    await act(async () => { fixture.appStateListener?.('active'); });
    expect(fixture.calls.at(-1)).toBe('active:true');
    await act(async () => { root.unmount(); });
    unmounted = true;
    expect(fixture.calls.slice(-2)).toEqual(['remove-listener', 'active:false']);
  });

  it('publishes a terminal visible initialization failure instead of remaining on preparing', async () => {
    fixture.rejectSeed = true;
    await act(async () => { root.render(<SimulatorOwnershipFixtureApp />); });
    expect(container.querySelector('[aria-label="SIMOWN-FIXTURE-ROOT initialization failed: synthetic SQLite failure"]')).not.toBeNull();
    expect(container.textContent).not.toContain('preparing local drafts');
  });
});
