import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createProjectFiles } from './project-files.mjs';

const REGISTRY_LIMIT = 4 * 1024 * 1024;
const TEXT_LIMIT = 1024 * 1024;

function fixture(t) {
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'vimicate-project-files-')));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const vimicateDir = path.join(base, 'registry');
  const project = path.join(base, 'project');
  const remoteMirror = path.join(base, 'remote-mirror');
  fs.mkdirSync(vimicateDir, { mode: 0o700 });
  fs.mkdirSync(project, { mode: 0o700 });
  fs.mkdirSync(remoteMirror, { mode: 0o700 });
  fs.writeFileSync(path.join(vimicateDir, 'projects.md'), [
    '# Vimicate Projects', '', '## Example', '- id: example', `- repo: ${project}/`,
    '', '## Remote only', '- id: remote', `- repo: ${remoteMirror}/`, '- default-executor: remote-workstation', '',
  ].join('\n'), { mode: 0o600 });
  return { base, vimicateDir, project, remoteMirror, files: createProjectFiles({ vimicateDir }) };
}

test('lists supported project files, hidden entries and folders in stable mtime order', t => {
  const f = fixture(t);
  fs.mkdirSync(path.join(f.project, 'docs'));
  fs.writeFileSync(path.join(f.project, '.notes.md'), '# private\n');
  fs.writeFileSync(path.join(f.project, 'README'), 'hello\n');
  fs.writeFileSync(path.join(f.project, 'photo.png'), Buffer.from([1, 2, 3]));
  fs.writeFileSync(path.join(f.project, 'archive.zip'), Buffer.from([4]));
  fs.utimesSync(path.join(f.project, 'README'), new Date(1000), new Date(1000));
  fs.utimesSync(path.join(f.project, 'docs'), new Date(2000), new Date(2000));
  fs.utimesSync(path.join(f.project, '.notes.md'), new Date(3000), new Date(3000));
  fs.utimesSync(path.join(f.project, 'photo.png'), new Date(4000), new Date(4000));

  assert.deepEqual(f.files.list({ projectId: 'example', path: '' }), {
    schemaVersion: 1,
    projectId: 'example',
    path: '',
    entries: [
      { name: 'photo.png', path: 'photo.png', kind: 'image', mimeType: 'image/png', size: 3, mtimeMs: 4000 },
      { name: '.notes.md', path: '.notes.md', kind: 'text', mimeType: 'text/markdown', size: 10, mtimeMs: 3000 },
      { name: 'docs', path: 'docs', kind: 'directory', size: 0, mtimeMs: 2000 },
      { name: 'README', path: 'README', kind: 'text', mimeType: 'text/plain', size: 6, mtimeMs: 1000 },
    ],
  });
});

test('omits macOS names that the client cannot address without losing siblings', t => {
  const f = fixture(t);
  fs.writeFileSync(path.join(f.project, 'normal.md'), 'ok');
  fs.writeFileSync(path.join(f.project, 'odd\\name.md'), 'unsupported');
  assert.deepEqual(f.files.list({ projectId: 'example', path: '' }).entries.map(entry => entry.name), ['normal.md']);
});

test('lists non-previewable regular files only for opted-in clients without allowing reads', t => {
  const f = fixture(t);
  fs.writeFileSync(path.join(f.project, 'report.pdf'), Buffer.from('%PDF-test'));
  fs.writeFileSync(path.join(f.project, 'archive.zip'), Buffer.from([4]));
  fs.symlinkSync('/etc/passwd', path.join(f.project, 'escape.pdf'));
  assert.equal(f.files.list({ projectId: 'example', path: '' }).entries.length, 0);
  const entries = f.files.list({ projectId: 'example', path: '', includeUnsupported: true }).entries;
  assert.deepEqual(entries.map(entry => entry.name).sort(), ['archive.zip', 'report.pdf']);
  assert.ok(entries.every(entry => entry.kind === 'unsupported' && entry.size > 0 && entry.mimeType === undefined));
  assert.throws(() => f.files.read({ projectId: 'example', path: 'report.pdf' }), /unsupported file type/u);
  assert.throws(() => f.files.list({ projectId: 'example', path: '', includeUnsupported: 'true' }), /invalid listing option/u);
});

