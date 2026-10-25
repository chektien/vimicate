import type { GatewayArtifactResolver } from '../gateway/gatewayArtifactDownload';
import type { WorkspaceAttachment } from '../workspace/workspaceTypes';
import { fromByteArray } from 'base64-js';
import { GatewayImageRequestCache, type ImageNetworkSource } from './gatewayImageRequestCache';
import { boundedImageBytes, discardImageBody } from './boundedImageBytes';

type FetchResponse = { ok: boolean; json: () => Promise<unknown> };
type Fetcher = (input: string, init?: { headers?: Record<string, string>; signal?: AbortSignal }) => Promise<FetchResponse>;

export type { ImageNetworkSource } from './gatewayImageRequestCache';
const resolvedSourceCache = new GatewayImageRequestCache();

export function cachedGatewayImageSource(attachment: WorkspaceAttachment, resolveArtifact?: GatewayArtifactResolver) {
  if (attachment.artifactId && attachment.artifactSessionKey) {
    return resolvedSourceCache.get(gatewayImageCacheKey(attachment), async signal => {
      if (!resolveArtifact) return failedImageSource('artifact-connection-unavailable');
      const source = await resolveArtifact(attachment.artifactId!, attachment.artifactSessionKey!, signal);
      return materializedGatewayImageSource(source, attachment.mimeType, fetch, signal);
    });
  }
  // Local bytes and ordinary native-loader URLs need no serialized Gateway work.
  if (!assistantMediaRequest(attachment) && !attachment.uri?.includes('mediaTicket=')) return Promise.resolve(originalImageSource(attachment));
  return resolvedSourceCache.get(gatewayImageCacheKey(attachment), async signal =>
    materializedGatewayImageSource(await resolvedGatewayImageSource(attachment, fetch, signal), attachment.mimeType, fetch, signal));
}

export function invalidateGatewayImageSource(attachment: WorkspaceAttachment) {
  resolvedSourceCache.invalidate(gatewayImageCacheKey(attachment));
}

export async function resolvedGatewayImageSource(attachment: WorkspaceAttachment, fetcher: Fetcher = fetch, signal?: AbortSignal) : Promise<ImageNetworkSource> {
  const original = originalImageSource(attachment);
  const request = assistantMediaRequest(attachment);
  if (!request) return original;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    for (const candidate of request.candidates) {
      for (const metaURL of candidate.metaURLs) {
        try {
          assertActive(signal);
          const scopedMeta = new URL(metaURL);
          const sessionKey = attachment.headers?.['x-openclaw-requester-session-key'];
          // The current Gateway authorizes assistant-media by this query scope,
          // not the legacy requester header. Keep ticket minting and bytes in
          // the attachment's originating thread without expanding media roots.
          if (sessionKey) scopedMeta.searchParams.set('sessionKey', sessionKey);
          const response = await fetcher(scopedMeta.toString(), requestOptions(attachment.headers, signal));
          assertActive(signal);
          if (!response.ok) continue;
          const payload = await response.json(); assertActive(signal);
          if (!isRecord(payload) || payload.available !== true || typeof payload.mediaTicket !== 'string' || !payload.mediaTicket) continue;
          const ticketed = new URL(scopedMeta); ticketed.search = '';
          ticketed.searchParams.set('source', candidate.source); ticketed.searchParams.set('mediaTicket', payload.mediaTicket);
          if (sessionKey) ticketed.searchParams.set('sessionKey', sessionKey);
          return { uri: ticketed.toString(), ...(attachment.headers ? { headers: attachment.headers } : {}) };
        } catch { assertActive(signal); /* Try the alternate control-UI base and bounded retry. */ }
      }
    }
    if (attempt < 2) await delay(250 * (attempt + 1), signal);
  }
  return original;
}

export async function materializedGatewayImageSource(source: ImageNetworkSource, mimeType: string, fetcher: typeof fetch = fetch, signal?: AbortSignal): Promise<ImageNetworkSource> {
  const ticketed = source.uri.includes('mediaTicket=');
  const authenticatedManagedRoute = isAuthenticatedManagedOutgoingSource(source);
  if (!ticketed && !authenticatedManagedRoute) return source;
  let transfer = new AbortController();
  let consumed = false;
  const abort = () => transfer.abort();
  signal?.addEventListener('abort', abort, { once: true });
  try {
    // A signed assistant-media ticket is the complete authority for the byte
    // request. Do not send the paired-device headers again: the Gateway mints
    // tickets specifically so a screenful of images can bypass device-token
    // auth/rate-limit handling, and its Control UI performs the same bare GET.
    assertActive(signal);
    let response = await fetcher(source.uri, authenticatedManagedRoute
      ? requestOptions(source.headers, transfer.signal)
      : { signal: transfer.signal });
    assertActive(signal);
    let usedAuthenticatedFallback = authenticatedManagedRoute;
    if (!response.ok && ticketed && source.headers?.Authorization) {
      await discardImageBody(response); transfer.abort(); assertActive(signal);
      transfer = new AbortController();
      const directURL = new URL(source.uri); directURL.searchParams.delete('mediaTicket');
      response = await fetcher(directURL.toString(), requestOptions(source.headers, transfer.signal)); usedAuthenticatedFallback = true;
      assertActive(signal);
    }
    if (!response.ok) { await discardImageBody(response); return failedImageSource(`media-fetch-rejected-${response.status}`); }
    const result = await boundedImageBytes(response, transfer.signal); assertActive(signal);
    consumed = 'bytes' in result || result.diagnostic === 'ticket-empty';
    if ('diagnostic' in result) return failedImageSource(result.diagnostic);
    const resolvedMimeType = mimeType.startsWith('image/') && mimeType !== 'image/*' ? mimeType : inferredTicketMimeType(source.uri);
    return { uri: `data:${resolvedMimeType};base64,${fromByteArray(result.bytes)}`, ...(usedAuthenticatedFallback ? { diagnostic: 'authenticated-direct-materialized-ok' } : {}) };
  } catch { return failedImageSource('ticket-fetch-failed'); }
  finally {
    signal?.removeEventListener('abort', abort);
    // Expo reader.cancel() stops delivery, not the URLSession request. Rejected
    // bodies need a transfer abort too, including before the first stream read.
    if (!consumed) transfer.abort();
  }
}

