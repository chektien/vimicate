import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { prepareContributorHost } from './prepare-contributor-host.mjs';
import { verifyArtifactIntegrity } from './plugin-artifact-integrity.mjs';

test('contributor preparation refuses unreviewed packages without creating host state', async t => {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'vimicate-setup-')));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const destination = path.join(root, 'new');
  await fs.writeFile(path.join(root, 'package.json'), JSON.stringify({ name: 'openclaw', version: 'unreviewed' }));
  await assert.rejects(prepareContributorHost({ packageRoot: root, projectRoot: root, destination }));
  await assert.rejects(fs.stat(destination), { code: 'ENOENT' });
  await assert.rejects(prepareContributorHost({ packageRoot: root, projectRoot: `${root}\ninjected`, destination }), /fixed absolute/);
});

test('a reviewed stock package prepares private isolated files and refuses reuse', {
  skip: !process.env.OPENCLAW_HISTORY_TEST_PACKAGE_ROOT,
}, async t => {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'vimicate-setup-stock-')));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const input = { packageRoot: await fs.realpath(process.env.OPENCLAW_HISTORY_TEST_PACKAGE_ROOT),
    projectRoot: root, destination: path.join(root, 'new') };
  const result = await prepareContributorHost(input);
  const config = JSON.parse(await fs.readFile(result.configPath));
  const entry = config.plugins.entries['vimicate-history-family'];
  assert.deepEqual(config.plugins.load.paths, [result.pluginPath]);
  assert.equal(entry.enabled, true);
  assert.equal(entry.config.stateDir, result.stateDir);
  assert.equal(entry.config.packageRoot, input.packageRoot);
  const manifest = JSON.parse(await fs.readFile(entry.config.manifestPath));
  assert.deepEqual(manifest.families, {});
  assert.equal((await fs.stat(input.destination)).mode & 0o777, 0o700);
  for (const filename of [result.configPath, entry.config.secretPath, entry.config.manifestPath]) {
    assert.equal((await fs.stat(filename)).mode & 0o777, 0o600);
  }
  const secret = await fs.readFile(entry.config.secretPath);
  assert.equal(secret.length, 32);
  assert.deepEqual(await fs.readdir(result.stateDir), []);
  await verifyArtifactIntegrity(result.pluginPath);
  await assert.rejects(prepareContributorHost(input), { code: 'EEXIST' });
  assert.deepEqual(await fs.readFile(entry.config.secretPath), secret);
});
