import fs from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { gunzip } from 'node:zlib';
import { pathToFileURL } from 'node:url';
import { verifyArtifactIntegrity } from './plugin-artifact-integrity.mjs';

const gunzipAsync = promisify(gunzip);
const stableRuntime = /^2026\.\d+\.\d+(?:-\d+)?$/;

async function resolveAuditedRuntime(target) {
  if (stableRuntime.test(target ?? '')) return target;
  if (!target || !path.isAbsolute(target) || path.extname(target) !== '.tgz') {
    throw new Error('Vimicate requires an explicit audited release or absolute local .tgz');
  }
  const archivePath = await fs.realpath(target);
  const archive = await gunzipAsync(await fs.readFile(archivePath));
  for (let offset = 0; offset + 512 <= archive.length;) {
    const header = archive.subarray(offset, offset + 512);
    if (header.every(byte => byte === 0)) break;
    const field = (start, end) => header.subarray(start, end).toString('utf8').replace(/\0.*$/, '');
    const name = [field(345, 500), field(0, 100)].filter(Boolean).join('/');
    const sizeText = field(124, 136).trim();
    const size = Number.parseInt(sizeText || '0', 8);
    if (!Number.isSafeInteger(size) || size < 0) throw new Error('Local OpenClaw package has invalid tar metadata');
    const bodyStart = offset + 512;
    if (name === 'package/package.json') {
      const metadata = JSON.parse(archive.subarray(bodyStart, bodyStart + size).toString('utf8'));
      if (metadata.name !== 'openclaw' || !stableRuntime.test(metadata.version ?? '')) {
        throw new Error('Local package is not an exact stable OpenClaw release');
      }
      return metadata.version;
    }
    offset = bodyStart + Math.ceil(size / 512) * 512;
  }
  throw new Error('Local OpenClaw package has no package/package.json');
}

/** Read metadata only. No plugin execution, configuration writes or lifecycle calls. */
export async function checkUpdateCompatibility(config, target) {
  if (config.plugins?.entries?.['vimicate-history-family']?.enabled !== true) return;
  const auditedRuntime = await resolveAuditedRuntime(target);
  const candidates = new Set();
  const selected = new Set();
  async function inspect(directory, explicit = false) {
    let manifest;
    try { manifest = JSON.parse(await fs.readFile(path.join(directory, 'openclaw.plugin.json'), 'utf8')); }
    catch (error) { if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return; throw error; }
    if (manifest.id !== 'vimicate-history-family') return;
    const real = await fs.realpath(directory);
    candidates.add(real);
    if (explicit) selected.add(real);
  }
  for (const directory of config.plugins?.load?.paths ?? []) {
    await inspect(directory, true);
    // OpenClaw also discovers sibling plugin builds under this root.
    for (const entry of await fs.readdir(path.dirname(directory), { withFileTypes: true })) {
      if (entry.isDirectory()) await inspect(path.join(path.dirname(directory), entry.name));
    }
  }
  if (selected.size !== 1 || candidates.size !== 1) {
    throw new Error('Vimicate needs one explicit plugin build and no duplicate sibling plugin IDs; archive stale builds outside discovery');
  }
  const metadata = JSON.parse(await fs.readFile(path.join([...selected][0], 'package.json'), 'utf8'));
  if (!metadata.vimicate?.auditedRuntimes?.includes(auditedRuntime)) {
    throw new Error(`Active Vimicate plugin has no audited compatibility metadata for ${auditedRuntime}; build and select a compatible plugin before updating`);
  }
  await verifyArtifactIntegrity([...selected][0]);
}
if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  try {
    const args = process.argv.slice(3);
    const index = args.indexOf('--tag');
    const target = index >= 0 ? args[index + 1] : args.find(arg => arg.startsWith('--tag='))?.slice(6);
    await checkUpdateCompatibility(JSON.parse(await fs.readFile(process.argv[2], 'utf8')), target);
    console.log('Vimicate update compatibility metadata passed; post-install runtime fingerprint checks still required.');
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
