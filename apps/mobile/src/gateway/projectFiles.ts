import { documentPreviewMimeTypes } from './documentPreviewTypes';

export type ProjectFileEntry = {
  name: string;
  path: string;
  kind: 'directory' | 'text' | 'image' | 'document' | 'unsupported';
  mimeType?: string;
  size: number;
  mtimeMs: number;
};

export type ProjectFileList = {
  projectId: string;
  path: string;
  entries: ProjectFileEntry[];
};

export type ProjectFileContent = {
  projectId: string;
  path: string;
  kind: 'text';
  mimeType: string;
  size: number;
  mtimeMs: number;
  text: string;
} | {
  projectId: string;
  path: string;
  kind: 'image' | 'document';
  mimeType: string;
  size: number;
  mtimeMs: number;
  dataBase64: string;
};

export const SHARED_DOWNLOADS_LOCATION = 'icloud-downloads';

export function sharedFileResolutionFromPayload(value: unknown): { path: string } {
  const payload = record(value);
  if (payload.schemaVersion !== 1 || payload.location !== SHARED_DOWNLOADS_LOCATION) throw new Error('Invalid shared file resolution');
  return { path: relativePath(payload.path, false) };
}

export function sharedProjectFileListFromPayload(value: unknown, expectedProjectId: string, expectedPath: string): ProjectFileList {
  if (record(value).location !== SHARED_DOWNLOADS_LOCATION) throw new Error('Invalid shared file list response');
  return projectFileListFromPayload(value, expectedProjectId, expectedPath);
}

export function sharedProjectFileContentFromPayload(value: unknown, expectedProjectId: string, expectedPath: string): ProjectFileContent {
  if (record(value).location !== SHARED_DOWNLOADS_LOCATION) throw new Error('Invalid shared file response');
  return projectFileContentFromPayload(value, expectedProjectId, expectedPath);
}

const textMimeTypes = new Set([
  'application/json', 'application/xml', 'application/yaml', 'text/css', 'text/csv',
  'text/html', 'text/javascript', 'text/markdown', 'text/plain', 'text/typescript',
]);
const imageMimeTypes = new Set([
  'image/bmp', 'image/gif', 'image/heic', 'image/heif', 'image/jpeg', 'image/png',
  'image/svg+xml', 'image/webp', 'image/x-icon',
]);

export function projectFileListFromPayload(value: unknown, expectedProjectId?: string, expectedPath?: string): ProjectFileList {
  const payload = record(value);
  const projectId = projectID(payload.projectId);
  const parentPath = relativePath(payload.path, true);
  if (payload.schemaVersion !== 1 || expectedProjectId !== undefined && projectId !== expectedProjectId
    || expectedPath !== undefined && parentPath !== expectedPath || !Array.isArray(payload.entries)
    || payload.entries.length > 4096) throw new Error('Invalid project file list response');
  const names = new Set<string>();
  const entries = payload.entries.flatMap((candidate) => {
    const entry = record(candidate);
    // Older hosts may list a valid macOS name that this relative-path contract cannot address.
    if (typeof entry.name === 'string' && entry.name.includes('\\')) return [];
    const name = fileName(entry.name);
    const childPath = relativePath(entry.path, false);
    const kind = entry.kind;
    const size = boundedInteger(entry.size, Number.MAX_SAFE_INTEGER);
    const mtimeMs = boundedInteger(entry.mtimeMs, Number.MAX_SAFE_INTEGER);
    if (!['directory', 'text', 'image', 'document', 'unsupported'].includes(String(kind)) || names.has(name)
      || childPath !== (parentPath ? `${parentPath}/${name}` : name)
      || kind === 'directory' && (size !== 0 || entry.mimeType !== undefined)
      || kind === 'unsupported' && (entry.mimeType !== undefined || entry.text !== undefined || entry.dataBase64 !== undefined)
      || kind === 'text' && !textMimeTypes.has(entry.mimeType as string)
      || kind === 'image' && !imageMimeTypes.has(entry.mimeType as string)
      || kind === 'document' && !documentPreviewMimeTypes.has(entry.mimeType as string)) {
      throw new Error('Invalid project file list response');
    }
    names.add(name);
    return [{ name, path: childPath, kind: kind as ProjectFileEntry['kind'],
      ...(typeof entry.mimeType === 'string' ? { mimeType: entry.mimeType } : {}), size, mtimeMs }];
  });
  return { projectId, path: parentPath, entries };
}

export function projectFileContentFromPayload(value: unknown, expectedProjectId?: string, expectedPath?: string): ProjectFileContent {
  const payload = record(value);
  const projectId = projectID(payload.projectId);
  const filePath = relativePath(payload.path, false);
  const size = boundedInteger(payload.size, 8 * 1024 * 1024);
  const mtimeMs = boundedInteger(payload.mtimeMs, Number.MAX_SAFE_INTEGER);
  if (payload.schemaVersion !== 1 || expectedProjectId !== undefined && projectId !== expectedProjectId
    || expectedPath !== undefined && filePath !== expectedPath) throw new Error('Invalid project file response');
  if (payload.kind === 'text' && textMimeTypes.has(payload.mimeType as string)
    && size <= 1024 * 1024 && typeof payload.text === 'string' && payload.text.length <= 1024 * 1024
    && utf8ByteLength(payload.text) === size && payload.dataBase64 === undefined) {
    return { projectId, path: filePath, kind: 'text', mimeType: payload.mimeType as string, size, mtimeMs, text: payload.text };
  }
  if ((payload.kind === 'image' && imageMimeTypes.has(payload.mimeType as string)
    || payload.kind === 'document' && documentPreviewMimeTypes.has(payload.mimeType as string))
    && typeof payload.dataBase64 === 'string' && canonicalBase64Size(payload.dataBase64) === size
    && payload.text === undefined) {
    return { projectId, path: filePath, kind: payload.kind as 'image' | 'document', mimeType: payload.mimeType as string,
      size, mtimeMs, dataBase64: payload.dataBase64 };
  }
  throw new Error('Invalid project file response');
}

function canonicalBase64Size(value: string) {
  if (value.length > 11_184_812 || value.length % 4 !== 0
    || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(value)) return -1;
  const padding = value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0;
  return value.length / 4 * 3 - padding;
}
function utf8ByteLength(value: string) {
  let bytes = 0;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x7f) bytes += 1;
    else if (code <= 0x7ff) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff) {
      const low = value.charCodeAt(index + 1);
      if (low < 0xdc00 || low > 0xdfff) return -1;
      bytes += 4; index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) return -1;
    else bytes += 3;
  }
  return bytes;
}
function boundedInteger(value: unknown, max: number) {
  if (!Number.isSafeInteger(value) || (value as number) < 0 || (value as number) > max) throw new Error('Invalid project file response');
  return value as number;
}
function projectID(value: unknown) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9._-]{1,128}$/u.test(value)) throw new Error('Invalid project file response');
  return value;
}
function fileName(value: unknown) {
  if (typeof value !== 'string' || !value || value.length > 255 || value === '.' || value === '..'
    || value.includes('/') || value.includes('\\') || value.includes('\0')) throw new Error('Invalid project file response');
  return value;
}
function relativePath(value: unknown, allowRoot: boolean) {
  if (typeof value !== 'string' || value.length > 4096 || value.includes('\0') || value.includes('\\')
    || value.startsWith('/') || (!value && !allowRoot)) throw new Error('Invalid project file response');
  if (value && value.split('/').some(part => !part || part === '.' || part === '..')) throw new Error('Invalid project file response');
  return value;
}
function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
