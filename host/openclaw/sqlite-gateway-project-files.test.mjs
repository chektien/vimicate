import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { registerVimicateSqliteGateway } from './sqlite-gateway-plugin.mjs';

test('consolidated plugin exposes confined project file reads at operator.read scope', async t => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'vimicate-project-rpc-')));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const vimicateDir = path.join(root, 'vimicate');
  const project = path.join(root, 'project');
  const homeDir = root;
  const cloud = path.join(homeDir, 'Library', 'Mobile Documents', 'com~apple~CloudDocs');
  const downloads = path.join(cloud, 'Downloads');
  fs.mkdirSync(downloads, { recursive: true, mode: 0o700 });
  fs.symlinkSync(cloud, path.join(homeDir, 'icloud'));
  fs.writeFileSync(path.join(downloads, 'shared.md'), '# synthetic shared file\n');
  // Fail before touching the operator's home, even if a future RPC drops the
  // explicit file-owner root. Catch-and-ignore production paths cannot hide it.
  const outsideReads = [];
  const realpathSync = fs.realpathSync;
  t.mock.method(fs, 'realpathSync', (candidate, ...args) => {
    if (typeof candidate === 'string' && candidate !== root && !candidate.startsWith(`${root}${path.sep}`)) {
      outsideReads.push(candidate);
      throw new Error('fixture attempted external filesystem access');
    }
    return realpathSync(candidate, ...args);
  });
  t.after(() => assert.equal(outsideReads.length, 0, 'all file resolution must stay in the synthetic fixture'));
  fs.mkdirSync(vimicateDir, { mode: 0o700 });
  fs.mkdirSync(project, { mode: 0o700 });
  fs.writeFileSync(path.join(vimicateDir, 'projects.md'),
    `# Projects\n\n## Example\n- id: example\n- repo: ${project}/\n`, { mode: 0o600 });
  fs.writeFileSync(path.join(project, 'README.md'), '# exact source\n');
  const artifacts = path.join(vimicateDir, 'agent', 'artifacts');
  fs.mkdirSync(artifacts, { recursive: true, mode: 0o700 });
  fs.writeFileSync(path.join(artifacts, 'report.xlsx'), Buffer.from([0x50, 0x4b, 0, 255]));

  const methods = new Map();
  const api = {
    agent: { events: { registerAgentEventSubscription: () => ({ dispose() {} }) } },
    registerGatewayMethod(name, handler, options) { methods.set(name, { handler, options }); },
    registerService() {},
    runtime: { config: { current: () => ({ agents: { entries: { main: {} } } }) } },
  };
  registerVimicateSqliteGateway(api, {
    packageRoot: root,
    stateDir: root,
    vimicateDir,
    homeDir,
    manifestPath: path.join(root, 'manifest.json'),
    secretPath: path.join(root, 'secret'),
  });

  assert.equal(methods.get('vimicate.projectFiles.list').options.scope, 'operator.read');
  assert.equal(methods.get('vimicate.projectFiles.read').options.scope, 'operator.read');
  for (const name of ['resolve', 'list', 'read']) assert.equal(methods.get(`vimicate.sharedFiles.${name}`).options.scope, 'operator.read');
  for (const name of ['resolve', 'list', 'read', 'exportChunk']) assert.equal(methods.get(`vimicate.files.${name}`).options.scope, 'operator.read');
  const call = async (name, params) => new Promise((resolve, reject) => {
    methods.get(name).handler({ params, respond(ok, payload, error) {
      if (ok) resolve(payload); else reject(new Error(error?.message));
    } });
  });
  const listed = await call('vimicate.projectFiles.list', { projectId: 'example', path: '' });
  assert.deepEqual(listed.entries.map(entry => [entry.name, entry.kind]), [['README.md', 'text']]);
  const read = await call('vimicate.projectFiles.read', { projectId: 'example', path: 'README.md' });
  assert.equal(read.text, '# exact source\n');
  await assert.rejects(call('vimicate.projectFiles.read', { projectId: 'example', path: '../outside' }), /traversal/u);
  await assert.rejects(call('vimicate.sharedFiles.resolve', { sourcePath: path.join(root, 'project', 'README.md') }), /outside the shared Downloads location/u);
  assert.deepEqual(await call('vimicate.sharedFiles.resolve', { sourcePath: '~/icloud/Downloads/shared.md' }),
    { schemaVersion: 1, location: 'icloud-downloads', path: 'shared.md' });
  const sharedRead = await call('vimicate.sharedFiles.read', { projectId: 'shared-icloud-downloads', path: 'shared.md' });
  assert.equal(sharedRead.text, '# synthetic shared file\n');
  const resolved = await call('vimicate.files.resolve', { sourcePath: path.join(artifacts, 'report.xlsx') });
  assert.deepEqual(resolved, { schemaVersion: 1, location: 'assistant-artifacts',
    projectId: 'assistant-artifacts', path: 'report.xlsx', rootPath: artifacts });
  const document = await call('vimicate.files.read', { ...resolved, includeDocuments: true });
  assert.equal(document.kind, 'document');
  assert.equal(document.location, 'assistant-artifacts');
  assert.equal(document.dataBase64, 'UEsA/w==');
  const shared = await call('vimicate.files.exportChunk', { ...resolved, size: document.size, mtimeMs: document.mtimeMs, offset: 0 });
  assert.equal(shared.dataBase64, document.dataBase64);
  assert.equal(shared.mimeType, document.mimeType);
  await assert.rejects(call('vimicate.files.exportChunk', { ...resolved, size: document.size, mtimeMs: document.mtimeMs,
    offset: 0, path: '../outside.xlsx' }), /traversal/u);
  const files = await call('vimicate.files.list', { ...resolved, path: '', includeDocuments: true });
  assert.deepEqual(files.entries.map(entry => [entry.name, entry.kind]), [['report.xlsx', 'document']]);
  await assert.rejects(call('vimicate.files.read', resolved), /unsupported file type/u);
  await assert.rejects(call('vimicate.files.list', { ...resolved, projectId: 'example', path: '' }), /invalid assistant artifacts project id/u);
  await assert.rejects(call('vimicate.files.resolve', { sourcePath: path.join(root, 'manifest.json') }), /file is unavailable/u);
});
