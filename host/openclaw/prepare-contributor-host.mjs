import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { buildSqlitePlugin } from './build-sqlite-plugin.mjs';
import { loadSqliteHistoryRuntime } from './sqlite-history-runtime.mjs';
import { loadSessionRunTruthRuntime } from './session-run-truth.mjs';

/** Prepare only new private files. Never discover maintainer state, patch the
 * installed package, merge a live config, or start/restart a Gateway. */
export async function prepareContributorHost({ packageRoot, destination, projectRoot }) {
  for (const value of [packageRoot, projectRoot]) {
    if (typeof value !== 'string' || /[\r\n]/u.test(value) || !path.isAbsolute(value)
      || await fs.realpath(value) !== value || !(await fs.stat(value)).isDirectory()) {
      throw new Error('fixed absolute package and project directories required');
    }
  }
  if (typeof destination !== 'string' || !path.isAbsolute(destination)
    || await fs.realpath(path.dirname(destination)) !== path.dirname(destination)) {
    throw new Error('new destination under a fixed absolute parent required');
  }
  // Admit only an audited stock/composed runtime before writing configuration.
  await loadSqliteHistoryRuntime(packageRoot);
  await loadSessionRunTruthRuntime(packageRoot);
  await fs.mkdir(destination, { mode: 0o700 });
  const stateDir = path.join(destination, 'openclaw-state');
  const vimicateDir = path.join(destination, 'registry');
  await fs.mkdir(stateDir, { mode: 0o700 });
  await fs.mkdir(vimicateDir, { mode: 0o700 });
  const write = (name, text) => fs.writeFile(name, text, { mode: 0o600, flag: 'wx' });
  const manifestPath = path.join(vimicateDir, 'import-manifest.json');
  const secretPath = path.join(vimicateDir, 'history-secret');
  await write(manifestPath, JSON.stringify({ contract: 'sqlite-import-manifest-v1',
    sourceLedgerDigest: crypto.createHash('sha256').update('[]').digest('hex'), families: {} }, null, 2) + '\n');
  await write(secretPath, crypto.randomBytes(32));
  await write(path.join(vimicateDir, 'projects.md'),
    `# Vimicate Projects\n\n## Example\n- id: example\n- group: home\n- repo: ${projectRoot}/\n`);
  const pluginPath = path.join(destination, 'plugin');
  const artifact = await buildSqlitePlugin(pluginPath);
  const config = { plugins: { allow: ['vimicate-history-family'], load: { paths: [pluginPath] },
    entries: { 'vimicate-history-family': { enabled: true,
      config: { packageRoot, stateDir, vimicateDir, manifestPath, secretPath } } } } };
  const configPath = path.join(destination, 'openclaw-config-fragment.json');
  await write(configPath, JSON.stringify(config, null, 2) + '\n');
  return { stateDir, configPath, pluginPath, buildId: artifact.buildId };
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  if (process.argv.length !== 5) throw new Error('usage: node prepare-contributor-host.mjs <package-root> <new-destination> <project-root>');
  const result = await prepareContributorHost({ packageRoot: process.argv[2], destination: process.argv[3], projectRoot: process.argv[4] });
  console.log(JSON.stringify(result, null, 2));
}
