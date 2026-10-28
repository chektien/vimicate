import { fromByteArray, toByteArray } from 'base64-js';
import type { FileLocation } from './locatedFiles';
import { projectFileListFromPayload } from './projectFiles';

export const PROJECT_FILE_SHARE_MAX_BYTES = 32 * 1024 * 1024;
export const PROJECT_FILE_SHARE_CHUNK_BYTES = 196608;
export type ProjectFileShareInput = { projectId: string; path: string; size: number; mtimeMs: number; signal?: AbortSignal;
  writeChunk?: (offset: number, dataBase64: string) => Promise<void> };
export type ProjectFileShareTransfer = { filename: string; mimeType: string } &
  ({ dataBase64: string; streamed?: never } | { streamed: true; dataBase64?: never });
export type ProjectFileShareReader = (input: ProjectFileShareInput) => Promise<ProjectFileShareTransfer>;
type Root = { location: FileLocation; projectId: string };
type Request = (method: string, params: Record<string, unknown>, timeoutMs: number) => Promise<unknown>;

/** Sequential validated chunks with sink backpressure. Only legacy callers retain the whole original. */
export async function readProjectFileForSharing(request: Request, root: Root, input: ProjectFileShareInput): Promise<ProjectFileShareTransfer> {
  projectFileListFromPayload({ schemaVersion: 1, projectId: input.projectId, path: input.path, entries: [] }, root.projectId, input.path);
  if (!input.path || !Number.isSafeInteger(input.size) || input.size < 0 || !input.writeChunk && input.size > PROJECT_FILE_SHARE_MAX_BYTES
    || !Number.isSafeInteger(input.mtimeMs) || input.mtimeMs < 0) throw new Error('This file exceeds the 32 MiB sharing limit or has invalid metadata.');
  const chunks: string[] = []; let offset = 0; let version: string | undefined; let mimeType: string | undefined;
  do {
    assertActive(input.signal);
    const raw = await abortable(request('vimicate.files.exportChunk', { ...root, path: input.path,
      size: input.size, mtimeMs: input.mtimeMs, offset, ...(input.writeChunk ? { transferMode: 'disk' } : {}),
      ...(version ? { version } : {}) }, 20000), input.signal);
    assertActive(input.signal);
    const p = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
    const expectedBytes = Math.min(PROJECT_FILE_SHARE_CHUNK_BYTES, input.size - offset);
    if (p.schemaVersion !== 1 || p.location !== root.location || p.projectId !== root.projectId || p.path !== input.path
      || p.size !== input.size || p.mtimeMs !== input.mtimeMs || p.offset !== offset
      || typeof p.version !== 'string' || !p.version || p.version.length > 256 || version !== undefined && version !== p.version
      || typeof p.mimeType !== 'string' || !/^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/iu.test(p.mimeType) || p.mimeType.length > 128
      || mimeType !== undefined && mimeType !== p.mimeType || typeof p.dataBase64 !== 'string'
      || p.dataBase64.length !== Math.ceil(expectedBytes / 3) * 4 || !canonicalChunk(p.dataBase64, expectedBytes)) {
      throw new Error('Invalid original file transfer response.');
    }
    if (input.writeChunk) {
      await abortable(input.writeChunk(offset, p.dataBase64), input.signal);
      assertActive(input.signal);
    } else chunks.push(p.dataBase64);
    version = p.version; mimeType = p.mimeType;
    offset += expectedBytes;
  } while (offset < input.size);
  assertActive(input.signal);
  const metadata = { filename: input.path.split('/').pop()!, mimeType: mimeType! };
  return input.writeChunk ? { ...metadata, streamed: true } : { ...metadata, dataBase64: chunks.join('') };
}

// React Native's abort-controller polyfill has aborted/listeners but no
// throwIfAborted method. Do not depend on Node/browser-only signal helpers.
function assertActive(signal?: AbortSignal) {
  if (signal?.aborted) throw signal.reason ?? new Error('File sharing cancelled.');
}

function canonicalChunk(value: string, size: number) {
  try { const bytes = toByteArray(value); return bytes.length === size && fromByteArray(bytes) === value; }
  catch { return false; }
}
function abortable<T>(pending: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return pending;
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason ?? new Error('File sharing cancelled.'));
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
    pending.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}
