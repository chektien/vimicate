import { expect, it } from 'vitest';
import { fileLocationFromPayload, locatedFileContentFromPayload, locatedFileListFromPayload } from './locatedFiles';
import { documentPreviewMimeTypes } from './documentPreviewTypes';

const root = { location: 'assistant-artifacts' as const, projectId: 'assistant-artifacts', rootPath: '/fixture/artifacts' };
const resolved = { schemaVersion: 1, ...root, path: 'demo/report.pdf' };
const content = { ...resolved, kind: 'document', mimeType: 'application/pdf', size: 4, mtimeMs: 1, dataBase64: 'ZGVtbw==' };
it('accepts explicit roots, exact scoped document bytes and every supported document MIME', () => {
  expect(fileLocationFromPayload(resolved)).toEqual({ ...root, path: resolved.path });
  expect(fileLocationFromPayload({ ...resolved, path: '' }).path).toBe('');
  for (const mimeType of documentPreviewMimeTypes) {
    expect(locatedFileContentFromPayload({ ...content, mimeType }, root, resolved.path)).toMatchObject({ kind: 'document', mimeType, dataBase64: 'ZGVtbw==' });
  }
});
it.each([
  { location: 'home' }, { projectId: 'notes' }, { path: '../outside' }, { path: '/absolute' },
  { rootPath: 'relative' }, { rootPath: '/root/../other' }, { rootPath: '/root/./other' },
  { rootPath: '/root\\other' }, { schemaVersion: 2 }, { projectId: '' },
])('rejects unsafe or ambiguous resolved identity %#', (override) => {
  expect(() => fileLocationFromPayload({ ...resolved, ...override })).toThrow();
});
it.each([
  { location: 'project' }, { projectId: 'other' }, { path: 'demo/other.pdf' },
  { dataBase64: 'broken' }, { size: 5 }, { size: 8 * 1024 * 1024 + 1 },
  { mimeType: 'text/html' }, { mimeType: 'application/octet-stream' }, { text: 'extra' },
])('rejects cross-scope or invalid native document content %#', (override) => {
  expect(() => locatedFileContentFromPayload({ ...content, ...override }, root, resolved.path)).toThrow();
});
it('keeps unsupported siblings as metadata and rejects substituted roots or unrelated entries', () => {
  const entry = { name: 'opaque.bin', path: 'demo/opaque.bin', kind: 'unsupported', size: 4, mtimeMs: 1 };
  const list = { ...resolved, path: 'demo', entries: [entry] };
  expect(locatedFileListFromPayload(list, root, 'demo').entries).toEqual([entry]);
  expect(() => locatedFileListFromPayload({ ...list, location: 'project' }, root, 'demo')).toThrow();
  expect(() => locatedFileListFromPayload({ ...list, entries: [{ ...entry, path: 'elsewhere/opaque.bin' }] }, root, 'demo')).toThrow();
});