function isAuthenticatedManagedOutgoingSource(source: ImageNetworkSource) {
  if (!source.headers?.Authorization) return false;
  try { return new URL(source.uri).pathname.startsWith('/api/chat/media/outgoing/'); }
  catch { return false; }
}

export function gatewayLocalImagePath(attachment: WorkspaceAttachment) {
  if (!attachment.uri) return '';
  let url: URL; try { url = new URL(attachment.uri, 'https://vimicate.invalid'); } catch { return ''; }
  if (!url.pathname.endsWith('/__openclaw__/assistant-media')) return '';
  const source = url.searchParams.get('source')?.trim() ?? '';
  if (/^file:\/\//i.test(source)) {
    try { return decodeURIComponent(new URL(source).pathname); } catch { return ''; }
  }
  return source.startsWith('/') || source.startsWith('~/') ? source : '';
}

export function assistantMediaRequest(attachment: WorkspaceAttachment) {
  if (!attachment.uri || !attachment.headers?.Authorization) return null;
  let url: URL; try { url = new URL(attachment.uri); } catch { return null; }
  const suffix = '/__openclaw__/assistant-media';
  if (url.pathname.endsWith(suffix)) {
    const source = url.searchParams.get('source'); if (!source) return null;
    const preferredBase = url.pathname.slice(0, -suffix.length);
    const bases = [...new Set([preferredBase, '', '/dashboard'])];
    const candidate = assistantMediaCandidate(url.origin, suffix, source, bases);
    return { source, metaURLs: candidate.metaURLs, candidates: [candidate] };
  }
  const match = url.pathname.match(/^\/api\/chat\/media\/outgoing\/([^/]+)\/([0-9a-f-]{36})\/full$/i);
  if (!match?.[1] || !match[2]) return null;
  const source = `media://outgoing/${match[2].toLowerCase()}?sessionKey=${encodeURIComponent(decodeURIComponent(match[1]))}`;
  const sources = [source, managedOutboundFilenameSource(attachment)].filter((candidate): candidate is string => Boolean(candidate));
  const candidates = sources.map((candidate) => assistantMediaCandidate(url.origin, suffix, candidate, ['', '/dashboard']));
  return { source, metaURLs: candidates[0]?.metaURLs ?? [], candidates };
}

function assistantMediaCandidate(origin: string, suffix: string, source: string, bases: string[]) {
  return { source, metaURLs: bases.map((base) => {
    const meta = new URL(origin); meta.pathname = `${base}${suffix}`; meta.searchParams.set('meta', '1'); meta.searchParams.set('source', source); return meta.toString();
  }) };
}

function managedOutboundFilenameSource(attachment: WorkspaceAttachment) {
  const filename = attachment.filename.trim();
  if (!filename || filename === '.' || filename === '..' || filename.includes('/') || filename.includes('\\')) return '';
  if (!/\.(?:png|jpe?g|gif|webp|heic|tiff?|bmp)$/i.test(filename)) return '';
  return `~/.openclaw/media/outbound/${filename}`;
}

function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value); }
function failedImageSource(diagnostic: string): ImageNetworkSource { return { uri: '', diagnostic }; }
function gatewayImageCacheKey(attachment: WorkspaceAttachment) { return `${attachment.artifactId ?? ''}\u0000${attachment.artifactSessionKey ?? ''}\u0000${attachment.uri ?? ''}\u0000${attachment.headers?.Authorization ?? ''}\u0000${attachment.headers?.['x-openclaw-requester-session-key'] ?? ''}`; }
function originalImageSource(attachment: WorkspaceAttachment): ImageNetworkSource { return { uri: attachment.uri ?? '', ...(attachment.headers ? { headers: attachment.headers } : {}) }; }
function requestOptions(headers?: Record<string, string>, signal?: AbortSignal) { return headers || signal ? { ...(headers ? { headers } : {}), ...(signal ? { signal } : {}) } : undefined; }
function assertActive(signal?: AbortSignal) { if (signal?.aborted) throw new Error('Image request retired'); }
function delay(milliseconds: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    assertActive(signal);
    const finish = (aborted = false) => { clearTimeout(timer); signal?.removeEventListener('abort', cancel); aborted ? reject(new Error('Image request retired')) : resolve(); };
    const cancel = () => finish(true);
    const timer = setTimeout(finish, milliseconds);
    signal?.addEventListener('abort', cancel, { once: true });
  });
}
function inferredTicketMimeType(uri: string) { const extension = decodeURIComponent(uri).match(/\.(png|jpe?g|gif|webp|heic)(?:[?&]|$)/i)?.[1]?.toLowerCase(); return extension === 'jpg' || extension === 'jpeg' ? 'image/jpeg' : extension ? `image/${extension}` : 'image/png'; }
