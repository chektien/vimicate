import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createProjectFiles } from './project-files.mjs';

function fixture(t) {
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.homedir(), '.vimicate-hosted-files-')));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const vimicateDir = path.join(base, 'registry'), retired = path.join(base, 'retired');
  fs.mkdirSync(vimicateDir); fs.mkdirSync(retired);
  fs.writeFileSync(path.join(retired, 'stale.md'), 'retired');
  fs.writeFileSync(path.join(vimicateDir, 'projects.md'), [
    '## Example', '- id: example', `- repo: ${retired}`, '- file-roots:',
    `  - repo@work-mac: ${base}/remote`, '',
  ].join('\n'));
  return { base, vimicateDir, retired };
}

test('explicit hosted roots never expose a retired local checkout through the legacy reader', t => {
  const f = fixture(t), local = createProjectFiles(f);
  assert.throws(() => local.list({ projectId: 'example', path: '' }), /host-aware/u);
  assert.throws(() => local.resolve({ projectId: 'example', sourcePath: path.join(f.retired, 'stale.md') }), /outside allowed/u);
});

import { createHostedProjectFiles } from './hosted-project-files.mjs';
import { createRootAccess } from './project-file-access.mjs';

function hosted(t) {
  const f = fixture(t), remoteRoot = path.join(f.base, 'remote');
  fs.mkdirSync(remoteRoot); fs.mkdirSync(path.join(remoteRoot, 'docs'));
  fs.writeFileSync(path.join(remoteRoot, 'docs', 'guide.md'), 'current remote');
  fs.writeFileSync(path.join(remoteRoot, 'report.pdf'), '%PDF-synthetic');
  fs.writeFileSync(path.join(remoteRoot, 'opaque.bin'), Buffer.from([0, 255, 1]));
  const calls = [];
  const remote = { run: async (host, root, method, params) => {
    calls.push({ host, root, method, params }); return createRootAccess(root)[method](params);
  }, dispose() {} };
  return { ...f, remoteRoot, calls, remote, files: createHostedProjectFiles({ ...f, remote }) };
}

test('lists registered hosts without contacting them and uses the selected root for directory and preview', async t => {
  const f = hosted(t);
  const top = await f.files.list({ projectId: 'example', path: '' });
  assert.deepEqual(top.entries.map(e => e.name), ['repo@work-mac']);
  assert.equal(top.directoryLabel, 'Project folders'); assert.equal(f.calls.length, 0);
  const dir = await f.files.list({ projectId: 'example', path: 'repo@work-mac/docs' });
  assert.equal(dir.directoryLabel, `work-mac:${f.remoteRoot}/docs`);
  assert.equal(dir.entries[0].path, 'repo@work-mac/docs/guide.md');
  const params = { location: 'project', projectId: 'example', path: dir.entries[0].path };
  assert.equal((await f.files.locationRead(params)).text, 'current remote');
  assert.deepEqual(f.calls.map(c => c.host), ['work-mac', 'work-mac']);
  for (const route of ['locationRead', 'locationExportChunk']) {
    await assert.rejects(f.files[route]({ ...params, path: 'unknown@work-mac/docs/guide.md' }), /outside registered/u);
  }
});

test('keeps remote documents and complete original transfers under the existing bounded contract', async t => {
  const f = hosted(t);
  const params = { location: 'project', projectId: 'example', path: 'repo@work-mac/report.pdf', includeDocuments: true };
  const pdf = await f.files.locationRead(params);
  assert.equal(Buffer.from(pdf.dataBase64, 'base64').toString(), '%PDF-synthetic');
  const chunk = await f.files.locationExportChunk({ ...params, size: pdf.size, mtimeMs: pdf.mtimeMs, offset: 0 });
  assert.equal(chunk.path, params.path); assert.equal(chunk.dataBase64, pdf.dataBase64);
  assert.ok(chunk.version.length <= 256);
  await assert.rejects(f.files.locationRead({ ...params, includeDocuments: false }), /unsupported/u);
  await assert.rejects(f.files.locationRead({ ...params, path: 'repo@work-mac/opaque.bin' }), /unsupported/u);
  const big = path.join(f.remoteRoot, 'big.md'); fs.writeFileSync(big, 'x'); fs.truncateSync(big, 1024 * 1024 + 1);
  await assert.rejects(f.files.read({ projectId: 'example', path: 'repo@work-mac/big.md' }), /exceeds/u);
});

test('maps absolute transcript links into the hosted path and rejects symlinks and traversal', async t => {
  const f = hosted(t), sourcePath = path.join(f.remoteRoot, 'docs', 'guide.md');
  const resolved = await f.files.resolve({ sourcePath, projectId: 'example' });
  assert.equal(resolved.path, 'repo@work-mac/docs/guide.md');
  assert.equal((await f.files.locationRead(resolved)).text, 'current remote');
  fs.symlinkSync(path.join(f.retired, 'stale.md'), path.join(f.remoteRoot, 'escape.md'));
  await assert.rejects(f.files.read({ projectId: 'example', path: 'repo@work-mac/escape.md' }), /escapes/u);
  await assert.rejects(f.files.resolve({ sourcePath: path.join(f.remoteRoot, 'escape.md') }), /escapes/u);
  for (const p of ['repo@work-mac/../stale.md', '../stale.md', '/absolute', 'repo@work-mac/./docs']) {
    await assert.rejects(f.files.list({ projectId: 'example', path: p }), /path|traversal/u);
  }
});

