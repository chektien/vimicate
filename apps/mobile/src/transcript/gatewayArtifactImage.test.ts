import { afterEach, expect, it, vi } from 'vitest';
import { gatewayAttachments } from '../workspace/historyMessageProjection';
import { decorateGatewayMedia } from '../gateway/gatewayMedia';
import { cachedGatewayImageSource, invalidateGatewayImageSource } from './gatewayImageSource';

const id = 'artifact_managed_image_12345678-1234-4234-8234-123456789abc';
const key = 'agent:fixture:image';
const uri = `/api/chat/media/outgoing/${encodeURIComponent(key)}/12345678-1234-4234-8234-123456789abc/full`;
const block = { type: 'image', artifactId: id, url: uri, mimeType: 'image/png', width: 1920, height: 819, sizeBytes: 4 };
afterEach(() => vi.unstubAllGlobals());

it('retains the explicit managed artifact identity from the native transcript through paired decoration', () => {
  const attachments = gatewayAttachments({ content: [block] });
  const [message] = decorateGatewayMedia([{ id: 'delivery', role: 'assistant', text: '', attachments }], 'wss://gateway.example', 'fixture', key);
  expect(message?.attachments).toHaveLength(1);
  expect(message?.attachments?.[0]).toMatchObject({ artifactId: id, artifactSessionKey: key, byteCount: 4, pixelWidth: 1920, pixelHeight: 819 });
});

it('uses the paired artifact RPC before a bare capability GET instead of probing legacy paths', async () => {
  const attachment = { id: 'delivery', artifactId: id, artifactSessionKey: key,
    uri: `https://gateway.example${uri}`, filename: 'generated.png', mimeType: 'image/png', headers: { Authorization: 'Bearer fixture' } };
  const resolve = vi.fn(async () => ({ uri: `https://gateway.example${uri}?mediaTicket=fixture-ticket` }));
  const fetcher = vi.fn(async (url: string, _init?: RequestInit) => url.includes('mediaTicket=fixture-ticket')
    ? new Response(new Uint8Array([137, 80, 78, 71])) : new Response(null, { status: 403 }));
  vi.stubGlobal('fetch', fetcher); invalidateGatewayImageSource(attachment);
  try {
    expect(await cachedGatewayImageSource(attachment, resolve)).toEqual({ uri: 'data:image/png;base64,iVBORw==' });
    expect(resolve).toHaveBeenCalledOnce();
    expect(resolve).toHaveBeenCalledWith(id, key, expect.any(AbortSignal));
    expect(fetcher).toHaveBeenCalledOnce();
    expect(fetcher.mock.calls[0]?.[1]).not.toHaveProperty('headers');
  } finally { invalidateGatewayImageSource(attachment); }
});
