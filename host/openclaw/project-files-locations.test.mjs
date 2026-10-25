import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createProjectFiles } from './project-files.mjs';
import { documentTypes } from './project-file-primitives.mjs';

const BINARY_LIMIT = 8 * 1024 * 1024;

function fixture(t) {
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'vimicate-file-locations-')));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const homeDir = path.join(base, 'home');
  const vimicateDir = path.join(homeDir, '.vimicate');
  const project = path.join(homeDir, 'repos', 'example');
  const nested = path.join(project, 'nested');
  const artifacts = path.join(vimicateDir, 'agent', 'artifacts');
  const cloud = path.join(homeDir, 'Library', 'Mobile Documents', 'com~apple~CloudDocs');
  const downloads = path.join(cloud, 'Downloads');
  for (const directory of [nested, artifacts, downloads]) fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  fs.symlinkSync(cloud, path.join(homeDir, 'icloud'));
  const registry = path.join(vimicateDir, 'projects.md');
  fs.writeFileSync(registry, [
    '# Projects', '## Example', '- id: example', '- repo: ~/repos/example/',
    '## Nested', '- id: nested', `- repo: ${nested}/`,
    '## Missing host', '- id: missing', `- repo: ${homeDir}/not-present/`, '',
  ].join('\n'), { mode: 0o600 });
  return { base, homeDir, vimicateDir, project, nested, artifacts, downloads, registry,
    files: createProjectFiles({ vimicateDir, homeDir }) };
}

test('resolves the four artifact-link shapes and returns opted-in document bytes', t => {
  const f = fixture(t);
  const folder = 'dia-marks-entry-demo-20261003';
  fs.mkdirSync(path.join(f.artifacts, folder));
  const samples = new Map([
    ['report.xlsx', Buffer.from([0x50, 0x4b, 0, 0xff])],
    ['first export.zip', Buffer.from([0x50, 0x4b, 1])],
    ['second-export.zip', Buffer.from([0x50, 0x4b, 2])],
    ['notes.md', Buffer.from('# synthetic notes\n')],
  ]);
  for (const [name, bytes] of samples) {
    const sourcePath = path.join(f.artifacts, folder, name);
    fs.writeFileSync(sourcePath, bytes);
    const resolved = f.files.resolve({ sourcePath, projectId: 'example' });
    assert.deepEqual(resolved, { schemaVersion: 1, location: 'assistant-artifacts',
      projectId: 'assistant-artifacts', path: `${folder}/${name}`, rootPath: f.artifacts });
    assert.deepEqual(f.files.resolve({ sourcePath: `~/.vimicate/agent/artifacts/${folder}/${name}` }), resolved);
    const read = f.files.locationRead({ ...resolved, includeDocuments: true });
    assert.equal(read.location, 'assistant-artifacts');
    assert.equal(read.projectId, 'assistant-artifacts');
    assert.equal(read.size, bytes.length);
    assert.ok(Number.isFinite(read.mtimeMs));
    if (name.endsWith('.md')) assert.equal(read.text, bytes.toString());
    else {
      assert.equal(read.kind, 'document');
      assert.equal(read.dataBase64, bytes.toString('base64'));
      assert.throws(() => f.files.locationRead(resolved), /unsupported file type/u);
    }
  }
  const params = { location: 'assistant-artifacts', projectId: 'assistant-artifacts', path: folder };
  assert.equal(f.files.locationList(params).entries.length, 1);
  assert.ok(f.files.locationList({ ...params, includeUnsupported: true }).entries
    .filter(entry => !entry.name.endsWith('.md')).every(entry => entry.kind === 'unsupported'));
  const listed = f.files.locationList({ ...params, includeDocuments: true });
  assert.equal(listed.location, 'assistant-artifacts');
  assert.equal(listed.entries.length, 4);
  assert.equal(listed.entries.filter(entry => entry.kind === 'document').length, 3);
  assert.deepEqual(f.files.resolve({ sourcePath: f.artifacts }), {
    schemaVersion: 1, location: 'assistant-artifacts', projectId: 'assistant-artifacts', path: '', rootPath: f.artifacts,
  });
});