test('keeps both hosts distinct and refuses an ambiguous absolute link', async t => {
  const f = hosted(t), registry = path.join(f.vimicateDir, 'projects.md');
  fs.appendFileSync(registry, `  - replica@gateway: ${f.remoteRoot}\n`);
  const top = await f.files.list({ projectId: 'example', path: '' });
  assert.equal(top.entries.length, 2);
  await assert.rejects(f.files.resolve({ projectId: 'example', sourcePath: path.join(f.remoteRoot, 'docs', 'guide.md') }), /ambiguous/u);
  const local = await f.files.list({ projectId: 'example', path: 'replica@gateway/docs' });
  assert.equal(local.entries[0].path, 'replica@gateway/docs/guide.md'); assert.equal(f.calls.length, 0);
});

test('never falls back on offline, removed or changed remote mappings', async t => {
  const f = hosted(t), registry = path.join(f.vimicateDir, 'projects.md');
  f.remote.run = async () => { throw new Error('host work-mac is unavailable'); };
  await assert.rejects(f.files.list({ projectId: 'example', path: 'repo@work-mac' }), /unavailable/u);
  f.remote.run = async (_host, root, method, params) => {
    const value = createRootAccess(root)[method](params);
    fs.writeFileSync(registry, fs.readFileSync(registry, 'utf8').replace(f.remoteRoot, path.join(f.base, 'changed')));
    return value;
  };
  await assert.rejects(f.files.read({ projectId: 'example', path: 'repo@work-mac/docs/guide.md' }), /changed during/u);
});

test('rejects malformed, empty, duplicate and shell-bearing registry roots', async t => {
  const f = hosted(t), registry = path.join(f.vimicateDir, 'projects.md');
  for (const entry of ['', '  - invalid', '  - x@-bad: /tmp/root', '  - x@host: ../relative',
    '  - x@host: /tmp/../root', '  - x@host: /tmp/a\n  - x@host: /tmp/b', '  - x@host;touch: /tmp/a']) {
    fs.writeFileSync(registry, `## Example\n- id: example\n- repo: ${f.retired}\n- file-roots:\n${entry}\n`);
    await assert.rejects(f.files.list({ projectId: 'example', path: '' }), /file-roots|root/u);
  }
});

test('legacy single-host projects and shared file locations remain unchanged', async t => {
  const f = hosted(t);
  fs.writeFileSync(path.join(f.vimicateDir, 'projects.md'), `## Example\n- id: example\n- repo: ${f.retired}\n`);
  assert.equal((await f.files.list({ projectId: 'example', path: '' })).entries[0].name, 'stale.md');
  assert.equal((await f.files.read({ projectId: 'example', path: 'stale.md' })).text, 'retired');
});


test('redirects relative link listings without admitting unqualified reads or alias races', async t => {
  const f = hosted(t);
  for (const path of ['', 'docs', 'some@ordinary-folder']) {
    const directory = await f.files.list({ projectId: 'example', path });
    assert.equal(directory.path, path); assert.equal(directory.primaryRoot, 'repo@work-mac');
    assert.equal(f.calls.length, 0);
  }
  await assert.rejects(f.files.read({ projectId: 'example', path: 'docs/guide.md' }), /outside registered/u);
  await assert.rejects(f.files.locationRead({ location: 'project', projectId: 'example', path: 'report.pdf' }), /outside registered/u);
});


test('a hosted parent cannot steal a deeper legacy project or shared-location link', async t => {
  const f = hosted(t), nested = path.join(f.remoteRoot, 'nested'); fs.mkdirSync(nested);
  fs.writeFileSync(path.join(nested, 'guide.md'), 'nested project');
  fs.appendFileSync(path.join(f.vimicateDir, 'projects.md'), `## Nested\n- id: nested\n- repo: ${nested}\n`);
  const resolved = await f.files.resolve({ projectId: 'nested', sourcePath: path.join(nested, 'guide.md') });
  assert.equal(resolved.projectId, 'nested'); assert.equal(resolved.path, 'guide.md');
  assert.equal((await f.files.locationRead(resolved)).text, 'nested project');
  assert.equal(f.calls.length, 0);
});

test('trailing separators cannot choose between otherwise ambiguous hosts', async t => {
  const f = hosted(t);
  fs.appendFileSync(path.join(f.vimicateDir, 'projects.md'), `  - same@gateway: ${f.remoteRoot}/\n`);
  await assert.rejects(f.files.resolve({ projectId: 'example', sourcePath: path.join(f.remoteRoot, 'docs', 'guide.md') }), /ambiguous/u);
  assert.equal(f.calls.length, 0);
});

test('qualified in-flight requests keep their selected host when only primary order changes', async t => {
  const f = hosted(t), registry = path.join(f.vimicateDir, 'projects.md');
  fs.appendFileSync(registry, `  - other@gateway: ${f.retired}\n`);
  f.remote.run = async (_host, root, method, params) => {
    const value = createRootAccess(root)[method](params);
    const before = fs.readFileSync(registry, 'utf8');
    fs.writeFileSync(registry, before.replace(`  - repo@work-mac: ${f.remoteRoot}\n\n  - other@gateway: ${f.retired}\n`,
      `  - other@gateway: ${f.retired}\n  - repo@work-mac: ${f.remoteRoot}\n`));
    return value;
  };
  assert.equal((await f.files.read({ projectId: 'example', path: 'repo@work-mac/docs/guide.md' })).text, 'current remote');
});
