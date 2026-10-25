import { describe, expect, it, vi } from 'vitest';
import { materializedGatewayImageSource } from './gatewayImageSource';

const source = { uri: 'https://gateway.invalid/__openclaw__/assistant-media?mediaTicket=fixture' };
const limit = 8 * 1024 * 1024;
function streamed(chunks: Uint8Array[], headers?: HeadersInit) {
  let reads = 0; const cancel = vi.fn();
  const body = new ReadableStream<Uint8Array>({
    pull(controller) { const chunk = chunks[reads++]; if (chunk) controller.enqueue(chunk); else controller.close(); },
    cancel,
  }, { highWaterMark: 0 });
  const response = new Response(body, headers ? { headers } : undefined); const wholeBody = vi.spyOn(response, 'arrayBuffer');
  return { response, cancel, wholeBody, reads: () => reads };
}
const fetchResponse = (response: Response) => vi.fn(async () => response) as unknown as typeof fetch;

describe('Gateway image byte admission', () => {
  it('rejects declared oversize before reading or allocating the response body', async () => {
    const test = streamed([new Uint8Array([1])], { 'content-length': String(limit + 1) });
    expect(await materializedGatewayImageSource(source, 'image/png', fetchResponse(test.response)))
      .toEqual({ uri: '', diagnostic: 'ticket-oversize' });
    expect(test.reads()).toBe(0); expect(test.wholeBody).not.toHaveBeenCalled(); expect(test.cancel).toHaveBeenCalledOnce();
  });

  it.each([undefined, '1'])('stops an oversized stream even when content-length is %s', async declared => {
    const chunk = new Uint8Array(1024 * 1024);
    const test = streamed(Array.from({ length: 12 }, () => chunk), declared ? { 'content-length': declared } : undefined);
    expect(await materializedGatewayImageSource(source, 'image/png', fetchResponse(test.response)))
      .toEqual({ uri: '', diagnostic: 'ticket-oversize' });
    expect(test.reads()).toBe(9); expect(test.wholeBody).not.toHaveBeenCalled(); expect(test.cancel).toHaveBeenCalledOnce();
    expect(test.response.body?.locked).toBe(false);
  });

  it('cancels a rejected ticket body before opening its authenticated fallback', async () => {
    const rejected = streamed([new Uint8Array([9])]); const rejectedResponse = new Response(rejected.response.body, { status: 404 });
    const success = streamed([new Uint8Array([137, 80, 78, 71])]);
    const fetcher = vi.fn().mockResolvedValueOnce(rejectedResponse).mockImplementationOnce(async () => {
      expect(rejected.cancel).toHaveBeenCalledOnce(); return success.response;
    });
    expect(await materializedGatewayImageSource({ ...source, headers: { Authorization: 'Bearer test' } }, 'image/png', fetcher))
      .toEqual({ uri: 'data:image/png;base64,iVBORw==', diagnostic: 'authenticated-direct-materialized-ok' });
    expect(success.wholeBody).not.toHaveBeenCalled();
  });

  it('reads valid chunked images without a whole-body reader and releases the reader lock', async () => {
    const test = streamed([new Uint8Array([137, 80]), new Uint8Array([78, 71])]);
    expect(await materializedGatewayImageSource(source, 'image/png', fetchResponse(test.response)))
      .toEqual({ uri: 'data:image/png;base64,iVBORw==' });
    expect(test.wholeBody).not.toHaveBeenCalled(); expect(test.response.body?.locked).toBe(false);
  });

  it('aborts the native transfer when a declared body is rejected before streaming starts', async () => {
    const test = streamed([new Uint8Array([1])], { 'content-length': String(limit + 1) });
    const fetcher = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => test.response);
    await materializedGatewayImageSource(source, 'image/png', fetcher);
    expect(fetcher.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
  });

  it('aborts the rejected ticket transfer but gives the authenticated retry fresh authority', async () => {
    const signals: Array<AbortSignal | null | undefined> = [];
    const fetcher = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      signals.push(init?.signal);
      if (signals.length === 1) return new Response('rejected', { status: 404 });
      expect(signals[0]?.aborted).toBe(true); expect(init?.signal?.aborted).toBe(false);
      return new Response(new Uint8Array([137, 80, 78, 71]));
    });
    expect(await materializedGatewayImageSource({ ...source, headers: { Authorization: 'Bearer test' } }, 'image/png', fetcher))
      .toMatchObject({ uri: 'data:image/png;base64,iVBORw==' });
    expect(signals[1]?.aborted).toBe(false);
  });

  it('accepts exactly the existing limit without retaining an extra input chunk', async () => {
    const test = streamed([new Uint8Array(limit)]);
    const result = await materializedGatewayImageSource(source, 'image/png', fetchResponse(test.response));
    expect(result.uri.length).toBe('data:image/png;base64,'.length + 4 * Math.ceil(limit / 3));
    expect(test.wholeBody).not.toHaveBeenCalled(); expect(test.cancel).not.toHaveBeenCalled();
  });

  it('reads only each view’s visible bytes and tolerates empty chunks', async () => {
    const buffer = new Uint8Array([99, 137, 80, 78, 71, 99]);
    const test = streamed([new Uint8Array(), buffer.subarray(1, 5), new Uint8Array()], { 'content-length': 'not-a-length' });
    expect(await materializedGatewayImageSource(source, 'image/png', fetchResponse(test.response)))
      .toEqual({ uri: 'data:image/png;base64,iVBORw==' });
  });

  it('aborts a pending stream read and releases its lock', async () => {
    const cancel = vi.fn(); const response = new Response(new ReadableStream({ pull() {}, cancel }, { highWaterMark: 0 }));
    const parent = new AbortController(); const fetcher = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => response);
    const pending = materializedGatewayImageSource(source, 'image/png', fetcher, parent.signal);
    for (let index = 0; index < 10; index += 1) await Promise.resolve();
    expect(response.body?.locked).toBe(true); parent.abort();
    await expect(pending).resolves.toEqual({ uri: '', diagnostic: 'ticket-fetch-failed' });
    expect(fetcher.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
    expect(cancel).toHaveBeenCalledOnce(); expect(response.body?.locked).toBe(false);
  });

  it('does not fetch after caller cancellation or retain the parent listener after success', async () => {
    const parent = new AbortController(); parent.abort(); const fetcher = vi.fn();
    await materializedGatewayImageSource(source, 'image/png', fetcher, parent.signal); expect(fetcher).not.toHaveBeenCalled();
    const active = new AbortController(); const success = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => new Response(new Uint8Array([1])));
    await materializedGatewayImageSource(source, 'image/png', success, active.signal);
    active.abort(); expect(success.mock.calls[0]?.[1]?.signal?.aborted).toBe(false);
  });

  it('releases an errored stream and never falls back to an unbounded body API', async () => {
    const response = new Response(new ReadableStream({ pull(controller) { controller.error(new Error('broken transport')); } }));
    await expect(materializedGatewayImageSource(source, 'image/png', fetchResponse(response)))
      .resolves.toEqual({ uri: '', diagnostic: 'ticket-fetch-failed' });
    expect(response.body?.locked).toBe(false);
    const wholeBody = vi.fn();
    const unsupported = { ok: true, headers: new Headers(), arrayBuffer: wholeBody } as unknown as Response;
    await expect(materializedGatewayImageSource(source, 'image/png', fetchResponse(unsupported)))
      .resolves.toEqual({ uri: '', diagnostic: 'ticket-stream-unavailable' });
    expect(wholeBody).not.toHaveBeenCalled();
  });
});
