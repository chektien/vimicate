import { byteLength, fromByteArray } from 'base64-js';
import type { WorkspaceAttachment } from '../workspace/workspaceTypes';
import type { ImageNetworkSource } from './gatewayImageSource';
import { boundedImageBytes, discardImageBody } from './boundedImageBytes';

type Reader = { readonly size?: number | null; readBytes(length: number): Uint8Array; close(): void };
const limit = 8 * 1024 * 1024;
const tooLarge = () => new Error('Images larger than 8 MiB cannot be shared here.');
const assertActive = (signal: AbortSignal) => { if (signal.aborted) throw new Error('Image sharing interrupted.'); };
const unavailable = () => new Error('This image could not be prepared for sharing. Retry the image and try again.');
const extensions: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp', 'image/heic': 'heic', 'image/heif': 'heif', 'image/tiff': 'tiff', 'image/bmp': 'bmp', 'image/svg+xml': 'svg', 'image/avif': 'avif' };

/** Share bytes from the resolved source, never a host path, ticket, or viewer screenshot. */
export async function prepareTranscriptImageShare(source: ImageNetworkSource, attachment: Pick<WorkspaceAttachment, 'filename' | 'mimeType'>,
  signal: AbortSignal, openReader: (uri: string) => Reader, fetcher: typeof fetch = fetch) {
  assertActive(signal);
  let mimeType = attachment.mimeType.toLowerCase(); let dataBase64: string;
  if (source.uri.startsWith('data:')) {
    const comma = source.uri.indexOf(',');
    const header = source.uri.slice(0, comma).match(/^data:(image\/[a-z0-9.+-]+);base64$/i);
    if (!header) throw unavailable();
    mimeType = header[1]!.toLowerCase(); dataBase64 = source.uri.slice(comma + 1);
  } else if (source.uri.startsWith('file://')) {
    const reader = openReader(source.uri);
    let bytes: Uint8Array;
    try { if (typeof reader.size === 'number' && reader.size > limit) throw tooLarge(); bytes = reader.readBytes(limit + 1); }
    finally { reader.close(); }
    if (bytes.byteLength > limit) throw tooLarge();
    dataBase64 = fromByteArray(bytes);
  } else if (/^https?:\/\//i.test(source.uri)) {
    const transfer = new AbortController(); let consumed = false;
    const abort = () => transfer.abort(); signal.addEventListener('abort', abort, { once: true });
    try {
      assertActive(signal);
      const response = await fetcher(source.uri, { ...(source.headers ? { headers: source.headers } : {}), signal: transfer.signal });
      if (signal.aborted || !response.ok) { await discardImageBody(response); assertActive(signal); throw unavailable(); }
      const result = await boundedImageBytes(response, transfer.signal);
      consumed = 'bytes' in result || result.diagnostic === 'ticket-empty';
      if ('diagnostic' in result) { if (result.diagnostic === 'ticket-oversize') throw tooLarge(); throw unavailable(); }
      const contentType = response.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase();
      if (contentType?.startsWith('image/')) mimeType = contentType;
      else if (contentType && contentType !== 'application/octet-stream') throw unavailable();
      dataBase64 = fromByteArray(result.bytes);
    } finally { signal.removeEventListener('abort', abort); if (!consumed) transfer.abort(); }
  } else throw unavailable();
  assertActive(signal);
  if (dataBase64.length > 4 * Math.ceil(limit / 3)) throw tooLarge();
  if (!dataBase64 || dataBase64.length % 4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(dataBase64)) throw unavailable();
  if (byteLength(dataBase64) > limit) throw tooLarge();
  const extension = extensions[mimeType]; if (!extension) throw unavailable();
  let filename = attachment.filename.split(/[\\/]/).pop()?.replace(/[\x00-\x1f\x7f]/g, '').trim() || 'image';
  // The extension drives iOS activity type detection. Do not offer a PNG as a .txt URL.
  filename = filename.replace(/\.[^.]*$/, '').slice(0, 80) || 'image';
  return { dataBase64, filename: `${filename}.${extension}`, mimeType };
}
