import { expect, it, vi } from 'vitest';
import { materializedGatewayImageSource, resolvedGatewayImageSource } from './gatewayImageSource';

const sessionKey = 'agent:main:direct:project:example-cloud';
const headers = { Authorization: 'Bearer fixture', 'x-openclaw-requester-session-key': sessionKey };
const attachment = { id: 'retained', filename: 'cover.png', mimeType: 'image/png',
  uri: 'https://gateway.example/__openclaw__/assistant-media?source=%2Fprivate%2Fcover.png', headers };

it('recovers the original image with session-scoped metadata and bare signed byte GETs', async () => {
  const calls: Array<{ url: URL; options: unknown }> = [];
  const fetcher = vi.fn(async (input: Parameters<typeof fetch>[0] | URL, options?: RequestInit) => {
    const url = new URL(String(input)); calls.push({ url, options });
    if (!url.pathname.startsWith('/dashboard/')) return new Response('', { status: 404 });
    if (url.searchParams.get('sessionKey') !== sessionKey) {
      return Response.json({ available: false, code: 'outside-allowed-folders', retryable: false });
    }
    if (url.searchParams.get('meta') === '1') return Response.json({ available: true, mediaTicket: 'scoped-ticket' });
    if (url.searchParams.get('mediaTicket') !== 'scoped-ticket') return new Response('', { status: 404 });
    return new Response(new Uint8Array([137, 80, 78, 71]));
  });
  const source = await resolvedGatewayImageSource(attachment, fetcher);
  expect(source.uri).toContain('mediaTicket=scoped-ticket');
  expect(await materializedGatewayImageSource(source, 'image/png', fetcher)).toEqual({ uri: 'data:image/png;base64,iVBORw==' });
  expect(calls).toHaveLength(3);
  for (const call of calls) {
    expect(call.url.searchParams.get('source')).toBe('/private/cover.png');
    expect(call.url.searchParams.get('sessionKey')).toBe(sessionKey);
    expect(call.options).not.toHaveProperty('method', 'POST');
    expect(call.url.searchParams.has('allow')).toBe(false);
  }
  expect(calls.at(-1)?.options).toEqual({ signal: expect.any(AbortSignal) });
});

it('uses attachment scope rather than a cached URL scope and retains it on ticket rejection fallback', async () => {
  const metadata = vi.fn(async () => ({ ok: true, json: async () => ({ available: true, mediaTicket: 'ticket' }) }));
  const source = await resolvedGatewayImageSource({ ...attachment, uri: attachment.uri + '&sessionKey=unrelated' }, metadata);
  expect(new URL(source.uri).searchParams.get('sessionKey')).toBe(sessionKey);
  const bytes = vi.fn().mockResolvedValueOnce(new Response('', { status: 404 }))
    .mockResolvedValueOnce(new Response(new Uint8Array([137, 80, 78, 71])));
  expect((await materializedGatewayImageSource(source, 'image/png', bytes)).uri).toContain('data:image/png');
  for (const [url] of bytes.mock.calls) expect(new URL(url).searchParams.get('sessionKey')).toBe(sessionKey);
  expect(new URL(bytes.mock.calls[1]![0]).searchParams.has('mediaTicket')).toBe(false);
});

it('does not infer a scope for attachments without an originating requester identity', async () => {
  const metadata = vi.fn(async (_url: string, _options?: unknown) => ({ ok: true, json: async () => ({ available: true, mediaTicket: 'ticket' }) }));
  const source = await resolvedGatewayImageSource({ ...attachment, headers: { Authorization: 'Bearer fixture' } }, metadata);
  expect(new URL(metadata.mock.calls[0]![0]).searchParams.has('sessionKey')).toBe(false);
  expect(new URL(source.uri).searchParams.has('sessionKey')).toBe(false);
});
