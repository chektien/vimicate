import { describe, expect, it, vi } from 'vitest';
import { projectFileContentFromPayload, projectFileListFromPayload, sharedFileResolutionFromPayload, sharedProjectFileContentFromPayload, sharedProjectFileListFromPayload } from './projectFiles';

const list = {
  schemaVersion: 1,
  projectId: 'notes',
  path: 'daily',
  entries: [
    { name: '2026-09-21.md', path: 'daily/2026-09-21.md', kind: 'text', mimeType: 'text/markdown', size: 12, mtimeMs: 10 },
    { name: '.assets', path: 'daily/.assets', kind: 'directory', size: 0, mtimeMs: 9 },
    { name: 'figure.png', path: 'daily/figure.png', kind: 'image', mimeType: 'image/png', size: 4, mtimeMs: 8 },
  ],
};

describe('project file Gateway payload validation', () => {
  it('accepts a scoped list without exposing a host root', () => {
    expect(projectFileListFromPayload(list, 'notes', 'daily')).toEqual({
      projectId: 'notes', path: 'daily', entries: list.entries,
    });
  });

  it('keeps representable entries when a host lists an unsupported backslash name', () => {
    const unsupported = { ...list.entries[0], name: 'odd\\name.md', path: 'daily/odd\\name.md' };
    expect(projectFileListFromPayload({ ...list, entries: [unsupported, ...list.entries] }, 'notes', 'daily').entries)
      .toEqual(list.entries);
  });

  it('accepts metadata-only non-previewable files, without accepting them as readable content', () => {
    const entry = { name: 'report.pdf', path: 'daily/report.pdf', kind: 'unsupported', size: 12, mtimeMs: 10 };
    expect(projectFileListFromPayload({ ...list, entries: [entry] }, 'notes', 'daily').entries).toEqual([entry]);
    expect(() => projectFileContentFromPayload({ schemaVersion: 1, projectId: 'notes', ...entry, dataBase64: 'AAAA' })).toThrow();
    expect(() => projectFileListFromPayload({ ...list, entries: [{ ...entry, mimeType: 'text/plain' }] }, 'notes', 'daily')).toThrow();
    expect(() => projectFileListFromPayload({ ...list, entries: [{ ...entry, dataBase64: 'AAAA' }] }, 'notes', 'daily')).toThrow();
  });

  it.each([
    { ...list, projectId: 'other' },
    { ...list, path: '../outside' },
    { ...list, entries: [{ ...list.entries[0], path: 'elsewhere.md' }] },
    { ...list, entries: [list.entries[0], list.entries[0]] },
    { ...list, entries: [{ ...list.entries[0], mimeType: 'application/octet-stream' }] },
    { ...list, entries: [{ ...list.entries[1], size: 1 }] },
  ])('rejects unscoped or inconsistent list payload %#', (payload) => {
    expect(() => projectFileListFromPayload(payload, 'notes', 'daily')).toThrow();
  });

  it('preserves Markdown source and validates exact image base64 length', () => {
    expect(projectFileContentFromPayload({ schemaVersion: 1, projectId: 'notes', path: 'README.md',
      kind: 'text', mimeType: 'text/markdown', size: 8, mtimeMs: 7, text: '# title\n' }, 'notes', 'README.md'))
      .toMatchObject({ kind: 'text', text: '# title\n' });
    expect(projectFileContentFromPayload({ schemaVersion: 1, projectId: 'notes', path: 'image.png',
      kind: 'image', mimeType: 'image/png', size: 4, mtimeMs: 7, dataBase64: 'AAEC/w==' }, 'notes', 'image.png'))
      .toMatchObject({ kind: 'image', dataBase64: 'AAEC/w==' });
    expect(projectFileContentFromPayload({ schemaVersion: 1, projectId: 'notes', path: 'bom.md',
      kind: 'text', mimeType: 'text/markdown', size: 5, mtimeMs: 7, text: '\ufeffx\n' }, 'notes', 'bom.md'))
      .toMatchObject({ kind: 'text', size: 5, text: '\ufeffx\n' });
  });

  it.each([
    { schemaVersion: 1, projectId: 'notes', path: 'image.png', kind: 'image', mimeType: 'image/png', size: 5, mtimeMs: 7, dataBase64: 'AAEC/w==' },
    { schemaVersion: 1, projectId: 'notes', path: 'image.png', kind: 'image', mimeType: 'image/png', size: 1, mtimeMs: 7, dataBase64: '***=' },
    { schemaVersion: 1, projectId: 'notes', path: 'README.md', kind: 'text', mimeType: 'text/markdown', size: 8, mtimeMs: 7, text: '# title\n', dataBase64: '' },
    { schemaVersion: 1, projectId: 'notes', path: 'README.md', kind: 'text', mimeType: 'text/markdown', size: 1, mtimeMs: 7, text: 'é' },
    { schemaVersion: 1, projectId: 'notes', path: 'README.md', kind: 'text', mimeType: 'text/markdown', size: 1, mtimeMs: 7, text: '\ud800' },
    { schemaVersion: 1, projectId: 'notes', path: '/etc/passwd', kind: 'text', mimeType: 'text/plain', size: 1, mtimeMs: 7, text: 'x' },
  ])('rejects malformed file payload %#', (payload) => {
    expect(() => projectFileContentFromPayload(payload, 'notes', payload.path)).toThrow();
  });
});

