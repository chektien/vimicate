import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorkspaceAttachment } from '../workspace/workspaceTypes';
import type { ImageNetworkSource } from './gatewayImageSource';

type Effect = () => void | (() => void);
type Update = unknown | ((previous: unknown) => unknown);
type Node = { type: string; props: Record<string, unknown> };
const hooks = vi.hoisted(() => ({
  ref: null as unknown as (value: unknown) => unknown,
  state: null as unknown as (value: unknown) => unknown,
  effect: null as unknown as (effect: Effect, deps: unknown[], layout: boolean) => void,
}));
const sources = vi.hoisted(() => ({ gateway: vi.fn(), local: vi.fn(), invalidate: vi.fn(), diagnostic: vi.fn() }));
vi.mock('react', () => ({
  createContext: (value: unknown) => ({ value }),
  useContext: (context: { value: unknown }) => context.value,
  useRef: (value: unknown) => hooks.ref(value), useState: (value: unknown) => hooks.state(value),
  useEffect: (effect: Effect, deps: unknown[]) => hooks.effect(effect, deps, false),
  useLayoutEffect: (effect: Effect, deps: unknown[]) => hooks.effect(effect, deps, true),
}));
vi.mock('react/jsx-runtime', () => ({
  jsx: (type: string, props: Record<string, unknown>) => ({ type, props }),
  jsxs: (type: string, props: Record<string, unknown>) => ({ type, props }),
}));
vi.mock('react-native', () => ({
  Image: 'Image', Pressable: 'Pressable', Text: 'Text', View: 'View',
  StyleSheet: { create: (styles: unknown) => styles, absoluteFill: {} },
}));
vi.mock('./gatewayImageSource', () => ({ cachedGatewayImageSource: sources.gateway, invalidateGatewayImageSource: sources.invalidate }));
vi.mock('./iosLocalImageSource', () => ({ materializedIOSLocalImageSource: sources.local }));
vi.mock('../../modules/vimicate-diagnostics', () => ({ recordGatewayDiagnostic: sources.diagnostic }));
import { GatewayImage } from './GatewayImage';
import { mediaScenePublicationAuthority as scene } from './mediaScenePublicationAuthority';

