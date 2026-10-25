import { beforeEach, describe, expect, it, vi } from 'vitest';
import { HistoryPublicationAuthority } from './historyPublicationAuthority';
import type { OpenClawClient } from './OpenClawClient';
import type { GatewayProfile } from './setupCode';

const hooks = vi.hoisted(() => {
  const slots: { value: unknown; deps?: readonly unknown[]; cleanup?: (() => void) | undefined }[] = [];
  let index = 0; let effects: (() => void)[] = []; let writes = 0;
  const slot = (value: unknown) => slots[index++] ?? (slots[index - 1] = { value });
  return {
    react: {
      useRef: (value: unknown) => slot({ current: value }).value,
      useState: (value: unknown) => { const current = slot(value); return [current.value, (next: unknown) => { writes += 1; current.value = typeof next === 'function' ? next(current.value) : next; }]; },
      useCallback: (callback: unknown) => { slot(undefined); return callback; },
      useEffect: (run: () => void | (() => void), deps: readonly unknown[]) => {
        const current = slot(undefined);
        if (current.deps && deps.length === current.deps.length && deps.every((dep, i) => Object.is(dep, current.deps![i]))) return;
        current.deps = deps;
        effects.push(() => { current.cleanup?.(); current.cleanup = run() || undefined; });
      },
    },
    render<T>(run: () => T) { index = 0; const result = run(); const pending = effects; effects = []; pending.forEach(effect => effect()); return result; },
    reset() { slots.forEach(slot => slot.cleanup?.()); slots.length = 0; index = 0; effects = []; writes = 0; },
    unmount() { slots.forEach(slot => slot.cleanup?.()); },
    writeCount() { return writes; },
  };
});
vi.mock('react', () => hooks.react);
vi.mock('../lifecycle/useActiveInterval', () => ({ useActiveInterval: () => undefined }));
import { useProviderUsage } from './useProviderUsage';

function deferred() {
  let resolve!: (value: Record<string, unknown>) => void; let reject!: (reason: Error) => void;
  const promise = new Promise<Record<string, unknown>>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

function payload(provider: string, usedPercent: number) {
  return { providers: [{ provider, windows: [{ label: '5h', usedPercent }] }] };
}

function setup() {
  const scene = new HistoryPublicationAuthority();
  const requests: ReturnType<typeof deferred>[] = [];
  const client = {
    status: 'connected',
    providerUsage: vi.fn(() => {
      const request = deferred(); requests.push(request); return request.promise;
    }),
  };
  let status = 'connected';
  let profile = { endpoint: 'wss://one.example', credentialKind: 'deviceToken', credential: 'one', sessionKey: 'agent:main:direct:test' } as GatewayProfile;
  const render = () => hooks.render(() => useProviderUsage(client as unknown as OpenClawClient, profile, status as never, { current: scene }));
  return {
    client, requests, scene, render,
    setStatus(next: string) { status = next; client.status = next; },
    setProfile(next: GatewayProfile) { profile = next; },
  };
}

describe('provider usage request lifetime', () => {
  beforeEach(() => hooks.reset());

  it('retains the last valid snapshot through a reconnect and refresh failure', async () => {
    const test = setup();
    const first = test.render().refresh();
    test.requests[0]!.resolve(payload('openai', 25));
    await first;
    const snapshot = test.render().state.snapshot;

    test.setStatus('connecting');
    test.render();
    expect(test.render().state).toEqual({ phase: 'idle', snapshot });

    test.setStatus('connected');
    test.render();
    const failed = test.render().refresh();
    test.requests[1]!.reject(new Error('usage probe failed'));
    await failed;
    expect(test.render().state).toEqual({ phase: 'error', snapshot });
  });

  it('lets only the newest overlapping request publish', async () => {
    const test = setup(); const hook = test.render();
    const oldRequest = hook.refresh(); const newRequest = hook.refresh();
    test.requests[1]!.resolve(payload('openai', 20)); await newRequest;
    const newest = test.render().state.snapshot;
    test.requests[0]!.resolve(payload('openai', 80)); await oldRequest;
    expect(test.render().state).toEqual({ phase: 'ready', snapshot: newest });
  });

  it('clears an old account immediately and rejects its late reply', async () => {
    const test = setup(); const oldRequest = test.render().refresh();
    test.setProfile({ endpoint: 'wss://two.example', credentialKind: 'deviceToken', credential: 'two', sessionKey: 'agent:other:direct:test' });
    expect(test.render().state).toEqual({ phase: 'idle', snapshot: null });
    test.render();
    test.requests[0]!.resolve(payload('openai', 80)); await oldRequest;
    expect(test.render().state).toEqual({ phase: 'idle', snapshot: null });

    const currentRequest = test.render().refresh();
    test.requests[1]!.resolve(payload('anthropic', 10)); await currentRequest;
    expect(test.render().state.snapshot?.payload).toEqual(payload('anthropic', 10));
  });

  it('keeps the same account snapshot when reconnect publishes an equivalent profile object', async () => {
    const test = setup(); const request = test.render().refresh();
    test.requests[0]!.resolve(payload('openai', 25)); await request;
    const snapshot = test.render().state.snapshot;
    test.setProfile({ endpoint: 'wss://one.example', credentialKind: 'deviceToken', credential: 'one', sessionKey: 'agent:main:direct:test' });
    test.render();
    expect(test.render().state).toEqual({ phase: 'ready', snapshot });
  });

  it('rejects a pre-suspension reply after the scene resumes', async () => {
    const test = setup(); const retired = test.render().refresh();
    test.scene.suspend(); test.requests[0]!.resolve(payload('openai', 25)); await retired;
    test.scene.resume();
    expect(test.render().state).toEqual({ phase: 'loading', snapshot: null });

    const current = test.render().refresh();
    test.requests[1]!.resolve(payload('openai', 30)); await current;
    expect(test.render().state.snapshot?.payload).toEqual(payload('openai', 30));
  });

  it('does not publish after disposal', async () => {
    const test = setup(); const request = test.render().refresh();
    hooks.unmount(); const writes = hooks.writeCount();
    test.requests[0]!.resolve(payload('openai', 25)); await request;
    expect(hooks.writeCount()).toBe(writes);
  });
});
