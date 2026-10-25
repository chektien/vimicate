import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorkspaceAttachment } from '../workspace/workspaceTypes';

const headers = { Authorization: 'Bearer queue-test', 'x-openclaw-requester-session-key': 'agent:main:test' };
const attachment = (id: string): WorkspaceAttachment => ({ id, filename: `${id}.png`, mimeType: 'image/png',
  uri: `https://gateway.invalid/__openclaw__/assistant-media?source=%2Ftmp%2F${id}.png`, headers });
const meta = () => ({ ok: true, json: async () => ({ available: true, mediaTicket: 'ticket' }) });
const bytes = () => new Response(new Uint8Array([137, 80, 78, 71]));
const flush = async () => { for (let index = 0; index < 600; index += 1) await Promise.resolve(); };
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(yes => { resolve = yes; }); return { promise, resolve }; }
let api: typeof import('./gatewayImageSource');
const cleanup: Array<() => void> = [];

beforeEach(async () => { vi.resetModules(); api = await import('./gatewayImageSource'); });
afterEach(async () => { cleanup.splice(0).forEach(release => release()); await flush(); vi.useRealTimers(); vi.unstubAllGlobals(); });

function holdFirst() {
  const held = deferred<ReturnType<typeof meta>>(); cleanup.push(() => held.resolve(meta()));
  const fetcher = vi.fn((input: string, _init?: RequestInit) => input.includes('meta=1')
    ? (input.includes('first.png') ? held.promise : Promise.resolve(meta())) : Promise.resolve(bytes()));
  vi.stubGlobal('fetch', fetcher);
  return { held, fetcher };
}