test('lists and reads text dotfiles, extensionless build files and additional source formats', t => {
  const f = fixture(t);
  const names = ['.gitignore', '.gitattributes', '.gitmodules', '.dockerignore', '.npmignore',
    '.eslintignore', '.prettierignore', '.editorconfig', '.env', '.env.local', '.env.development.local', '.npmrc', '.yarnrc',
    '.nvmrc', '.tool-versions', '.bashrc', '.zshrc', '.profile', '.eslintrc', '.prettierrc',
    'Brewfile', 'Podfile', 'Rakefile', 'Procfile', 'Containerfile', 'Dockerfile.dev', 'Makefile.local',
    'Jenkinsfile', 'Vagrantfile', 'Gemfile.lock', 'yarn.lock', 'bun.lock', 'build.gradle',
    'settings.properties', 'app.vue', 'app.svelte', 'main.dart', 'main.exs', 'query.proto',
    'main.tf', 'main.hcl', 'notes.rst', 'notes.adoc', 'code.clj', 'env.fish', 'ignore.gitignore'];
  const source = '# synthetic configuration\ncache/\n!keep.txt\nclé=value\n';
  for (const name of names) fs.writeFileSync(path.join(f.project, name), source);
  const listed = f.files.list({ projectId: 'example', path: '' }).entries;
  assert.deepEqual(listed.map(entry => entry.name).sort(), [...names].sort());
  for (const name of names) {
    assert.equal(listed.find(entry => entry.name === name).kind, 'text', name);
    const read = f.files.read({ projectId: 'example', path: name });
    assert.equal(read.kind, 'text', name);
    assert.equal(read.mimeType, 'text/plain', name);
    assert.equal(read.text, source, name);
    assert.equal(read.size, Buffer.byteLength(source), name);
  }
});

test('keeps binary and oversized contents rejected for the newly supported text names', t => {
  const f = fixture(t);
  fs.writeFileSync(path.join(f.project, '.gitignore'), Buffer.from('cache/\0binary'));
  fs.writeFileSync(path.join(f.project, '.env.local'), Buffer.from([0xc3, 0x28]));
  fs.writeFileSync(path.join(f.project, 'Brewfile'), 'x'.repeat(TEXT_LIMIT + 1));
  fs.writeFileSync(path.join(f.project, 'bun.lockb'), Buffer.from([0, 255]));
  fs.writeFileSync(path.join(f.project, 'Dockerfile.pdf'), Buffer.from('%PDF-test'));
  assert.throws(() => f.files.read({ projectId: 'example', path: 'Dockerfile.pdf' }), /unsupported file type/u);
  assert.equal(f.files.read({ projectId: 'example', path: 'Dockerfile.pdf', includeDocuments: true }).kind, 'document');
  assert.throws(() => f.files.read({ projectId: 'example', path: '.gitignore' }), /unsupported NUL/u);
  assert.throws(() => f.files.read({ projectId: 'example', path: '.env.local' }), /not valid UTF-8/u);
  assert.throws(() => f.files.read({ projectId: 'example', path: 'Brewfile' }), /exceeds/u);
  assert.throws(() => f.files.read({ projectId: 'example', path: 'bun.lockb' }), /unsupported file type/u);
});

