import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath, pathToFileURL } from 'node:url';
import crypto from 'node:crypto';
import { buildSqlitePlugin, sqlitePluginManifest } from './build-sqlite-plugin.mjs';
import { verifyArtifactIntegrity } from './plugin-artifact-integrity.mjs';

test('update fixtures work with a symlinked Terminal temporary directory', async t => {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'vimicate-terminal-temp-')));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const alias = path.join(root, 'terminal-temp');
  await fs.symlink(root, alias);
  // macOS Terminal commonly supplies /var/... or /tmp, both symlink aliases.
  // Run the real consumers without relaxing the builder's fixed-parent guard.
  const env = { ...process.env, TMPDIR: alias, TMP: alias, TEMP: alias };
  delete env.NODE_TEST_CONTEXT;
  const { stdout } = await promisify(execFile)(process.execPath, ['--test', '--test-reporter=tap', '--test-concurrency=1',
    ...['check-update-compatibility.test.mjs', 'sqlite-history-runtime-acceptance.test.mjs']
      .map(name => fileURLToPath(new URL(name, import.meta.url)))], {
    env, timeout: 120000,
  });
  assert.match(stdout, /# tests 2\b/);
  assert.match(stdout, /# fail 0\b/);
  if (env.OPENCLAW_HISTORY_TEST_PACKAGE_ROOT) assert.match(stdout, /# skipped 0\b/);
});

test('packaged integration explicitly activates at startup and excludes old JSONL writers', async t => {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'vimicate-plugin-artifact-')));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const result = await buildSqlitePlugin(path.join(root, 'plugin'));
  assert.equal(sqlitePluginManifest.activation.onStartup, true);
  assert.equal(result.runtime, '2026.10.7');
  assert.equal(Object.keys(result.files).length, 25);
  assert.ok(result.files['vimicate-narration-page-views.mjs']);
  const integrity = await verifyArtifactIntegrity(result.destination);
  assert.equal(result.buildId, integrity.buildId);
  if (integrity.sourceRevision === null) assert.equal(integrity.sourceDirty, null);
  else {
    assert.match(integrity.sourceRevision, /^[a-f0-9]{40}$/);
    assert.equal(typeof integrity.sourceDirty, 'boolean');
  }
  const manifest = JSON.parse(await fs.readFile(path.join(result.destination, 'openclaw.plugin.json')));
  assert.deepEqual(manifest, sqlitePluginManifest);
  const metadata = JSON.parse(await fs.readFile(path.join(result.destination, 'package.json')));
  assert.equal(metadata.license, 'MIT');
  assert.ok(metadata.vimicate.auditedRuntimes.includes('2026.9.2'));
  assert.ok(metadata.vimicate.auditedRuntimes.includes('2026.9.4'));
  assert.ok(metadata.vimicate.auditedRuntimes.includes('2026.9.5'));
  assert.ok(metadata.vimicate.auditedRuntimes.includes('2026.9.6'));
  assert.ok(metadata.vimicate.auditedRuntimes.includes('2026.9.8'));
  assert.ok(metadata.vimicate.auditedRuntimes.includes('2026.9.9'));
  assert.ok(metadata.vimicate.auditedRuntimes.includes('2026.10.2'));
  assert.ok(metadata.vimicate.auditedRuntimes.includes('2026.10.4'));
  assert.ok(metadata.vimicate.auditedRuntimes.includes('2026.10.5'));
  assert.ok(metadata.vimicate.auditedRuntimes.includes('2026.10.6'));
  assert.ok(metadata.vimicate.auditedRuntimes.includes('2026.10.7'));
  assert.equal(Object.keys(result.files).some(name => name.includes('ledger') || name.includes('installer')), false);
  await fs.appendFile(path.join(result.destination, 'index.mjs'), '\n// altered entry\n');
  await assert.rejects(verifyArtifactIntegrity(result.destination), /integrity mismatch/);
  await assert.rejects(buildSqlitePlugin(result.destination), /EEXIST/);
  await fs.symlink(root, path.join(root, 'link'));
  await assert.rejects(buildSqlitePlugin(path.join(root, 'link', 'other')), /fixed absolute/);
});

test('source archives build licensed hash-verified artifacts without borrowing enclosing Git identity', async t => {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'vimicate-archive-build-')));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await promisify(execFile)('git', ['init', '--quiet', root]);
  const archive = path.join(root, 'archive'), sources = path.join(archive, 'host/openclaw');
  await fs.cp(fileURLToPath(new URL('.', import.meta.url)), sources, { recursive: true });
  const { buildSqlitePlugin: build } = await import(pathToFileURL(path.join(sources, 'build-sqlite-plugin.mjs')));
  const { verifyArtifactIntegrity: verify } = await import(pathToFileURL(path.join(sources, 'plugin-artifact-integrity.mjs')));
  const destination = path.join(root, 'plugin');
  await assert.rejects(build(destination), { code: 'ENOENT' });
  await assert.rejects(fs.stat(destination), { code: 'ENOENT' });
  const license = 'MIT License\nCopyright (c) 2026 Synthetic test fixture\nPermission is hereby granted, free of charge\nTHE SOFTWARE IS PROVIDED "AS IS"\n';
  await fs.writeFile(path.join(archive, 'THIRD_PARTY_NOTICES.md'), 'Synthetic retained notice\n');
  await fs.writeFile(path.join(archive, 'LICENSE'), 'PLACEHOLDER');
  await assert.rejects(build(destination), /finalized project MIT license/);
  await fs.writeFile(path.join(archive, 'LICENSE'), license);
  const result = await build(destination), integrity = await verify(destination);
  assert.equal(integrity.schemaVersion, 2);
  assert.equal(integrity.sourceRevision, null);
  assert.equal(integrity.sourceDirty, null);
  assert.equal(integrity.files.LICENSE, crypto.createHash('sha256').update(license).digest('hex'));
  assert.equal(await fs.readFile(path.join(destination, 'LICENSE'), 'utf8'), license);
  assert.equal(JSON.parse(await fs.readFile(path.join(destination, 'package.json'))).license, 'MIT');
  assert.equal(result.buildId, integrity.buildId);
  await fs.appendFile(path.join(destination, 'THIRD_PARTY_NOTICES.md'), 'tampered\n');
  await assert.rejects(verify(destination), /integrity mismatch/);
});

test('existing v1 artifacts retain exact payload verification without new license claims', async t => {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'vimicate-legacy-integrity-')));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const { PLUGIN_PAYLOAD_FILES } = await import('./plugin-artifact-integrity.mjs');
  const files = {};
  for (const name of PLUGIN_PAYLOAD_FILES.filter(name => !['LICENSE', 'THIRD_PARTY_NOTICES.md'].includes(name))) {
    await fs.writeFile(path.join(root, name), `legacy fixture ${name}`);
    files[name] = crypto.createHash('sha256').update(`legacy fixture ${name}`).digest('hex');
  }
  const buildId = crypto.createHash('sha256').update(JSON.stringify(Object.entries(files).sort(([a], [b]) => a.localeCompare(b)))).digest('hex');
  await fs.writeFile(path.join(root, 'vimicate-build.json'), JSON.stringify({ schemaVersion: 1,
    buildId, sourceRevision: 'a'.repeat(40), sourceDirty: false, files }));
  assert.equal((await verifyArtifactIntegrity(root)).buildId, buildId);
  await fs.appendFile(path.join(root, 'index.mjs'), 'tampered');
  await assert.rejects(verifyArtifactIntegrity(root), /integrity mismatch/);
});