test('resolves canonical host roots, project home aliases and the deepest registered project', t => {
  const f = fixture(t);
  fs.writeFileSync(path.join(f.project, 'guide.md'), 'project');
  fs.writeFileSync(path.join(f.nested, 'guide.md'), 'nested');
  fs.writeFileSync(path.join(f.downloads, 'guide.md'), 'shared');
  assert.deepEqual(f.files.resolve({ sourcePath: '~/repos/example/guide.md' }), {
    schemaVersion: 1, location: 'project', projectId: 'example', path: 'guide.md', rootPath: f.project,
  });
  const nested = f.files.resolve({ sourcePath: path.join(f.nested, 'guide.md'), projectId: 'example' });
  assert.equal(nested.projectId, 'nested');
  assert.equal(f.files.locationRead(nested).text, 'nested');
  assert.equal(f.files.locationRead(nested).location, 'project');
  const expected = { schemaVersion: 1, location: 'icloud-downloads', projectId: 'shared-icloud-downloads',
    path: 'guide.md', rootPath: f.downloads };
  for (const sourcePath of ['~/icloud/Downloads/guide.md', path.join(f.homeDir, 'icloud', 'Downloads', 'guide.md'), path.join(f.downloads, 'guide.md')]) {
    assert.deepEqual(f.files.resolve({ sourcePath }), expected);
  }
  assert.equal(f.files.locationRead(expected).text, 'shared');
  assert.equal(f.files.locationList({ ...expected, path: '' }).location, 'icloud-downloads');
  fs.appendFileSync(f.registry, `\n## Alias\n- id: alias\n- repo: ${f.project}/\n`);
  assert.throws(() => f.files.resolve({ sourcePath: path.join(f.project, 'guide.md') }), /ambiguous/u);
  assert.equal(f.files.resolve({ sourcePath: path.join(f.project, 'guide.md'), projectId: 'alias' }).projectId, 'alias');
});

test('rejects unregistered home files, traversal, cross-root links and wrong scoped identities', t => {
  const f = fixture(t);
  const privateFile = path.join(f.homeDir, 'private.md');
  fs.writeFileSync(privateFile, 'synthetic private');
  fs.writeFileSync(path.join(f.project, 'inside.md'), 'synthetic project');
  fs.symlinkSync(privateFile, path.join(f.artifacts, 'outside.md'));
  fs.symlinkSync(path.join(f.project, 'inside.md'), path.join(f.artifacts, 'cross-root.md'));
  fs.symlinkSync(privateFile, path.join(f.project, 'outside.md'));
  const sourcePaths = [privateFile, path.join(f.artifacts, 'outside.md'), path.join(f.artifacts, 'cross-root.md'),
    path.join(f.project, 'outside.md'), `${f.project}/../example/inside.md`, '~/repos/./example/inside.md',
    '~/private.md', '/Users/other/icloud/Downloads/report.xlsx', '/home/other/report.xlsx',
    'inside.md', `${f.project}\\inside.md`, `${f.project}/inside.md\0`, path.join(f.homeDir, 'missing.md')];
  for (const sourcePath of sourcePaths) assert.throws(() => f.files.resolve({ sourcePath }), /file|path|home|location/u);
  assert.throws(() => f.files.resolve({ sourcePath: path.join(f.project, 'inside.md'), projectId: '.. /' }), /invalid project id/u);
  for (const location of ['assistant-artifacts', 'icloud-downloads']) {
    assert.throws(() => f.files.locationList({ location, projectId: 'example', path: '' }), /project id/u);
    assert.throws(() => f.files.locationRead({ location, projectId: location === 'assistant-artifacts' ? location : 'shared-icloud-downloads', path: '../private.md' }), /traversal/u);
  }
  assert.throws(() => f.files.locationList({ location: 'home', projectId: 'example', path: '' }), /invalid file location/u);
  assert.throws(() => f.files.locationList({ location: 'project', projectId: 'example', path: 1 }), /invalid path/u);
  assert.throws(() => f.files.locationRead({ location: 'project', projectId: 'missing', path: 'file.md' }), /unavailable/u);
  assert.equal(f.files.locationList({ location: 'assistant-artifacts', projectId: 'assistant-artifacts', path: '', includeUnsupported: true }).entries.length, 0);
  fs.renameSync(f.artifacts, `${f.artifacts}-retained`);
  fs.symlinkSync(f.project, f.artifacts);
  assert.throws(() => f.files.locationList({ location: 'assistant-artifacts', projectId: 'assistant-artifacts', path: '' }), /unsafe assistant artifacts/u);
});