test('reads byte-exact UTF-8 source and bounded image bytes', t => {
  const f = fixture(t);
  fs.mkdirSync(path.join(f.project, 'docs'));
  fs.writeFileSync(path.join(f.project, 'docs', 'guide.md'), '# Héllo\n\n- one\n');
  fs.writeFileSync(path.join(f.project, 'docs', 'bom.md'), Buffer.from([0xef, 0xbb, 0xbf, 0x78, 0x0a]));
  fs.writeFileSync(path.join(f.project, 'pixel.webp'), Buffer.from([0, 1, 2, 255]));

  assert.match(f.files.read({ projectId: 'example', path: 'docs/guide.md' }).text, /^# Héllo\n\n- one\n$/u);
  assert.deepEqual(f.files.read({ projectId: 'example', path: 'docs/bom.md' }), {
    schemaVersion: 1,
    projectId: 'example',
    path: 'docs/bom.md',
    kind: 'text',
    mimeType: 'text/markdown',
    size: 5,
    mtimeMs: Math.trunc(fs.statSync(path.join(f.project, 'docs', 'bom.md')).mtimeMs),
    text: '\ufeffx\n',
  });
  assert.deepEqual(f.files.read({ projectId: 'example', path: 'pixel.webp' }), {
    schemaVersion: 1,
    projectId: 'example',
    path: 'pixel.webp',
    kind: 'image',
    mimeType: 'image/webp',
    size: 4,
    mtimeMs: Math.trunc(fs.statSync(path.join(f.project, 'pixel.webp')).mtimeMs),
    dataBase64: 'AAEC/w==',
  });
});

test('resolves only the host-owned iCloud Downloads location and reads its exact file', t => {
  const f = fixture(t);
  const homeDir = path.join(f.base, 'home');
  const cloud = path.join(homeDir, 'Library', 'Mobile Documents', 'com~apple~CloudDocs');
  const downloads = path.join(cloud, 'Downloads');
  fs.mkdirSync(downloads, { recursive: true, mode: 0o700 });
  fs.symlinkSync(cloud, path.join(homeDir, 'icloud'));
  fs.writeFileSync(path.join(downloads, 'Sessions plan.md'), '# sessions\n');
  fs.writeFileSync(path.join(homeDir, 'private.md'), 'private\n');
  const files = createProjectFiles({ vimicateDir: f.vimicateDir, homeDir });
  const sourcePath = path.join(homeDir, 'icloud', 'Downloads', 'Sessions plan.md');
  assert.deepEqual(files.resolveShared({ sourcePath }), { schemaVersion: 1, location: 'icloud-downloads', path: 'Sessions plan.md' });
  assert.deepEqual(files.resolveShared({ sourcePath: '~/icloud/Downloads/Sessions plan.md' }), { schemaVersion: 1, location: 'icloud-downloads', path: 'Sessions plan.md' });
  assert.deepEqual(files.sharedList({ projectId: 'shared-icloud-downloads', path: '' }).entries.map(entry => entry.path), ['Sessions plan.md']);
  assert.equal(files.sharedRead({ projectId: 'shared-icloud-downloads', path: 'Sessions plan.md' }).text, '# sessions\n');
  for (const invalid of [path.join(homeDir, 'Downloads', 'Sessions plan.md'), path.join(homeDir, 'private.md'), '/Users/other/icloud/Downloads/Sessions plan.md', '~/icloud/Downloads/../private.md']) {
    assert.throws(() => files.resolveShared({ sourcePath: invalid }), /shared|path|location/u);
  }
  assert.throws(() => files.sharedRead({ projectId: 'shared-icloud-downloads', path: '../private.md' }), /traversal/u);
  fs.symlinkSync(path.join(homeDir, 'private.md'), path.join(downloads, 'escape.md'));
  assert.throws(() => files.resolveShared({ sourcePath: path.join(homeDir, 'icloud', 'Downloads', 'escape.md') }), /shared|symlink/u);
  assert.equal(files.sharedList({ projectId: 'shared-icloud-downloads', path: '' }).entries.some(entry => entry.name === 'escape.md'), false);
  fs.renameSync(downloads, path.join(cloud, 'retained-downloads'));
  fs.symlinkSync(f.project, downloads);
  assert.throws(() => files.sharedList({ projectId: 'shared-icloud-downloads', path: '' }), /unsafe shared Downloads location/u);
});

test('allows internal symlinks but rejects traversal and symlinks outside the project', t => {
  const f = fixture(t);
  fs.mkdirSync(path.join(f.project, 'real'));
  fs.writeFileSync(path.join(f.project, 'real', 'inside.md'), 'inside\n');
  fs.symlinkSync(path.join(f.project, 'real'), path.join(f.project, 'linked'));
  const outside = path.join(f.base, 'outside.md');
  fs.writeFileSync(outside, 'outside\n');
  fs.symlinkSync(outside, path.join(f.project, 'escape.md'));

  assert.equal(f.files.read({ projectId: 'example', path: 'linked/inside.md' }).text, 'inside\n');
  assert.equal(f.files.list({ projectId: 'example', path: '' }).entries.some(entry => entry.name === 'escape.md'), false);
  assert.throws(() => f.files.read({ projectId: 'example', path: 'escape.md' }), /symlink escapes/u);
  for (const invalid of ['../outside.md', 'real/../../outside.md', '/etc/passwd', 'real\\inside.md']) {
    assert.throws(() => f.files.read({ projectId: 'example', path: invalid }), /path/u);
  }
});

test('rejects an ancestor changed to an escaping symlink after canonical resolution', t => {
  const f = fixture(t);
  const directory = path.join(f.project, 'changing');
  const retained = path.join(f.project, 'retained');
  const outside = path.join(f.base, 'outside');
  const filename = path.join(directory, 'source.md');
  fs.mkdirSync(directory);
  fs.mkdirSync(outside);
  fs.writeFileSync(filename, 'inside\n');
  fs.writeFileSync(path.join(outside, 'source.md'), 'outside\n');

  const realpathSync = fs.realpathSync;
  let changed = false;
  fs.realpathSync = function(candidate, ...rest) {
    const result = realpathSync.call(this, candidate, ...rest);
    if (!changed && candidate === filename) {
      changed = true;
      fs.renameSync(directory, retained);
      fs.symlinkSync(outside, directory, 'dir');
    }
    return result;
  };
  try {
    assert.throws(() => f.files.read({ projectId: 'example', path: 'changing/source.md' }), error => {
      assert.match(error.message, /path is unavailable/u);
      assert.equal(error.message.includes(f.base), false);
      return true;
    });
  } finally {
    fs.realpathSync = realpathSync;
    if (changed) {
      fs.unlinkSync(directory);
      fs.renameSync(retained, directory);
    }
  }
});

test('caps reads when a file or registry grows after its initial stat', t => {
  const f = fixture(t);
  const growing = path.join(f.project, 'growing.md');
  fs.writeFileSync(growing, 'x');
  const fstatSync = fs.fstatSync;
  let grewFile = false;
  fs.fstatSync = function(fd, ...rest) {
    const stat = fstatSync.call(this, fd, ...rest);
    if (!grewFile && stat.isFile() && stat.size === 1) {
      grewFile = true;
      fs.appendFileSync(growing, Buffer.alloc(TEXT_LIMIT + 1));
    }
    return stat;
  };
  try {
    assert.throws(() => f.files.read({ projectId: 'example', path: 'growing.md' }), /exceeds/u);
  } finally { fs.fstatSync = fstatSync; }

  const registry = path.join(f.vimicateDir, 'projects.md');
  const registrySize = fs.statSync(registry).size;
  let grewRegistry = false;
  fs.fstatSync = function(fd, ...rest) {
    const stat = fstatSync.call(this, fd, ...rest);
    if (!grewRegistry && stat.isFile() && stat.size === registrySize) {
      grewRegistry = true;
      fs.appendFileSync(registry, Buffer.alloc(REGISTRY_LIMIT + 1));
    }
    return stat;
  };
  try {
    assert.throws(() => f.files.list({ projectId: 'example', path: '' }), /unsafe project registry/u);
  } finally { fs.fstatSync = fstatSync; }
});

test('stops directory enumeration on the 4,097th entry', t => {
  const f = fixture(t);
  const opendirSync = fs.opendirSync;
  let reads = 0;
  fs.opendirSync = () => ({
    readSync() { reads += 1; return { name: `entry-${reads}.md` }; },
    closeSync() {},
  });
  try {
    assert.throws(() => f.files.list({ projectId: 'example', path: '' }), /directory entry limit exceeded/u);
    assert.equal(reads, 4097);
  } finally { fs.opendirSync = opendirSync; }
});

test('lists and rejects a FIFO without blocking the Gateway', t => {
  const f = fixture(t);
  const moduleUrl = new URL('./project-files.mjs', import.meta.url).href;
  const script = `
    import { execFileSync } from 'node:child_process';
    import path from 'node:path';
    import { createProjectFiles } from ${JSON.stringify(moduleUrl)};
    const vimicateDir = ${JSON.stringify(f.vimicateDir)};
    const project = ${JSON.stringify(f.project)};
    execFileSync('/usr/bin/mkfifo', [path.join(project, 'waiting.txt')]);
    const files = createProjectFiles({ vimicateDir });
    const listed = files.list({ projectId: 'example', path: '', includeUnsupported: true });
    let readError = '';
    try { files.read({ projectId: 'example', path: 'waiting.txt' }); }
    catch (error) { readError = error instanceof Error ? error.message : String(error); }
    process.stdout.write(JSON.stringify({ names: listed.entries.map(entry => entry.name), readError }));
  `;
  const result = spawnSync(process.execPath, ['--input-type=module', '--eval', script], {
    encoding: 'utf8', timeout: 2000,
  });
  assert.equal(result.error, undefined, result.error?.message);
  assert.equal(result.status, 0, result.stderr);
  const outcome = JSON.parse(result.stdout);
  assert.equal(outcome.names.includes('waiting.txt'), false);
  assert.match(outcome.readError, /unsupported file type/u);
});

test('fails closed for unsupported, invalid, NUL-bearing and oversized files', t => {
  const f = fixture(t);
  fs.writeFileSync(path.join(f.project, 'binary.bin'), Buffer.from([1]));
  fs.writeFileSync(path.join(f.project, 'invalid.txt'), Buffer.from([0xc3, 0x28]));
  fs.writeFileSync(path.join(f.project, 'nul.txt'), Buffer.from('before\0after'));
  fs.writeFileSync(path.join(f.project, 'large.md'), 'x');
  fs.truncateSync(path.join(f.project, 'large.md'), 1024 * 1024 + 1);

  assert.throws(() => f.files.read({ projectId: 'example', path: 'binary.bin' }), /unsupported file type/u);
  assert.throws(() => f.files.read({ projectId: 'example', path: 'invalid.txt' }), /not valid UTF-8/u);
  assert.throws(() => f.files.read({ projectId: 'example', path: 'nul.txt' }), /unsupported NUL/u);
  assert.throws(() => f.files.read({ projectId: 'example', path: 'large.md' }), /exceeds/u);
  assert.deepEqual(f.files.list({ projectId: 'remote', path: '' }).entries, []);
  assert.throws(() => f.files.list({ projectId: 'unknown', path: '' }), /unavailable or ambiguous/u);
});
