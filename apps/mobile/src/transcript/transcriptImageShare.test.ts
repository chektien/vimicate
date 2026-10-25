import { describe, expect, it, vi } from 'vitest';
import { prepareTranscriptImageShare } from './transcriptImageShare';
const image = { filename: 'screen.png', mimeType: 'image/png' };
const signal = () => new AbortController().signal;
const open = vi.fn();
describe('transcript image share bytes', () => {
  it('shares the complete resolved image, never its ticket URL or headers', async () => {
    const payload = await prepareTranscriptImageShare({ uri: 'data:image/png;base64,AQID', headers: { Authorization: 'private' } }, image, signal(), open);
    expect(payload).toEqual({ dataBase64: 'AQID', filename: 'screen.png', mimeType: 'image/png' });
  });
  it('reads local images with a bound and closes the reader', async () => {
    const close = vi.fn(); const readBytes = vi.fn(() => new Uint8Array([1, 2, 3]));
    const result = await prepareTranscriptImageShare({ uri: 'file:///private/screen.png' }, image, signal(), () => ({ size: 3, readBytes, close }));
    expect(result.dataBase64).toBe('AQID'); expect(readBytes).toHaveBeenCalledWith(8 * 1024 * 1024 + 1); expect(close).toHaveBeenCalledOnce();
  });
  it('fetches remote bytes with the supplied source authority, never sharing the URL', async () => {
    const fetcher = vi.fn(async () => new Response(new Uint8Array([1, 2, 3]), { headers: { 'content-type': 'image/jpeg' } }));
    const result = await prepareTranscriptImageShare({ uri: 'https://gateway.invalid/image', headers: { Authorization: 'private' } }, image, signal(), open, fetcher);
    expect(fetcher).toHaveBeenCalledWith('https://gateway.invalid/image', expect.objectContaining({ headers: { Authorization: 'private' } }));
    expect(result).toEqual({ dataBase64: 'AQID', filename: 'screen.jpg', mimeType: 'image/jpeg' });
  });
  it.each(['', 'data:image/png;base64,', 'data:image/png;base64,!!!!', 'data:text/html;base64,AQID', 'media://missing'])('rejects unavailable or invalid source %s', async uri => {
    await expect(prepareTranscriptImageShare({ uri }, image, signal(), open)).rejects.toThrow();
  });
  it('rejects oversize bytes without reading the local file', async () => {
    const readBytes = vi.fn(); const close = vi.fn();
    await expect(prepareTranscriptImageShare({ uri: 'file:///large.png' }, image, signal(), () => ({ size: 9 * 1024 * 1024, readBytes, close }))).rejects.toThrow('8 MiB');
    expect(readBytes).not.toHaveBeenCalled(); expect(close).toHaveBeenCalledOnce();
  });
  it('rejects a download completed after cancellation', async () => {
    const abort = new AbortController();
    const fetcher = vi.fn(async () => { abort.abort(); return new Response(new Uint8Array([1])); });
    await expect(prepareTranscriptImageShare({ uri: 'https://example.invalid/a.png' }, image, abort.signal, open, fetcher)).rejects.toThrow();
  });
  it.each([403, 200])('aborts the actual transfer on HTTP rejection or oversized body (%s)', async status => {
    let transfer: AbortSignal | null | undefined;
    const fetcher = vi.fn(async (_url: unknown, init?: RequestInit) => {
      transfer = init?.signal;
      return new Response(new Uint8Array([1]), { status, headers: { 'content-length': '99999999' } });
    });
    await expect(prepareTranscriptImageShare({ uri: 'https://example.invalid/a.png' }, image, signal(), open, fetcher)).rejects.toThrow();
    expect(transfer?.aborted).toBe(true);
  });
  it('strips host paths and supplies an image extension for sharing', async () => {
    expect(await prepareTranscriptImageShare({ uri: 'data:image/png;base64,AQID' }, { ...image, filename: '/Users/private/image' }, signal(), open)).toMatchObject({ filename: 'image.png' });
  });
});
