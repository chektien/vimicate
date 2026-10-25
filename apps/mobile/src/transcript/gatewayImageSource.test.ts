import { describe, expect, it, vi } from 'vitest';
import { assistantMediaRequest, cachedGatewayImageSource, gatewayLocalImagePath, invalidateGatewayImageSource, materializedGatewayImageSource, resolvedGatewayImageSource } from './gatewayImageSource';

const headers = { Authorization: 'Bearer paired-device', 'x-openclaw-requester-session-key': 'agent:main:example-thread' };

describe('gateway image ticket resolution', () => {
  it('mints a ticket for a gateway-local iCloud image path', async () => {
    const fetcher = vi.fn(async () => ({ ok: true, json: async () => ({ available: true, mediaTicket: 'signed-ticket' }) }));
    const result = await resolvedGatewayImageSource({ id: 'one', filename: 'result.png', mimeType: 'image/png', uri: 'https://gateway.example/__openclaw__/assistant-media?source=%2FUsers%2Ffixture%2FLibrary%2FMobile%20Documents%2Fresult.png', headers }, fetcher);
    expect(fetcher).toHaveBeenCalledWith(expect.stringContaining('meta=1'), { headers });
    expect(result).toEqual({ uri: 'https://gateway.example/__openclaw__/assistant-media?source=%2FUsers%2Ffixture%2FLibrary%2FMobile+Documents%2Fresult.png&mediaTicket=signed-ticket&sessionKey=agent%3Amain%3Aexample-thread', headers });
  });

  it('probes the dashboard media route when the root route is absent', async () => {
    const fetcher = vi.fn(async (input: string) => ({ ok: input.includes('/dashboard/'), json: async () => ({ available: true, mediaTicket: 'dashboard-ticket' }) }));
    const result = await resolvedGatewayImageSource({ id: 'one', filename: 'result.png', mimeType: 'image/png', uri: 'https://gateway.example/__openclaw__/assistant-media?source=%2Ftmp%2Fresult.png', headers }, fetcher);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(result.uri).toContain('/dashboard/__openclaw__/assistant-media');
    expect(result.uri).toContain('mediaTicket=dashboard-ticket');
  });

  it('converts managed outgoing routes into the OpenClaw ticket source descriptor', () => {
    expect(assistantMediaRequest({ id: 'one', filename: 'result.png', mimeType: 'image/png', uri: 'https://gateway.example/api/chat/media/outgoing/agent%3Amain%3Aexample-thread/550e8400-e29b-41d4-a716-446655440000/full', headers })?.source)
      .toBe('media://outgoing/550e8400-e29b-41d4-a716-446655440000?sessionKey=agent%3Amain%3Aexample-thread');
  });

  it('recovers archived managed images through their durable outbound filename', async () => {
    const fetcher = vi.fn(async (input: string) => {
      const url = new URL(input);
      const source = url.searchParams.get('source') ?? '';
      return { ok: true, json: async () => source.startsWith('~/.openclaw/media/outbound/')
        ? { available: true, mediaTicket: 'archive-ticket' }
        : { available: false, code: 'attachment-unavailable' } };
    });
    const result = await resolvedGatewayImageSource({
      id: 'one', filename: 'exec-proof---capture.png', mimeType: 'image/png',
      uri: 'https://gateway.example/api/chat/media/outgoing/agent%3Amain%3Aexample-thread/550e8400-e29b-41d4-a716-446655440000/full', headers,
    }, fetcher);
    expect(result.uri).toContain('/__openclaw__/assistant-media');
    expect(result.uri).toContain('source=%7E%2F.openclaw%2Fmedia%2Foutbound%2Fexec-proof---capture.png');
    expect(result.uri).toContain('mediaTicket=archive-ticket');
  });

  it('does not synthesize an outbound fallback from an unsafe filename', () => {
    const request = assistantMediaRequest({
      id: 'one', filename: '../capture.png', mimeType: 'image/png',
      uri: 'https://gateway.example/api/chat/media/outgoing/agent%3Amain%3Aexample-thread/550e8400-e29b-41d4-a716-446655440000/full', headers,
    });
    expect(request?.candidates).toHaveLength(1);
  });

  it('never mints tickets or adds auth for external images', async () => {
    const fetcher = vi.fn();
    const result = await resolvedGatewayImageSource({ id: 'external', filename: 'x.png', mimeType: 'image/png', uri: 'https://cdn.example/x.png' }, fetcher);
    expect(result).toEqual({ uri: 'https://cdn.example/x.png' });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('materializes ticketed bytes so the native image loader does not depend on authenticated routing', async () => {
    const fetcher = vi.fn(async () => new Response(new Uint8Array([137, 80, 78, 71]))) as unknown as typeof fetch;
    const result = await materializedGatewayImageSource({ uri: 'https://gateway.example/dashboard/__openclaw__/assistant-media?mediaTicket=ticket', headers }, 'image/png', fetcher);
    expect(result.uri).toBe('data:image/png;base64,iVBORw==');
    expect(fetcher).toHaveBeenCalledWith('https://gateway.example/dashboard/__openclaw__/assistant-media?mediaTicket=ticket', { signal: expect.any(AbortSignal) });
  });

  it('materializes an authenticated OpenClaw 2 managed image route directly', async () => {
    const fetcher = vi.fn(async () => new Response(new Uint8Array([255, 216, 255]), {
      headers: { 'content-type': 'image/jpeg' },
    })) as unknown as typeof fetch;
    const route = 'https://gateway.example/api/chat/media/outgoing/agent%3Amain%3Adashboard%3A1732a307-9e3a-4d59-aafb-c02f9d935d3c/00000000-0000-4000-9000-000000000154/full';
    const dashboardHeaders = { ...headers, 'x-openclaw-requester-session-key': 'agent:main:dashboard:00000000-0000-4000-a000-000000000115' };

    const result = await materializedGatewayImageSource({ uri: route, headers: dashboardHeaders }, 'image/jpeg', fetcher);

    expect(result.uri).toBe('data:image/jpeg;base64,/9j/');
    expect(fetcher).toHaveBeenCalledWith(route, { headers: dashboardHeaders, signal: expect.any(AbortSignal) });
  });

  it('falls back to the same authenticated media route when an issued ticket is rejected', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce({ ok: false, status: 404 })
      .mockResolvedValueOnce(new Response(new Uint8Array([137, 80, 78, 71]))) as unknown as typeof fetch;
    const result = await materializedGatewayImageSource({
      uri: 'https://gateway.example/dashboard/__openclaw__/assistant-media?source=%2Ftmp%2Fprobe.png&mediaTicket=ticket', headers,
    }, 'image/png', fetcher);
    expect(fetcher).toHaveBeenNthCalledWith(1, 'https://gateway.example/dashboard/__openclaw__/assistant-media?source=%2Ftmp%2Fprobe.png&mediaTicket=ticket', { signal: expect.any(AbortSignal) });
    expect(fetcher).toHaveBeenNthCalledWith(2, 'https://gateway.example/dashboard/__openclaw__/assistant-media?source=%2Ftmp%2Fprobe.png', { headers, signal: expect.any(AbortSignal) });
    expect(result).toEqual({ uri: 'data:image/png;base64,iVBORw==', diagnostic: 'authenticated-direct-materialized-ok' });
  });

  it('returns a nonblank failure source instead of handing a rejected ticket to the native decoder', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce({ ok: false, status: 404 })
      .mockResolvedValueOnce({ ok: false, status: 404 }) as unknown as typeof fetch;
    const result = await materializedGatewayImageSource({
      uri: 'https://gateway.example/dashboard/__openclaw__/assistant-media?source=%2Ftmp%2Fprobe.png&mediaTicket=ticket', headers,
    }, 'image/png', fetcher);
    expect(result).toEqual({ uri: '', diagnostic: 'media-fetch-rejected-404' });
  });

  it('re-resolves the same historical image after a transient unavailable result', async () => {
    const attachment = {
      id: 'transient-history-image', filename: 'transient-history-image.png', mimeType: 'image/png',
      uri: 'https://gateway.example/__openclaw__/assistant-media?source=%2Ftmp%2Ftransient-history-image.png', headers,
    };
    let ticketFetch = 0;
    const fetcher = vi.fn(async (input: string) => {
      if (input.includes('meta=1')) return { ok: true, json: async () => ({ available: true, mediaTicket: `ticket-${ticketFetch + 1}` }) };
      if (input.includes('mediaTicket=')) {
        ticketFetch += 1;
        if (ticketFetch === 1) return { ok: false, status: 404 };
        return new Response(new Uint8Array([137, 80, 78, 71]));
      }
      return { ok: false, status: 404 };
    }) as unknown as typeof fetch;

    invalidateGatewayImageSource(attachment);
    vi.stubGlobal('fetch', fetcher);
    try {
      expect(await cachedGatewayImageSource(attachment)).toEqual({ uri: '', diagnostic: 'media-fetch-rejected-404' });
      expect(await cachedGatewayImageSource(attachment)).toEqual({ uri: 'data:image/png;base64,iVBORw==' });
      expect(ticketFetch).toBe(2);
    } finally {
      invalidateGatewayImageSource(attachment);
      vi.unstubAllGlobals();
    }
  });

  it('continues sharing a successfully materialized historical image', async () => {
    const attachment = {
      id: 'stable-history-image', filename: 'stable-history-image.png', mimeType: 'image/png',
      uri: 'https://gateway.example/__openclaw__/assistant-media?source=%2Ftmp%2Fstable-history-image.png', headers,
    };
    let ticketFetch = 0;
    const fetcher = vi.fn(async (input: string) => {
      if (input.includes('meta=1')) return { ok: true, json: async () => ({ available: true, mediaTicket: 'stable-ticket' }) };
      ticketFetch += 1;
      return new Response(new Uint8Array([137, 80, 78, 71]));
    }) as unknown as typeof fetch;

    invalidateGatewayImageSource(attachment);
    vi.stubGlobal('fetch', fetcher);
    try {
      const first = cachedGatewayImageSource(attachment);
      const second = cachedGatewayImageSource(attachment);
      expect(second).toBe(first);
      await expect(first).resolves.toEqual({ uri: 'data:image/png;base64,iVBORw==' });
      await expect(cachedGatewayImageSource(attachment)).resolves.toEqual({ uri: 'data:image/png;base64,iVBORw==' });
      expect(ticketFetch).toBe(1);
    } finally {
      invalidateGatewayImageSource(attachment);
      vi.unstubAllGlobals();
    }
  });

  it('recovers the host path used by an authenticated assistant-media URL for an iOS Files fallback', () => {
    expect(gatewayLocalImagePath({
      id: 'one', filename: 'probe.png', mimeType: 'image/png',
      uri: 'https://gateway.example/dashboard/__openclaw__/assistant-media?source=%2FUsers%2Ffixture%2FLibrary%2FMobile%20Documents%2Fcom~apple~CloudDocs%2Fnotes%2Fprobe.png', headers,
    })).toBe('/Users/fixture/Library/Mobile Documents/com~apple~CloudDocs/notes/probe.png');
    expect(gatewayLocalImagePath({
      id: 'two', filename: 'out.png', mimeType: 'image/png',
      uri: 'https://gateway.example/__openclaw__/assistant-media?source=media%3A%2F%2Foutgoing%2Fone', headers,
    })).toBe('');
  });
});
