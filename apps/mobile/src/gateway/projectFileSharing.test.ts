import { expect, it, vi } from 'vitest';
import { fromByteArray } from 'base64-js';
import { PROJECT_FILE_SHARE_CHUNK_BYTES, readProjectFileForSharing } from './projectFileSharing';

const root = { location: 'project' as const, projectId: 'synthetic' };
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
