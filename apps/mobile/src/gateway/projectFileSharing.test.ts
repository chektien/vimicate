import { expect, it, vi } from 'vitest';
import { fromByteArray } from 'base64-js';
// @ts-expect-error Vitest's Node runtime provides this test-only module.
import { createRequire } from 'node:module';
import { PROJECT_FILE_SHARE_CHUNK_BYTES, readProjectFileForSharing } from './projectFileSharing';

const root = { location: 'project' as const, projectId: 'synthetic' };
// React Native installs this polyfill, not Node's richer AbortSignal.
const require = createRequire(import.meta.url);
const nativeRequire = createRequire(require.resolve('react-native/package.json'));
const NativeAbortController = nativeRequire('abort-controller').AbortController as typeof AbortController;
const input = { projectId: root.projectId, path: 'folder/original.pdf', size: 8 * 1024 * 1024 + 17, mtimeMs: 7 };
function fixture() {
  const original = Uint8Array.from({ length: input.size }, (_, index) => index % 251);
  const request = vi.fn(async (_method: string, p: Record<string, unknown>) => ({ schemaVersion: 1, ...p,
    version: 'stable', mimeType: 'application/pdf', dataBase64: fromByteArray(original.slice(Number(p.offset), Number(p.offset) + PROJECT_FILE_SHARE_CHUNK_BYTES)) }));
  return { original, request };
}
it('transfers the complete original above preview limits using bounded sequential chunks', async () => {
  const f = fixture(); const result = await readProjectFileForSharing(f.request, root, input);
  expect(result.filename).toBe('original.pdf'); expect(result.mimeType).toBe('application/pdf');
  expect(result.dataBase64).toBe(fromByteArray(f.original));
  expect(f.request.mock.calls.length).toBe(Math.ceil(input.size / PROJECT_FILE_SHARE_CHUNK_BYTES));
  expect(f.request.mock.calls[1]![1]).toMatchObject({ offset: PROJECT_FILE_SHARE_CHUNK_BYTES, version: 'stable' });
});
it('downloads an oversized-preview video with the actual React Native abort signal', async () => {
  const controller = new NativeAbortController();
  expect(controller.signal.throwIfAborted).toBeUndefined();
  const size = 24 * 1024 * 1024 + 17;
  const original = new Uint8Array(size).fill(0x71);
  const request = vi.fn(async (_method: string, p: Record<string, unknown>) => ({ ...p, schemaVersion: 1,
    version: 'stable', mimeType: 'video/mp4', dataBase64: fromByteArray(original.subarray(Number(p.offset), Number(p.offset) + PROJECT_FILE_SHARE_CHUNK_BYTES)) }));
  const result = await readProjectFileForSharing(request, root, { ...input, path: 'movie.mp4', size, signal: controller.signal });
  expect(result).toEqual({ filename: 'movie.mp4', mimeType: 'video/mp4', dataBase64: fromByteArray(original) });
  expect(request).toHaveBeenCalledTimes(Math.ceil(size / PROJECT_FILE_SHARE_CHUNK_BYTES));
  expect(request.mock.calls.every(([method]) => method === 'vimicate.files.exportChunk')).toBe(true);
});
it.each(['before', 'pending', 'between'])('cancels a native transfer %s a chunk without returning partial bytes', async when => {
  const controller = new NativeAbortController();
  const f = fixture();
  const request = vi.fn(async (...args: Parameters<typeof f.request>) => {
    if (when === 'pending') return new Promise(() => {});
    const chunk = await f.request(...args); controller.abort(); return chunk;
  });
  if (when === 'before') controller.abort();
  const result = readProjectFileForSharing(request, root, { ...input, signal: controller.signal });
  if (when === 'pending') controller.abort();
  await expect(result).rejects.toThrow('File sharing cancelled.');
  expect(request).toHaveBeenCalledTimes(when === 'before' ? 0 : 1);
});
it.each([{ location: 'assistant-artifacts' }, { projectId: 'wrong' }, { path: 'other.pdf' }, { size: 3 },
  { mtimeMs: 0 }, { offset: 1 }, { version: '' }, { dataBase64: 'AA==' }, { mimeType: 'invalid' }, { dataBase64: '!!!!' }])('rejects malformed or cross-scope chunks %#', async override => {
  const f = fixture(); const request = vi.fn(async (...args: Parameters<typeof f.request>) => ({ ...await f.request(...args), ...override }));
  await expect(readProjectFileForSharing(request, root, input)).rejects.toThrow('Invalid original');
  expect(request).toHaveBeenCalledTimes(1);
});
it('rejects a changed version partway through without returning a partial original', async () => {
  const f = fixture(); const request = vi.fn(async (...args: Parameters<typeof f.request>) => ({ ...await f.request(...args), version: args[1].offset ? 'changed' : 'stable' }));
  await expect(readProjectFileForSharing(request, root, input)).rejects.toThrow('Invalid original');
  expect(request).toHaveBeenCalledTimes(2);
});
it('cancels a pending chunk promptly and never requests or publishes a later chunk', async () => {
  const controller = new AbortController(); let deliver!: (value: unknown) => void;
  const request = vi.fn(() => new Promise(resolve => { deliver = resolve; }));
  const result = readProjectFileForSharing(request, root, { ...input, signal: controller.signal });
  controller.abort(); await expect(result).rejects.toBeDefined(); deliver({});
  await Promise.resolve(); expect(request).toHaveBeenCalledTimes(1);
});
it('rejects oversize/stale identity before I/O and preserves empty unknown files', async () => {
  const request = vi.fn();
  await expect(readProjectFileForSharing(request, root, { ...input, size: 32 * 1024 * 1024 + 1 })).rejects.toThrow('32 MiB');
  await expect(readProjectFileForSharing(request, root, { ...input, projectId: 'other' })).rejects.toThrow();
  expect(request).not.toHaveBeenCalled();
  request.mockImplementation(async (_method, p) => ({ ...p, schemaVersion: 1, version: 'stable', mimeType: 'application/octet-stream', dataBase64: '' }));
  await expect(readProjectFileForSharing(request, root, { ...input, size: 0 })).resolves.toMatchObject({ dataBase64: '', mimeType: 'application/octet-stream' });
});