describe('shared image request scheduling', () => {
  it.each(['data:image/png;base64,iVBORw==', 'file:///tmp/ready.png', 'https://cdn.invalid/ready.png'])
    ('does not put an already usable %s source behind a stalled Gateway request', async (uri) => {
      const { fetcher } = holdFirst(); void api.cachedGatewayImageSource(attachment('first')); await flush();
      let ready: string | undefined;
      void api.cachedGatewayImageSource({ ...attachment('ready'), uri }).then(source => { ready = source.uri; });
      await flush(); expect(ready).toBe(uri); expect(fetcher).toHaveBeenCalledTimes(1);
    });

  it('retires invalidated waiting work before it can issue a network request', async () => {
    const { held, fetcher } = holdFirst(); void api.cachedGatewayImageSource(attachment('first')); await flush();
    const retired = api.cachedGatewayImageSource(attachment('retired'));
    api.invalidateGatewayImageSource(attachment('retired'));
    held.resolve(meta()); await flush(); await retired;
    expect(fetcher.mock.calls.some(([url]) => url.includes('retired.png'))).toBe(false);
  });

  it('bounds a rapid-scroll backlog instead of retaining every evicted promise in a chain', async () => {
    const { held, fetcher } = holdFirst(); void api.cachedGatewayImageSource(attachment('first')); await flush();
    let settled = 0;
    for (let index = 0; index < 40; index += 1) void api.cachedGatewayImageSource(attachment(`queued-${index}`)).then(() => { settled += 1; });
    await flush(); expect(settled).toBeGreaterThanOrEqual(32);
    held.resolve(meta()); await flush();
    const queuedMetadata = fetcher.mock.calls.filter(([url]) => url.includes('meta=1') && url.includes('queued-'));
    expect(queuedMetadata.length).toBeLessThanOrEqual(8);
    expect(queuedMetadata.at(-1)?.[0]).toContain('queued-39.png');
  });

  it('times out and aborts a hung transfer, admits the next image, and rejects its late result', async () => {
    vi.useFakeTimers(); const { held, fetcher } = holdFirst();
    let first: Awaited<ReturnType<typeof api.cachedGatewayImageSource>> | undefined;
    void api.cachedGatewayImageSource(attachment('first')).then(value => { first = value; }); await flush();
    const firstSignal = fetcher.mock.calls[0]?.[1]?.signal;
    let next: string | undefined;
    void api.cachedGatewayImageSource(attachment('next')).then(value => { next = value.uri; });
    await vi.advanceTimersByTimeAsync(30_000); await flush();
    expect(first).toEqual({ uri: '', diagnostic: 'media-request-timeout' });
    expect(firstSignal?.aborted).toBe(true); expect(next).toBe('data:image/png;base64,iVBORw==');
    const calls = fetcher.mock.calls.length; held.resolve(meta()); await flush();
    expect(fetcher).toHaveBeenCalledTimes(calls); expect(vi.getTimerCount()).toBe(0);
  });

  it.each(['json', 'stream'] as const)('includes a stalled %s read in the same transfer deadline', async (phase) => {
    vi.useFakeTimers(); const held = deferred<unknown>(); cleanup.push(() => held.resolve(phase === 'json' ? { available: true, mediaTicket: 'late' } : new Uint8Array([1]).buffer));
    const fetcher = vi.fn(async (input: string) => input.includes('meta=1')
      ? { ok: true, json: phase === 'json' ? () => held.promise : meta().json }
      : new Response(new ReadableStream({ pull: async () => { await held.promise; } }, { highWaterMark: 0 })));
    vi.stubGlobal('fetch', fetcher);
    const pending = api.cachedGatewayImageSource(attachment('slow-body')); await flush();
    await vi.advanceTimersByTimeAsync(30_000);
    await expect(pending).resolves.toEqual({ uri: '', diagnostic: 'media-request-timeout' });
    const calls = fetcher.mock.calls.length; cleanup.splice(0).forEach(release => release()); await flush();
    expect(fetcher).toHaveBeenCalledTimes(calls); expect(vi.getTimerCount()).toBe(0);
  });

  it('shares the active request even when waiting demand exceeds capacity', async () => {
    const { held, fetcher } = holdFirst(); const first = api.cachedGatewayImageSource(attachment('first')); await flush();
    for (let index = 0; index < 1000; index += 1) void api.cachedGatewayImageSource(attachment(`queued-${index}`));
    expect(api.cachedGatewayImageSource(attachment('first'))).toBe(first);
    held.resolve(meta()); await flush();
    expect(fetcher.mock.calls.filter(([url]) => url.includes('meta=1'))).toHaveLength(9);
  });

  it('cancels an active invalidation and does not let its late result replace a fresh retry', async () => {
    vi.useFakeTimers(); const { held, fetcher } = holdFirst();
    const old = api.cachedGatewayImageSource(attachment('first')); await flush();
    const signal = fetcher.mock.calls[0]?.[1]?.signal;
    api.invalidateGatewayImageSource(attachment('first'));
    await expect(old).resolves.toEqual({ uri: '', diagnostic: 'media-request-cancelled' }); expect(signal?.aborted).toBe(true);
    fetcher.mockImplementation(input => input.includes('meta=1') ? Promise.resolve(meta()) : Promise.resolve(bytes()));
    const current = api.cachedGatewayImageSource(attachment('first')); await flush();
    await expect(current).resolves.toEqual({ uri: 'data:image/png;base64,iVBORw==' });
    const calls = fetcher.mock.calls.length; held.resolve(meta()); await flush();
    expect(api.cachedGatewayImageSource(attachment('first'))).toBe(current);
    expect(fetcher).toHaveBeenCalledTimes(calls); expect(vi.getTimerCount()).toBe(0);
  });

  it('cancels without starting a transfer when invalidated before its first microtask', async () => {
    vi.useFakeTimers(); const { fetcher } = holdFirst(); const pending = api.cachedGatewayImageSource(attachment('first'));
    api.invalidateGatewayImageSource(attachment('first')); await flush();
    await expect(pending).resolves.toEqual({ uri: '', diagnostic: 'media-request-cancelled' });
    expect(fetcher).not.toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0);
  });

  it('cancels metadata backoff without leaving its timer or retry alive', async () => {
    vi.useFakeTimers(); const fetcher = vi.fn(async () => ({ ok: false })); vi.stubGlobal('fetch', fetcher);
    const pending = api.cachedGatewayImageSource(attachment('backoff')); await flush();
    expect(vi.getTimerCount()).toBe(2); const calls = fetcher.mock.calls.length;
    api.invalidateGatewayImageSource(attachment('backoff')); await flush();
    await expect(pending).resolves.toEqual({ uri: '', diagnostic: 'media-request-cancelled' });
    await vi.advanceTimersByTimeAsync(30_000);
    expect(fetcher).toHaveBeenCalledTimes(calls); expect(vi.getTimerCount()).toBe(0);
  });

  it('does not share authority across paired credentials or requesting sessions', async () => {
    const fetcher = vi.fn(async (input: string) => input.includes('meta=1') ? meta() : bytes()); vi.stubGlobal('fetch', fetcher);
    const original = attachment('scope'); await api.cachedGatewayImageSource(original);
    await api.cachedGatewayImageSource({ ...original, headers: { ...headers, Authorization: 'Bearer different' } });
    await api.cachedGatewayImageSource({ ...original, headers: { ...headers, 'x-openclaw-requester-session-key': 'agent:main:different' } });
    expect(fetcher.mock.calls.filter(([url]) => url.includes('meta=1'))).toHaveLength(3);
  });

  it('retains only eight successful sources and refreshes recency on cache hits', async () => {
    vi.useFakeTimers(); const fetcher = vi.fn(async (input: string) => input.includes('meta=1') ? meta() : bytes()); vi.stubGlobal('fetch', fetcher);
    for (let index = 0; index < 8; index += 1) await api.cachedGatewayImageSource(attachment(`ready-${index}`));
    await api.cachedGatewayImageSource(attachment('ready-0')); await api.cachedGatewayImageSource(attachment('ready-8'));
    const calls = fetcher.mock.calls.length;
    await api.cachedGatewayImageSource(attachment('ready-0')); expect(fetcher).toHaveBeenCalledTimes(calls);
    await api.cachedGatewayImageSource(attachment('ready-1')); expect(fetcher).toHaveBeenCalledTimes(calls + 2);
    expect(vi.getTimerCount()).toBe(0);
  });
});
