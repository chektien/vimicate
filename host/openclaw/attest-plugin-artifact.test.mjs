import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { attestPluginArtifact } from './attest-plugin-artifact.mjs';
import { buildSqlitePlugin } from './build-sqlite-plugin.mjs';
import { artifactHashes } from './plugin-artifact-integrity.mjs';

test('legacy attestation verifies every payload without changing executable or package bytes', async t => {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'vimicate-attest-test-')));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const destination = path.join(root, 'plugin');
  await buildSqlitePlugin(destination);
  await fs.unlink(path.join(destination, 'vimicate-build.json'));
  const metadataPath = path.join(destination, 'package.json');
  const metadata = JSON.parse(await fs.readFile(metadataPath));
  metadata.version = '2.0.0';
  await fs.writeFile(metadataPath, JSON.stringify(metadata));
  const before = await artifactHashes(destination);
  assert.deepEqual(await attestPluginArtifact(destination), { sourceVerified: true, requiresAttestation: true });
  const sealed = await attestPluginArtifact(destination, true);
  assert.deepEqual(await artifactHashes(destination), before);
  assert.equal((await attestPluginArtifact(destination, true)).buildId, sealed.buildId);
  await fs.appendFile(path.join(destination, 'index.mjs'), '\n// unknown code\n');
  await assert.rejects(attestPluginArtifact(destination, true), /differs from reviewed source/);
});
