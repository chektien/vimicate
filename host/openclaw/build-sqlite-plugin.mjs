import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { SQLITE_HISTORY_RUNTIME, SQLITE_HISTORY_SUPPORTED_RUNTIMES } from './sqlite-history-runtime.mjs';
import { PLUGIN_PAYLOAD_FILES, writeArtifactIntegrity } from './plugin-artifact-integrity.mjs';

const source = path.dirname(fileURLToPath(import.meta.url));
export const sqlitePluginManifest = {
  id: 'vimicate-history-family', name: 'Vimicate integration',
  description: 'Native history, project files, thread registry and shared narration for Vimicate',
  activation: { onStartup: true },
  configSchema: { type: 'object', additionalProperties: false,
    required: ['packageRoot', 'stateDir', 'vimicateDir', 'manifestPath', 'secretPath'],
    properties: Object.fromEntries(['packageRoot', 'stateDir', 'vimicateDir', 'manifestPath', 'secretPath']
      .map(name => [name, { type: 'string', minLength: 1 }])) },
};
const notices = ['LICENSE', 'THIRD_PARTY_NOTICES.md'];
const files = PLUGIN_PAYLOAD_FILES.filter(name => !['index.mjs', 'package.json', 'openclaw.plugin.json', ...notices].includes(name));

/** Build an explicit, new artifact directory. Installation/activation belongs
 * to OpenClaw's plugin installer; this does not modify a running package. */
export async function buildSqlitePlugin(destination) {
  if (!path.isAbsolute(destination) || await fs.realpath(path.dirname(destination)) !== path.dirname(destination)) {
    throw new Error('new destination under a fixed absolute parent required');
  }
  const noticeBytes = await Promise.all(notices.map(name => fs.readFile(path.resolve(source, '../..', name))));
  const license = noticeBytes[0].toString();
  if (!/^Copyright \(c\) \d{4}(?:-\d{4})? [^\n<>]+$/m.test(license)
    || /TO CONFIRM|PLACEHOLDER|\bTODO\b/i.test(license)
    || !license.includes('Permission is hereby granted, free of charge')
    || !license.includes('THE SOFTWARE IS PROVIDED "AS IS"')) {
    throw new Error('finalized project MIT license required before building a host artifact');
  }
  await fs.mkdir(destination, { mode: 0o700 });
  const hashes = {};
  for (const [index, name] of notices.entries()) {
    await fs.writeFile(path.join(destination, name), noticeBytes[index], { flag: 'wx', mode: 0o600 });
    hashes[name] = crypto.createHash('sha256').update(noticeBytes[index]).digest('hex');
  }
  for (const name of files) {
    const bytes = await fs.readFile(path.join(source, name));
    // No runtime dependency can escape the explicitly packaged source set.
    for (const [, dependency] of bytes.toString().matchAll(/from ['"]\.\/([^'"]+)['"]/g)) {
      if (!files.includes(dependency)) throw new Error(`unpackaged runtime dependency: ${dependency}`);
    }
    await fs.writeFile(path.join(destination, name), bytes, { flag: 'wx', mode: 0o600 });
    hashes[name] = crypto.createHash('sha256').update(bytes).digest('hex');
  }
  const generated = {
    'openclaw.plugin.json': JSON.stringify(sqlitePluginManifest, null, 2) + '\n',
    'package.json': JSON.stringify({ name: '@vimicate/openclaw-integration', version: '2.1.3-files-preview.1', license: 'MIT',
      private: true, type: 'module', vimicate: { auditedRuntimes: SQLITE_HISTORY_SUPPORTED_RUNTIMES }, openclaw: { extensions: ['./index.mjs'] } }, null, 2) + '\n',
    'index.mjs': `import { registerVimicateSqliteGateway } from './sqlite-gateway-plugin.mjs';
export default { id: 'vimicate-history-family', name: 'Vimicate integration',
  register(api) { registerVimicateSqliteGateway(api, api.pluginConfig); } };
`,
  };
  for (const [name, bytes] of Object.entries(generated)) {
    await fs.writeFile(path.join(destination, name), bytes, { flag: 'wx', mode: 0o600 });
    hashes[name] = crypto.createHash('sha256').update(bytes).digest('hex');
  }
  const integrity = await writeArtifactIntegrity(destination);
  return { destination, runtime: SQLITE_HISTORY_RUNTIME, buildId: integrity.buildId, files: hashes };
}
if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  if (process.argv.length !== 3) throw new Error('usage: node build-sqlite-plugin.mjs <new-absolute-directory>');
  console.log(JSON.stringify(await buildSqlitePlugin(process.argv[2])));
}