test('documents use the exact finite allowlist only when explicitly requested on legacy or new routes', t => {
  const f = fixture(t);
  for (const [extension, mimeType] of documentTypes) {
    const filename = `sample${extension.toUpperCase()}`;
    fs.writeFileSync(path.join(f.project, filename), Buffer.from([0, 1, 255]));
    const params = { projectId: 'example', path: filename };
    assert.throws(() => f.files.read(params), /unsupported file type/u);
    const read = f.files.read({ ...params, includeDocuments: true });
    assert.equal(read.kind, 'document');
    assert.equal(read.mimeType, mimeType);
    assert.equal(read.dataBase64, 'AAH/');
  }
  fs.writeFileSync(path.join(f.project, 'unknown.bin'), 'unsupported');
  fs.writeFileSync(path.join(f.project, 'macro.docm'), 'unsupported');
  const listed = f.files.list({ projectId: 'example', path: '', includeDocuments: true, includeUnsupported: true });
  assert.equal(listed.entries.filter(entry => entry.kind === 'document').length, documentTypes.size);
  assert.equal(listed.entries.filter(entry => entry.kind === 'unsupported').length, 2);
  for (const filename of ['unknown.bin', 'macro.docm']) {
    assert.throws(() => f.files.read({ projectId: 'example', path: filename, includeDocuments: true }), /unsupported/u);
  }
  for (const method of ['list', 'read']) {
    assert.throws(() => f.files[method]({ projectId: 'example', path: 'sample.PDF', includeDocuments: 'true' }), /invalid document option/u);
  }
  fs.writeFileSync(path.join(f.downloads, 'report.pdf'), '%PDF-synthetic');
  assert.equal(f.files.sharedRead({ projectId: 'shared-icloud-downloads', path: 'report.pdf', includeDocuments: true }).kind, 'document');
});

test('document reads cap both initial size and growth after stat at 8 MiB', t => {
  const f = fixture(t);
  const filename = path.join(f.artifacts, 'large.zip');
  const params = { location: 'assistant-artifacts', projectId: 'assistant-artifacts', path: 'large.zip', includeDocuments: true };
  fs.writeFileSync(filename, 'x');
  fs.truncateSync(filename, BINARY_LIMIT);
  const exact = f.files.locationRead(params);
  assert.equal(exact.size, BINARY_LIMIT);
  assert.equal(Buffer.from(exact.dataBase64, 'base64').length, BINARY_LIMIT);
  fs.truncateSync(filename, BINARY_LIMIT + 1);
  assert.throws(() => f.files.locationRead(params), /document file exceeds 8388608 bytes/u);
  fs.truncateSync(filename, 1);
  const original = fs.fstatSync;
  let grew = false;
  fs.fstatSync = function(fd, ...args) {
    const stat = original.call(this, fd, ...args);
    if (!grew && stat.isFile() && stat.size === 1) {
      grew = true;
      fs.truncateSync(filename, BINARY_LIMIT + 1);
    }
    return stat;
  };
  try { assert.throws(() => f.files.locationRead(params), /document file exceeds 8388608 bytes/u); }
  finally { fs.fstatSync = original; }
});

test('generic resolve rejects an ancestor swapped after canonical path resolution', t => {
  const f = fixture(t);
  const directory = path.join(f.artifacts, 'changing');
  const outside = path.join(f.base, 'outside');
  fs.mkdirSync(directory);
  fs.mkdirSync(outside);
  const filename = path.join(directory, 'guide.md');
  fs.writeFileSync(filename, 'inside');
  fs.writeFileSync(path.join(outside, 'guide.md'), 'outside');
  const original = fs.realpathSync;
  let changed = false;
  fs.realpathSync = function(candidate, ...args) {
    const real = original.call(this, candidate, ...args);
    if (!changed && candidate === filename) {
      changed = true;
      fs.renameSync(directory, `${directory}-retained`);
      fs.symlinkSync(outside, directory);
    }
    return real;
  };
  try { assert.throws(() => f.files.resolve({ sourcePath: filename }), /file is unavailable/u); }
  finally { fs.realpathSync = original; }
});

test('new file payloads fail closed for nonfinite descriptor metadata', t => {
  const f = fixture(t);
  fs.writeFileSync(path.join(f.artifacts, 'report.pdf'), '%PDF-synthetic');
  const original = fs.fstatSync;
  fs.fstatSync = function(fd, ...args) {
    const stat = original.call(this, fd, ...args);
    if (stat.isFile()) stat.mtimeMs = Number.NaN;
    return stat;
  };
  try {
    assert.throws(() => f.files.locationRead({ location: 'assistant-artifacts', projectId: 'assistant-artifacts',
      path: 'report.pdf', includeDocuments: true }), /path is unavailable/u);
  } finally { fs.fstatSync = original; }
});

test('previews text dotfiles in project, Downloads and assistant-artifact locations', t => {
  const f = fixture(t);
  const source = '# generated output\nnode_modules/\n!keep.txt\n';
  for (const folder of [f.project, f.downloads, f.artifacts]) {
    const sourcePath = path.join(folder, '.gitignore');
    fs.writeFileSync(sourcePath, source);
    const resolved = f.files.resolve({ sourcePath });
    const listed = f.files.locationList({ ...resolved, path: '' }).entries;
    assert.equal(listed.find(entry => entry.name === '.gitignore').kind, 'text');
    const read = f.files.locationRead(resolved);
    assert.equal(read.kind, 'text');
    assert.equal(read.mimeType, 'text/plain');
    assert.equal(read.text, source);
  }
});
