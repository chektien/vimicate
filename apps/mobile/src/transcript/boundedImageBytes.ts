const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
type ImageByteResult = { bytes: Uint8Array } | { diagnostic: 'ticket-empty' | 'ticket-oversize' | 'ticket-stream-unavailable' };

/** Read only admitted chunks; never fall back to unbounded whole-body buffering. */
export async function boundedImageBytes(response: Response, signal?: AbortSignal): Promise<ImageByteResult> {
  const length = response.headers.get('content-length')?.trim();
  if (length && /^\d+$/.test(length) && Number(length) > MAX_IMAGE_BYTES) {
    await discardImageBody(response); return { diagnostic: 'ticket-oversize' };
  }
  const body = response.body;
  if (!body) return { diagnostic: body === null ? 'ticket-empty' : 'ticket-stream-unavailable' };
  const reader = body.getReader();
  // A growing byte buffer also bounds bookkeeping for streams of tiny chunks.
  let bytes = new Uint8Array(0);
  let count = 0; let completed = false;
  const cancel = async () => { try { await reader.cancel('Image read retired'); } catch { /* Already errored/closed. */ } };
  const abort = () => { void cancel(); };
  signal?.addEventListener('abort', abort, { once: true });
  const assertActive = () => { if (signal?.aborted) throw new Error('Image read retired'); };
  try {
    while (true) {
      assertActive();
      const { done, value } = await reader.read();
      assertActive();
      if (done) { completed = true; break; }
      if (value.byteLength > MAX_IMAGE_BYTES - count) return { diagnostic: 'ticket-oversize' };
      const nextCount = count + value.byteLength;
      if (nextCount > bytes.length) {
        const grown = new Uint8Array(Math.min(MAX_IMAGE_BYTES, Math.max(nextCount, bytes.length * 2, 64 * 1024)));
        grown.set(bytes.subarray(0, count)); bytes = grown;
      }
      bytes.set(value, count); count = nextCount;
    }
    if (!count) return { diagnostic: 'ticket-empty' };
    return { bytes: bytes.subarray(0, count) };
  } finally {
    signal?.removeEventListener('abort', abort);
    if (!completed) await cancel();
    reader.releaseLock();
  }
}

export async function discardImageBody(response: Response) {
  try { await response.body?.cancel('Image response rejected'); } catch { /* Already errored/closed. */ }
}
