import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const LEGACY_PAYLOAD_FILES = Object.freeze([
  'sqlite-gateway-plugin.mjs', 'sqlite-history-runtime.mjs', 'sqlite-history-evidence.mjs',
  'sqlite-history-profiles.mjs', 'sqlite-history-profiles-legacy.mjs',
  'sqlite-history-authority.mjs', 'sqlite-history-reader.mjs', 'sqlite-history-family.mjs',
  'session-run-truth.mjs', 'sqlite-history-plugin.mjs', 'session-archive-verification.mjs',
  'thread-registry.mjs', 'thread-registry-merge.mjs', 'vimicate-narration-plugin-runtime.mjs',
  'project-files.mjs', 'project-file-primitives.mjs', 'icloud-materialize.mjs',
  'vimicate-narration-record-contract.mjs', 'vimicate-narration-state-store.mjs',
  'vimicate-narration-page-views.mjs',
  'index.mjs', 'openclaw.plugin.json', 'package.json',
].sort());
export const PLUGIN_PAYLOAD_FILES = Object.freeze([...LEGACY_PAYLOAD_FILES, 'LICENSE', 'THIRD_PARTY_NOTICES.md'].sort());
const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const buildId = files => digest(JSON.stringify(Object.entries(files).sort(([a], [b]) => a.localeCompare(b))));
async function safeBytes(root, name) {
  const file = path.join(root, name), stat = await fs.lstat(file);
  if (!stat.isFile() || stat.nlink !== 1 || stat.size > 2 * 1024 * 1024) throw new Error('unsafe plugin payload: ' + name);
  return fs.readFile(file);
}
export async function artifactHashes(root, files = PLUGIN_PAYLOAD_FILES) {
  return Object.fromEntries(await Promise.all(files.map(async name => [name, digest(await safeBytes(root, name))])));
}
export async function writeArtifactIntegrity(root) {
  const source = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
  // Exported source archives intentionally have no Git metadata. Do not invent
  // a revision or borrow the identity of an unrelated enclosing repository.
  let sourceRevision = null, sourceDirty = null;
  const hasGit = await fs.lstat(path.join(source, '.git')).then(() => true).catch(error => {
    if (error.code === 'ENOENT') return false;
    throw error;
  });
  if (hasGit) {
    sourceRevision = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: source, encoding: 'utf8', timeout: 5000 }).trim();
    sourceDirty = Boolean(execFileSync('git', ['status', '--porcelain', '--', '.'], { cwd: source, encoding: 'utf8', timeout: 5000 }).trim());
  }
  const files = await artifactHashes(root);
  const manifest = { schemaVersion: 2, buildId: buildId(files), sourceRevision, sourceDirty, files };
  await fs.writeFile(path.join(root, 'vimicate-build.json'), JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  return manifest;
}
export async function verifyArtifactIntegrity(root) {
  const manifest = JSON.parse(await safeBytes(root, 'vimicate-build.json'));
  const payload = manifest.schemaVersion === 1 ? LEGACY_PAYLOAD_FILES : PLUGIN_PAYLOAD_FILES;
  const gitIdentity = /^[a-f0-9]{40,64}$/.test(manifest.sourceRevision ?? '') && typeof manifest.sourceDirty === 'boolean';
  const archiveIdentity = manifest.schemaVersion === 2 && manifest.sourceRevision === null && manifest.sourceDirty === null;
  if (![1, 2].includes(manifest.schemaVersion) || !(gitIdentity || archiveIdentity) || !manifest.files
    || JSON.stringify(Object.keys(manifest.files).sort()) !== JSON.stringify(payload)) throw new Error('invalid plugin build manifest');
  const files = await artifactHashes(root, payload);
  if (manifest.buildId !== buildId(files) || Object.entries(files).some(([name, hash]) => manifest.files[name] !== hash)) {
    throw new Error('plugin payload integrity mismatch');
  }
  return manifest;
}
