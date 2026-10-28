import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createProjectFiles } from './project-files.mjs';

function fixture(t, bytes = Buffer.alloc(8 * 1024 * 1024 + 17, 0xa5)) {
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'vimicate-share-')));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const project = path.join(base, 'repo'); const vimicateDir = path.join(base, '.vimicate');
  fs.mkdirSync(project); fs.mkdirSync(vimicateDir);
  const artifacts = path.join(vimicateDir, 'agent', 'artifacts');
  const cloud = path.join(base, 'Library', 'Mobile Documents', 'com~apple~CloudDocs');
  const downloads = path.join(cloud, 'Downloads');
  fs.mkdirSync(artifacts, { recursive: true }); fs.mkdirSync(downloads, { recursive: true });
  fs.symlinkSync(cloud, path.join(base, 'icloud'));
  fs.writeFileSync(path.join(vimicateDir, 'projects.md'), `## Synthetic\n- id: synthetic\n- repo: ${project}/\n`);
  fs.writeFileSync(path.join(project, 'original.pdf'), bytes);
  const files = createProjectFiles({ vimicateDir, homeDir: base });
  const entry = files.locationList({ location: 'project', projectId: 'synthetic', path: '', includeDocuments: true }).entries[0];
  const request = { location: 'project', projectId: 'synthetic', path: entry.path,
    size: entry.size, mtimeMs: entry.mtimeMs, offset: 0 };
  return { base, project, artifacts, downloads, files, request, bytes };
}

test('exports the complete original above the preview ceiling in small bounded chunks', t => {
  const f = fixture(t);
  assert.throws(() => f.files.locationRead({ ...f.request, includeDocuments: true }), /exceeds 8388608 bytes/u);
  const chunks = []; let offset = 0; let version;
  do {
    const chunk = f.files.locationExportChunk({ ...f.request, offset, ...(version ? { version } : {}) });
    assert.equal(chunk.offset, offset); assert.equal(chunk.mimeType, 'application/pdf');
    assert.ok(chunk.dataBase64.length <= 262144);
    chunks.push(Buffer.from(chunk.dataBase64, 'base64'));
    offset += chunks.at(-1).length; version = chunk.version;
  } while (offset < f.bytes.length);
  assert.deepEqual(Buffer.concat(chunks), f.bytes);
});

test('fails closed for changed files, stale selection, invalid offsets and missing version', t => {
  const f = fixture(t); const first = f.files.locationExportChunk(f.request);
  for (const request of [{ ...f.request, offset: 1 }, { ...f.request, offset: 196608 },
    { ...f.request, size: 1 }, { ...f.request, mtimeMs: 0 }, { ...f.request, offset: -1 }]) {
    assert.throws(() => f.files.locationExportChunk(request));
  }
  fs.writeFileSync(path.join(f.project, 'original.pdf'), Buffer.alloc(f.bytes.length, 0x11));
  assert.throws(() => f.files.locationExportChunk({ ...f.request, offset: 196608, version: first.version }), /changed/u);
});

test('keeps original root confinement and rejects files beyond the separate share ceiling', t => {
  const f = fixture(t, Buffer.from('synthetic'));
  fs.writeFileSync(path.join(f.base, 'outside.pdf'), 'outside');
  fs.symlinkSync(path.join(f.base, 'outside.pdf'), path.join(f.project, 'escape.pdf'));
  for (const filePath of ['../outside.pdf', '/outside.pdf', 'escape.pdf']) {
    assert.throws(() => f.files.locationExportChunk({ ...f.request, path: filePath }));
  }
  fs.truncateSync(path.join(f.project, 'original.pdf'), 32 * 1024 * 1024 + 1);
  assert.throws(() => f.files.locationExportChunk({ ...f.request, size: 32 * 1024 * 1024 + 1 }), /33554432/u);
  assert.throws(() => f.files.locationExportChunk({ ...f.request, location: 'icloud-downloads' }), /invalid shared/u);
});

test('shares unsupported and empty originals without reinterpreting them as text', t => {
  const f = fixture(t, Buffer.alloc(0));
  fs.renameSync(path.join(f.project, 'original.pdf'), path.join(f.project, 'original.bin'));
  const chunk = f.files.locationExportChunk({ ...f.request, path: 'original.bin' });
  assert.equal(chunk.dataBase64, ''); assert.equal(chunk.mimeType, 'application/octet-stream');
});

