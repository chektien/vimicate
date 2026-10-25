import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { buildSqlitePlugin } from './build-sqlite-plugin.mjs';
import { PLUGIN_PAYLOAD_FILES, artifactHashes, verifyArtifactIntegrity, writeArtifactIntegrity } from './plugin-artifact-integrity.mjs';

/** Backfill identity ONLY for an existing artifact proven equal to current
 * reviewed payloads. Does not change its modules, package or plugin selection. */
export async function attestPluginArtifact(destination, apply = false) {
  await artifactHashes(destination); // rejects symlinks/non-files before reads
  const temp = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'vimicate-attest-')));
  try {
    const candidate = path.join(temp, 'candidate');
    await buildSqlitePlugin(candidate);
    for (const name of PLUGIN_PAYLOAD_FILES) {
      const [actual, expected] = await Promise.all([destination, candidate].map(root => fs.readFile(path.join(root, name))));
      if (name === 'package.json') {
        const metadata = JSON.parse(actual), canonical = JSON.parse(expected);
        assert.ok(['2.0.0', '2.1.0'].includes(metadata.version), 'unreviewed legacy artifact version');
        canonical.version = metadata.version;
        assert.deepEqual(metadata, canonical, 'legacy metadata differs from reviewed build');
      } else assert.ok(actual.equals(expected), `artifact differs from reviewed source: ${name}`);
    }
    try { return await verifyArtifactIntegrity(destination); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (!apply) return { sourceVerified: true, requiresAttestation: true };
    await writeArtifactIntegrity(destination);
    return await verifyArtifactIntegrity(destination);
  } finally { await fs.rm(temp, { recursive: true, force: true }); }
}
if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  console.log(JSON.stringify(await attestPluginArtifact(path.resolve(process.argv[2]), process.argv.includes('--apply')), null, 2));
}