const attachment: WorkspaceAttachment = { id: 'one', filename: 'one.png', mimeType: 'image/png', uri: 'https://example.invalid/one.png' };
const image = (name: string): ImageNetworkSource => ({ uri: `data:image/png;base64,${name}` });
function deferred<T>() { let resolve!: (value: T) => void; let reject!: (error: Error) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
const microtasks = async () => { for (let index = 0; index < 8; index += 1) await Promise.resolve(); };
const disposals: Array<() => void> = [];

/** Runs the actual leaf, retaining hook slots and applying queued functional updates at commit. */
function mount(initial = attachment) {
  let cursor = 0; let current = initial; let tree: Node; let disposed = false;
  const slots: Array<{ value?: unknown; deps?: unknown[]; dispose?: () => void }> = [];
  const updates: Array<() => void> = [];
  let effects: Array<{ run: () => void; layout: boolean }> = [];
  hooks.ref = (value) => { const index = cursor++; slots[index] ??= { value: { current: value } }; return slots[index]!.value; };
  hooks.state = (value) => {
    const index = cursor++; slots[index] ??= { value };
    return [slots[index]!.value, (update: Update) => updates.push(() => {
      slots[index]!.value = typeof update === 'function' ? update(slots[index]!.value) : update;
    })];
  };
  hooks.effect = (effect, deps, layout) => {
    const index = cursor++; const previous = slots[index];
    if (previous?.deps && deps.length === previous.deps.length && deps.every((dep, position) => Object.is(dep, previous.deps![position]))) return;
    effects.push({ layout, run: () => { previous?.dispose?.(); const dispose = effect(); slots[index] = { deps, ...(dispose ? { dispose } : {}) }; } });
  };
  const render = () => {
    cursor = 0; effects = [];
    tree = GatewayImage({ attachment: current, style: {} }) as unknown as Node;
    effects.filter(effect => effect.layout).forEach(effect => effect.run());
    effects.filter(effect => !effect.layout).forEach(effect => effect.run());
  };
  const flush = async () => {
    for (let turn = 0; turn < 12; turn += 1) {
      await microtasks();
      if (!updates.length) return;
      updates.splice(0).forEach(update => update()); render();
    }
    throw new Error('Image failed to settle within the bounded render budget');
  };
  const nodes = (node: unknown): Node[] => {
    if (Array.isArray(node)) return node.flatMap(child => nodes(child));
    if (!node || typeof node !== 'object' || !('props' in node)) return [];
    const element = node as Node; return [element, ...nodes(element.props.children)];
  };
  const find = (type: string) => nodes(tree).find(node => node.type === type);
  const event = (name: 'onLoad' | 'onError') => {
    const callback = find('Image')?.props[name]; expect(callback).toBeTypeOf('function'); return callback as () => void;
  };
  const unmount = () => { if (disposed) return; disposed = true; slots.forEach(slot => slot.dispose?.()); };
  disposals.push(unmount); render();
  return { flush, find, event, unmount, updates,
    replace: (next: WorkspaceAttachment) => { current = next; render(); },
    discardRender: (next: WorkspaceAttachment) => {
      cursor = 0; effects = []; GatewayImage({ attachment: next, style: {} }); effects = [];
    },
    uri: () => (find('Image')?.props.source as ImageNetworkSource | undefined)?.uri,
    loading: () => nodes(tree).some(node => node.type === 'Text' && node.props.children === 'loading image…'),
  };
}

beforeEach(() => {
  vi.clearAllMocks(); scene.suspend(); scene.resume();
  sources.gateway.mockReset().mockResolvedValue(image('current'));
  sources.local.mockReset().mockResolvedValue(null);
});
afterEach(() => { disposals.splice(0).forEach(dispose => dispose()); scene.suspend(); });

describe('actual GatewayImage lifetime', () => {
  it('readmits pending Gateway work on resume before the retired request settles', async () => {
    const pending = deferred<ImageNetworkSource>(); sources.gateway.mockReturnValueOnce(pending.promise);
    const test = mount(); await test.flush(); scene.suspend(); scene.resume(); await test.flush();
    expect(sources.gateway).toHaveBeenCalledTimes(2); expect(test.uri()).toBe(image('current').uri);
    pending.resolve(image('old')); await test.flush(); expect(test.uri()).toBe(image('current').uri);
  });

  it('readmits a pending Files result and ignores its late retired answer', async () => {
    const pending = deferred<ImageNetworkSource | null>();
    sources.gateway.mockResolvedValueOnce({ uri: attachment.uri! }); sources.local.mockReturnValueOnce(pending.promise);
    const test = mount(); await test.flush(); expect(sources.local).toHaveBeenCalledOnce();
    scene.suspend(); scene.resume(); await test.flush();
    expect(test.uri()).toBe(image('current').uri);
    pending.resolve(image('old-files')); await test.flush(); expect(test.uri()).toBe(image('current').uri);
  });

  it('accepts the shared in-flight cache promise through its new foreground publisher', async () => {
    const pending = deferred<ImageNetworkSource>(); sources.gateway.mockReturnValue(pending.promise);
    const test = mount(); await test.flush(); scene.suspend(); scene.resume(); await test.flush();
    expect(sources.gateway).toHaveBeenCalledTimes(2); expect(test.uri()).toBeUndefined();
    pending.resolve(image('shared')); await test.flush(); expect(test.uri()).toBe(image('shared').uri);
    expect(sources.diagnostic).toHaveBeenCalledOnce();
    test.event('onLoad')(); await test.flush(); expect(test.loading()).toBe(false);
  });

  it('replaces an unfinished decode on resume without allowing its old error to fail the replacement', async () => {
    const test = mount(); await test.flush(); const retiredError = test.event('onError');
    scene.suspend(); scene.resume(); await test.flush();
    expect(sources.gateway).toHaveBeenCalledTimes(2);
    retiredError(); await test.flush(); expect(test.uri()).toBe(image('current').uri);
    test.event('onLoad')(); await test.flush(); expect(test.loading()).toBe(false);
  });

  it('rejects a previous attachment decode error after a replacement source is accepted', async () => {
    const test = mount(); await test.flush(); const retiredError = test.event('onError');
    sources.gateway.mockResolvedValue(image('replacement'));
    test.replace({ ...attachment, id: 'two', uri: 'https://example.invalid/two.png' }); await test.flush();
    retiredError(); await test.flush(); expect(test.uri()).toBe(image('replacement').uri);
  });

  it('does not let a previous attachment load finish the replacement loading indicator', async () => {
    const test = mount(); await test.flush(); const retiredLoad = test.event('onLoad');
    test.replace({ ...attachment, id: 'two', uri: 'https://example.invalid/two.png' }); await test.flush();
    retiredLoad(); await test.flush(); expect(test.loading()).toBe(true);
    test.event('onLoad')(); await test.flush(); expect(test.loading()).toBe(false);
  });

  it('rechecks scene authority when React applies a queued source result', async () => {
    const pending = deferred<ImageNetworkSource>(); sources.gateway.mockReturnValueOnce(pending.promise);
    const test = mount(); await test.flush(); pending.resolve(image('old')); await microtasks();
    expect(test.updates.length).toBeGreaterThan(0); scene.suspend(); await test.flush();
    expect(test.uri()).toBeUndefined(); scene.resume(); await test.flush(); expect(test.uri()).toBe(image('current').uri);
  });

  it('preserves an already decoded image across resume without resolving it again', async () => {
    const test = mount(); await test.flush(); test.event('onLoad')(); await test.flush();
    scene.suspend(); scene.resume(); await test.flush();
    expect(sources.gateway).toHaveBeenCalledOnce(); expect(test.uri()).toBe(image('current').uri); expect(test.loading()).toBe(false);
  });

  it('waits on a cold inactive mount then resolves once after resume', async () => {
    scene.suspend(); const test = mount(); await test.flush(); expect(sources.gateway).not.toHaveBeenCalled();
    scene.resume(); await test.flush(); expect(sources.gateway).toHaveBeenCalledOnce(); expect(test.uri()).toBe(image('current').uri);
  });

  it('ignores decode callbacks and resume after unmount', async () => {
    const test = mount(); await test.flush(); const retiredError = test.event('onError'); test.unmount();
    retiredError(); scene.suspend(); scene.resume(); expect(test.updates).toHaveLength(0);
    expect(sources.gateway).toHaveBeenCalledOnce();
  });

  it('rejects a queued decode publication if its scene retires before React commit', async () => {
    const test = mount(); await test.flush(); test.event('onLoad')();
    scene.suspend(); await test.flush(); expect(test.loading()).toBe(true);
    scene.resume(); await test.flush(); expect(sources.gateway).toHaveBeenCalledTimes(2);
    test.event('onLoad')(); await test.flush(); expect(test.loading()).toBe(false);
  });

  it('coalesces repeated scene round-trips before React applies the retry', async () => {
    const pending = deferred<ImageNetworkSource>(); sources.gateway.mockReturnValueOnce(pending.promise);
    const test = mount(); await test.flush();
    for (let index = 0; index < 200; index += 1) { scene.suspend(); scene.resume(); }
    expect(test.updates).toHaveLength(1); await test.flush(); expect(sources.gateway).toHaveBeenCalledTimes(2);
    pending.reject(new Error('retired failure')); await test.flush(); expect(test.uri()).toBe(image('current').uri);
  });

  it('defers an inactive result then recovers on the next foreground event', async () => {
    const pending = deferred<ImageNetworkSource>(); sources.gateway.mockReturnValueOnce(pending.promise);
    const test = mount(); await test.flush(); scene.suspend(); pending.resolve(image('retired')); await test.flush();
    expect(test.uri()).toBeUndefined(); expect(test.updates).toHaveLength(0);
    scene.resume(); await test.flush(); expect(test.uri()).toBe(image('current').uri);
  });

  it('ignores a pending Files result after unmount without queuing UI or diagnostics', async () => {
    const pending = deferred<ImageNetworkSource | null>();
    sources.gateway.mockResolvedValue({ uri: attachment.uri! }); sources.local.mockReturnValue(pending.promise);
    const test = mount(); await test.flush(); test.unmount();
    sources.diagnostic.mockClear(); pending.resolve(image('late-files')); await microtasks();
    expect(test.updates).toHaveLength(0); expect(sources.diagnostic).not.toHaveBeenCalled();
  });

  it('retains genuine failure and supports explicit local-access retry for that image', async () => {
    sources.gateway.mockResolvedValue({ uri: '' });
    const test = mount(); await test.flush(); expect(test.find('Pressable')).toBeDefined();
    scene.suspend(); scene.resume(); await test.flush(); expect(sources.gateway).toHaveBeenCalledOnce();
    sources.local.mockResolvedValue(image('files'));
    const stopPropagation = vi.fn();
    (test.find('Pressable')!.props.onPress as (event: { stopPropagation: () => void }) => void)({ stopPropagation }); await test.flush();
    expect(stopPropagation).toHaveBeenCalledOnce();
    expect(sources.invalidate).toHaveBeenCalledWith(attachment);
    expect(sources.local).toHaveBeenLastCalledWith(attachment, true); expect(test.uri()).toBe(image('files').uri);
  });

  it('does not transfer explicit Files prompting to an attachment selected before retry commits', async () => {
    sources.gateway.mockResolvedValue({ uri: '' });
    const test = mount(); await test.flush();
    (test.find('Pressable')!.props.onPress as (event: { stopPropagation: () => void }) => void)({ stopPropagation: vi.fn() });
    const replacement = { ...attachment, filename: 'two.png', uri: 'https://example.invalid/two.png' };
    test.replace(replacement); await test.flush();
    expect(sources.local.mock.calls.filter(([item, prompt]) => item === replacement && prompt === true)).toHaveLength(0);
  });

  it('rejects the retired attachment event immediately when props change, before async resolution', async () => {
    const test = mount(); await test.flush(); const retiredLoad = test.event('onLoad');
    const pending = deferred<ImageNetworkSource>(); sources.gateway.mockReturnValueOnce(pending.promise);
    test.replace({ ...attachment, uri: 'https://example.invalid/two.png' }); retiredLoad(); await test.flush();
    expect(test.uri()).toBeUndefined(); pending.resolve(image('two')); await test.flush(); expect(test.loading()).toBe(true);
  });

  it('does not let an abandoned render retire the committed attachment request', async () => {
    const pending = deferred<ImageNetworkSource>(); sources.gateway.mockReturnValue(pending.promise);
    const test = mount(); await test.flush();
    test.discardRender({ ...attachment, uri: 'https://example.invalid/uncommitted.png' });
    pending.resolve(image('committed')); await test.flush(); expect(test.uri()).toBe(image('committed').uri);
  });
});
