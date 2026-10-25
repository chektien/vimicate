// @vitest-environment jsdom
import React, { act, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { AppState } from 'react-native';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HistoryPublicationAuthority } from './historyPublicationAuthority';
import type { GatewayStatus, OpenClawClient } from './OpenClawClient';
import type { GatewayProfile } from './setupCode';

const native = vi.hoisted(() => ({
  state: 'active',
  listeners: new Set<(state: string) => void>(),
  emit(state: string) {
    this.state = state;
    for (const listener of [...this.listeners]) listener(state);
  },
}));

vi.mock('react-native', () => ({
  AppState: {
    get currentState() { return native.state; },
    addEventListener: (_event: string, listener: (state: string) => void) => {
      native.listeners.add(listener);
      return { remove: () => native.listeners.delete(listener) };
    },
  },
}));

import { useProviderUsage } from './useProviderUsage';

type Deferred = ReturnType<typeof deferred>;
type Owner = ReturnType<typeof useProviderUsage>;

const bootstrapProfile: GatewayProfile = {
  endpoint: 'wss://gateway.example',
  credentialKind: 'bootstrapToken',
  credential: 'bootstrap-fixture',
  sessionKey: 'agent:fixture:direct:usage',
};
const pairedProfile: GatewayProfile = {
  ...bootstrapProfile,
  credentialKind: 'deviceToken',
  credential: 'device-fixture',
};

function deferred() {
  let resolve!: (payload: Record<string, unknown>) => void;
  const promise = new Promise<Record<string, unknown>>((done) => { resolve = done; });
  return { promise, resolve };
}

function payload(usedPercent: number) {
  return { providers: [{ provider: 'openai', windows: [{ label: '5h', usedPercent }] }] };
}

describe('mounted provider usage lifecycle', () => {
  let root: Root;
  let container: HTMLDivElement;
  let scene: HistoryPublicationAuthority;
  let requests: Deferred[];
  let client: { status: GatewayStatus; providerUsage: ReturnType<typeof vi.fn> };
  let owner: Owner | null;
  let profile: GatewayProfile | null;
  let status: GatewayStatus;

  function Probe({ bindSceneLifecycle = false }: { bindSceneLifecycle?: boolean }) {
    owner = useProviderUsage(client as unknown as OpenClawClient, profile, status, { current: scene });
    useEffect(() => {
      if (!bindSceneLifecycle) return undefined;
      const subscription = AppState.addEventListener('change', (next) => {
        if (next === 'active') scene.resume();
        else scene.suspend();
      });
      return () => subscription.remove();
    }, [bindSceneLifecycle]);
    return <div data-phase={owner.state.phase} />;
  }

  async function render(bindSceneLifecycle = false) {
    await act(async () => root.render(<Probe bindSceneLifecycle={bindSceneLifecycle} />));
  }

  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    native.state = 'active';
    native.listeners.clear();
    scene = new HistoryPublicationAuthority();
    requests = [];
    client = {
      status: 'connected',
      providerUsage: vi.fn(() => {
        const request = deferred();
        requests.push(request);
        return request.promise;
      }),
    };
    owner = null;
    profile = bootstrapProfile;
    status = 'connected';
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('loads on active mount and reconnect while rejecting the disconnected request late reply', async () => {
    await render();
    expect(client.providerUsage).toHaveBeenCalledTimes(1);
    expect(owner!.state).toEqual({ phase: 'loading', snapshot: null });

    client.status = 'disconnected';
    status = 'disconnected';
    await render();
    expect(owner!.state).toEqual({ phase: 'idle', snapshot: null });

    client.status = 'connected';
    status = 'connected';
    await render();
    expect(client.providerUsage).toHaveBeenCalledTimes(2);
    requests[0]!.resolve(payload(90));
    await act(async () => { await requests[0]!.promise; });
    expect(owner!.state).toEqual({ phase: 'loading', snapshot: null });

    requests[1]!.resolve(payload(20));
    await act(async () => { await requests[1]!.promise; });
    expect(owner!.state.phase).toBe('ready');
    expect(owner!.state.snapshot?.payload).toEqual(payload(20));
  });

  it('keeps one automatic activation request through React Strict Mode effect replay', async () => {
    await act(async () => root.render(<React.StrictMode><Probe /></React.StrictMode>));
    expect(client.providerUsage).toHaveBeenCalledTimes(1);
    expect(native.listeners.size).toBe(1);
    expect(vi.getTimerCount()).toBe(1);
  });

  it('refreshes when foreground activation resumes the scene owner', async () => {
    await render(true);
    requests[0]!.resolve(payload(20));
    await act(async () => { await requests[0]!.promise; });

    await act(async () => native.emit('background'));
    expect(scene.isActive).toBe(false);
    await act(async () => native.emit('active'));
    expect(scene.isActive).toBe(true);
    expect(client.providerUsage).toHaveBeenCalledTimes(2);
  });

  it('refreshes after the connected bootstrap credential is replaced by its issued device token', async () => {
    await render();
    requests[0]!.resolve(payload(20));
    await act(async () => { await requests[0]!.promise; });

    profile = pairedProfile;
    await render();
    expect(owner!.state).toEqual({ phase: 'loading', snapshot: null });
    expect(client.providerUsage).toHaveBeenCalledTimes(2);
  });

  it('removes its scene listener and interval and ignores a late reply after disposal', async () => {
    const observed: string[] = [];
    function ObservedProbe() {
      const usage = useProviderUsage(client as unknown as OpenClawClient, profile, status, { current: scene });
      useEffect(() => { observed.push(usage.state.phase); }, [usage.state.phase]);
      return null;
    }
    await act(async () => root.render(<ObservedProbe />));
    expect(client.providerUsage).toHaveBeenCalledTimes(1);
    expect(native.listeners.size).toBe(1);
    expect(vi.getTimerCount()).toBe(1);

    await act(async () => root.unmount());
    expect(native.listeners.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
    requests[0]!.resolve(payload(75));
    await act(async () => { await requests[0]!.promise; });
    expect(observed).toEqual(['idle', 'loading']);
  });
});