vi.mock('expo-crypto', () => ({ randomUUID: () => 'request-one' }));
vi.mock('expo-device', () => ({ isDevice: false, deviceType: 2, DeviceType: { PHONE: 1, TABLET: 2 } }));
vi.mock('../../modules/vimicate-diagnostics', () => ({ recordGatewayDiagnostic: () => undefined }));
vi.mock('./deviceIdentity', () => ({ buildDeviceAuth: async () => ({}), loadOrCreateIdentity: async () => ({}) }));
vi.mock('./mobileBootstrap', () => ({ bootstrapMobileOperator: async () => ({ deviceToken: '', scopes: [] }) }));
import { OpenClawClient } from './OpenClawClient';

describe('project file Gateway RPC', () => {
  it('sends only project identity and relative path to the read-only methods', async () => {
    const client = new OpenClawClient();
    const request = vi.spyOn(client, 'request');
    request.mockResolvedValueOnce(list);
    await expect(client.listProjectFiles('notes', 'daily')).resolves.toMatchObject({ projectId: 'notes', path: 'daily' });
    expect(request).toHaveBeenLastCalledWith('vimicate.projectFiles.list', { projectId: 'notes', path: 'daily', includeUnsupported: true, includeDocuments: true }, 20000);

    request.mockResolvedValueOnce({ schemaVersion: 1, projectId: 'notes', path: 'README.md',
      kind: 'text', mimeType: 'text/markdown', size: 8, mtimeMs: 7, text: '# title\n' });
    await expect(client.readProjectFile('notes', 'README.md')).resolves.toMatchObject({ kind: 'text' });
    expect(request).toHaveBeenLastCalledWith('vimicate.projectFiles.read', { projectId: 'notes', path: 'README.md', includeDocuments: true }, 20000);
  });

  it('uses separate shared-location methods and requires the exact location response', async () => {
    const client = new OpenClawClient();
    const request = vi.spyOn(client, 'request');
    request.mockResolvedValueOnce({ schemaVersion: 1, location: 'icloud-downloads', path: 'Sessions plan.md' });
    await expect(client.resolveSharedFile('~/icloud/Downloads/Sessions plan.md')).resolves.toEqual({ path: 'Sessions plan.md' });
    expect(request).toHaveBeenLastCalledWith('vimicate.sharedFiles.resolve', { sourcePath: '~/icloud/Downloads/Sessions plan.md' }, 20000);
    request.mockResolvedValueOnce({ ...list, projectId: 'shared-icloud-downloads', location: 'icloud-downloads' });
    await expect(client.listSharedFiles('shared-icloud-downloads', 'daily')).resolves.toMatchObject({ projectId: 'shared-icloud-downloads', path: 'daily' });
    expect(request).toHaveBeenLastCalledWith('vimicate.sharedFiles.list', { projectId: 'shared-icloud-downloads', path: 'daily', includeUnsupported: true, includeDocuments: true }, 20000);
    request.mockResolvedValueOnce({ schemaVersion: 1, location: 'icloud-downloads', projectId: 'shared-icloud-downloads', path: 'Sessions plan.md', kind: 'text', mimeType: 'text/markdown', size: 8, mtimeMs: 7, text: '# title\n' });
    await expect(client.readSharedFile('shared-icloud-downloads', 'Sessions plan.md')).resolves.toMatchObject({ text: '# title\n' });
    expect(request).toHaveBeenLastCalledWith('vimicate.sharedFiles.read', { projectId: 'shared-icloud-downloads', path: 'Sessions plan.md', includeDocuments: true }, 20000);
    expect(() => sharedFileResolutionFromPayload({ schemaVersion: 1, location: 'project', path: 'Sessions plan.md' })).toThrow();
    expect(() => sharedProjectFileListFromPayload(list, 'notes', 'daily')).toThrow();
    expect(() => sharedProjectFileContentFromPayload({ schemaVersion: 1, projectId: 'notes', path: 'README.md', kind: 'text', mimeType: 'text/markdown', size: 8, mtimeMs: 7, text: '# title\n' }, 'notes', 'README.md')).toThrow();
    request.mockRejectedValueOnce(new Error('Unknown method'));
    await expect(client.resolveSharedFile('~/icloud/Downloads/Sessions plan.md')).rejects.toThrow('Unknown method');
  });
});