test('exports through each existing authorized location without accepting another project identity', t => {
  const f = fixture(t, Buffer.from('exact original'));
  for (const [directory, location, projectId] of [[f.artifacts, 'assistant-artifacts', 'assistant-artifacts'],
    [f.downloads, 'icloud-downloads', 'shared-icloud-downloads']]) {
    fs.copyFileSync(path.join(f.project, 'original.pdf'), path.join(directory, 'original.pdf'));
    const entry = f.files.locationList({ location, projectId, path: '', includeDocuments: true }).entries[0];
    const request = { location, projectId, path: entry.path, size: entry.size, mtimeMs: entry.mtimeMs, offset: 0 };
    assert.deepEqual(Buffer.from(f.files.locationExportChunk(request).dataBase64, 'base64'), f.bytes);
    assert.throws(() => f.files.locationExportChunk({ ...request, projectId: 'synthetic' }));
  }
});

test('does not publish a chunk when its open descriptor changes during the read', t => {
  const f = fixture(t); const read = fs.readSync;
  t.mock.method(fs, 'readSync', (...args) => {
    const count = read(...args);
    if (args[1].length === 196608) fs.truncateSync(path.join(f.project, 'original.pdf'), 1);
    return count;
  });
  assert.throws(() => f.files.locationExportChunk(f.request), /changed during/u);
});

test('permits the exact 32 MiB sharing boundary without raising the preview bound', t => {
  const f = fixture(t, Buffer.alloc(0));
  fs.truncateSync(path.join(f.project, 'original.pdf'), 32 * 1024 * 1024);
  const entry = f.files.locationList({ location: 'project', projectId: 'synthetic', path: '', includeDocuments: true }).entries[0];
  const chunk = f.files.locationExportChunk({ ...f.request, size: entry.size, mtimeMs: entry.mtimeMs });
  assert.equal(chunk.size, 32 * 1024 * 1024); assert.equal(chunk.dataBase64.length, 262144);
  assert.throws(() => f.files.locationRead({ ...f.request, includeDocuments: true }), /8388608/u);
});

test('iCloud placeholders retain their confined materialization identity without leaking partial chunks', t => {
  const f = fixture(t); const read = fs.readSync;
  t.mock.method(fs, 'readSync', (...args) => {
    if (args[1].length === 196608) throw Object.assign(new Error('placeholder'), { code: 'EDEADLK' });
    return read(...args);
  });
  assert.throws(() => f.files.locationExportChunk(f.request), error => error.icloudPlaceholder === true
    && error.icloudPath === path.join(f.project, 'original.pdf') && /still downloading/u.test(error.message));
});

test('disk opt-in lifts only the total share ceiling while legacy clients and previews stay bounded', t => {
  const f = fixture(t, Buffer.alloc(0));
  const size = 64 * 1024 * 1024 + 17;
  fs.truncateSync(path.join(f.project, 'original.pdf'), size);
  const entry = f.files.locationList({ location: 'project', projectId: 'synthetic', path: '', includeDocuments: true }).entries[0];
  const request = { ...f.request, size, mtimeMs: entry.mtimeMs };
  assert.throws(() => f.files.locationExportChunk(request), /33554432/u);
  const first = f.files.locationExportChunk({ ...request, transferMode: 'disk' });
  assert.equal(first.size, size); assert.equal(first.dataBase64.length, 262144);
  const lastOffset = Math.floor((size - 1) / 196608) * 196608;
  const last = f.files.locationExportChunk({ ...request, transferMode: 'disk', offset: lastOffset, version: first.version });
  assert.equal(Buffer.from(last.dataBase64, 'base64').length, size - lastOffset);
  assert.throws(() => f.files.locationRead({ ...request, includeDocuments: true }), /8388608/u);
  assert.throws(() => f.files.locationExportChunk({ ...request, transferMode: 'unbounded' }), /mode/u);
  assert.throws(() => f.files.locationExportChunk({ ...request, transferMode: 'disk', path: '../private' }), /traversal/u);
  fs.truncateSync(path.join(f.project, 'original.pdf'), size + 1);
  assert.throws(() => f.files.locationExportChunk({ ...request, transferMode: 'disk', offset: 196608, version: first.version }), /changed/u);
});