it('streams originals above 32 MiB into the sink without retaining or joining chunks', async () => {
  const size = 33 * 1024 * 1024 + 17;
  let received = 0;
  let writing = false;
  const request = vi.fn(async (_method: string, p: Record<string, unknown>) => {
    expect(writing).toBe(false);
    expect(p.transferMode).toBe('disk'); expect(p.offset).toBe(received);
    const count = Math.min(PROJECT_FILE_SHARE_CHUNK_BYTES, size - received);
    return { ...p, schemaVersion: 1, version: 'stable', mimeType: 'video/mp4', dataBase64: fromByteArray(new Uint8Array(count).fill(0x71)) };
  });
  const writeChunk = vi.fn(async (offset: number, encoded: string) => {
    writing = true;
    await Promise.resolve();
    const count = Math.min(PROJECT_FILE_SHARE_CHUNK_BYTES, size - received);
    expect(offset).toBe(received); expect(encoded).toBe(fromByteArray(new Uint8Array(count).fill(0x71)));
    received += count; writing = false;
  });
  const result = await readProjectFileForSharing(request, root, { ...input, path: 'movie.mp4', size, writeChunk });
  expect(received).toBe(size);
  expect(result).toEqual({ filename: 'movie.mp4', mimeType: 'video/mp4', streamed: true });
});
it('stops the stream on disk failure, cancellation during append and a changed host version', async () => {
  for (const reason of ['disk', 'cancel', 'version']) {
    const controller = new NativeAbortController();
    const f = fixture();
    const request = vi.fn(async (...args: Parameters<typeof f.request>) => ({ ...await f.request(...args),
      ...(reason === 'version' && args[1].offset ? { version: 'changed' } : {}) }));
    const writeChunk = vi.fn(async () => {
      if (reason === 'disk') throw new Error('Not enough free space');
      if (reason === 'cancel') controller.abort();
    });
    await expect(readProjectFileForSharing(request, root, { ...input, signal: controller.signal, writeChunk })).rejects.toThrow();
    expect(writeChunk).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledTimes(reason === 'version' ? 2 : 1);
  }
});
it('never sends unvalidated cross-scope bytes to the disk sink', async () => {
  const f = fixture(); const writeChunk = vi.fn();
  const request = vi.fn(async (...args: Parameters<typeof f.request>) => ({ ...await f.request(...args), projectId: 'other' }));
  await expect(readProjectFileForSharing(request, root, { ...input, writeChunk })).rejects.toThrow('Invalid original');
  expect(writeChunk).not.toHaveBeenCalled();
});
