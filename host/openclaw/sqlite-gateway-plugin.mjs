import { readWithICloudMaterialization } from './icloud-materialize.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { createThreadRegistry, updateThreadRegistryWhenReady } from './thread-registry.mjs';
import { createSqliteHistoryFamily } from './sqlite-history-family.mjs';
import { loadSqliteHistoryAuthority } from './sqlite-history-authority.mjs';
import { loadSqliteHistoryReader } from './sqlite-history-reader.mjs';
import { registerSqliteHistoryPlugin } from './sqlite-history-plugin.mjs';
import { registerVimicateNarrationPlugin } from './vimicate-narration-plugin-runtime.mjs';
import { registerSessionRunTruth } from './session-run-truth.mjs';
import { createProjectFiles } from './project-files.mjs';

function privateFile(filename, limit) {
  const fd = fs.openSync(filename, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const stat = fs.fstatSync(fd);
    if (!stat.isFile() || stat.nlink !== 1 || stat.uid !== process.getuid() || (stat.mode & 0o077) || stat.size > limit) throw new Error('unsafe SQLite history authority file');
    const bytes = fs.readFileSync(fd);
    const after = fs.fstatSync(fd);
    if (bytes.length !== stat.size || stat.size !== after.size || stat.mtimeMs !== after.mtimeMs) throw new Error('SQLite history authority file changed');
    return bytes;
  } finally { fs.closeSync(fd); }
}

/** One 2026.8.1 plugin owns all four existing Vimicate RPCs. It replaces the
 * compiled registry patch/JSONL writer, not OpenClaw's session implementation. */
export function registerVimicateSqliteGateway(api, { packageRoot, stateDir, vimicateDir, manifestPath, secretPath, homeDir }) {
  for (const value of [packageRoot, stateDir, vimicateDir, manifestPath, secretPath]) {
    if (typeof value !== 'string' || !path.isAbsolute(value)) throw new Error('explicit absolute gateway integration paths required');
  }
  registerSessionRunTruth(api, { packageRoot });
  const formatError = message => ({ code: 'UNAVAILABLE', message });
  const lifetime = new AbortController();
  const projectFiles = createProjectFiles({ vimicateDir, homeDir });
  let registry, setup;
  async function initialize() {
    lifetime.signal.throwIfAborted();
    if (!setup) setup = (async () => {
      const authority = await loadSqliteHistoryAuthority({ packageRoot, stateDir });
      lifetime.signal.throwIfAborted();
      registry = createThreadRegistry({ vimicateDir, readCurrent: authority.readCurrent,
        readCurrentGenerations: () => authority.readCurrentGenerations(Object.keys(api.runtime.config.current().agents?.entries ?? { main: {} })),
        capabilities: () => ({ sessionHistory: 'sqlite-display-v1', projectFiles: 'project-files-read-v1', sharedFiles: 'icloud-downloads-read-v1', files: 'bounded-files-read-v1', ...history.capabilities(),
          ...(narration.isReady() ? { sharedNarration: 'shared-narration-v1' } : {}) }) });
      return authority;
    })();
    return setup;
  }
  const history = registerSqliteHistoryPlugin(api, {
    formatError,
    createFamily: async ({ signal }) => {
      const authority = await initialize(); signal.throwIfAborted();
      const reader = await loadSqliteHistoryReader({ packageRoot, stateDir });
      try {
        const secret = privateFile(secretPath, 256);
        let family;
        try { family = createSqliteHistoryFamily({ authority, reader,
          manifest: JSON.parse(privateFile(manifestPath, 4 * 1024 * 1024)), secret }); }
        finally { secret.fill(0); }
        return { ...family, dispose() { family.dispose(); reader.dispose(); } };
      } catch (error) { reader.dispose(); throw error; }
    },
  });
  const narration = registerVimicateNarrationPlugin(api, { vimicateDir, formatError });
  for (const [name, method, scope] of [['read', 'read', 'operator.read'], ['updateThreads', 'update', 'operator.write']]) {
    api.registerGatewayMethod(`vimicate.registry.${name}`, async ({ params, respond }) => {
      try {
        await initialize(); lifetime.signal.throwIfAborted();
        const result = method === 'update'
          ? await updateThreadRegistryWhenReady(registry, params, lifetime.signal)
          : registry.read(params);
        respond(true, result, undefined);
      } catch (error) { respond(false, undefined, formatError(error instanceof Error ? error.message : String(error))); }
    }, { scope });
  }
  // Reads may hit iCloud placeholders synced from another Mac; lists never read contents.
  const call = (method, params) => /read$|Read$|ExportChunk$/u.test(method)
    ? readWithICloudMaterialization(() => projectFiles[method](params)) : projectFiles[method](params);
  for (const [name, method] of [['list', 'list'], ['read', 'read']]) {
    api.registerGatewayMethod(`vimicate.projectFiles.${name}`, async ({ params, respond }) => {
      try { respond(true, await call(method, params), undefined); }
      catch (error) { respond(false, undefined, formatError(error instanceof Error ? error.message : String(error))); }
    }, { scope: 'operator.read' });
  }
  for (const [name, method] of [['resolve', 'resolveShared'], ['list', 'sharedList'], ['read', 'sharedRead']]) {
    api.registerGatewayMethod(`vimicate.sharedFiles.${name}`, async ({ params, respond }) => {
      try { respond(true, await call(method, params), undefined); }
      catch (error) { respond(false, undefined, formatError(error instanceof Error ? error.message : String(error))); }
    }, { scope: 'operator.read' });
  }
  for (const [name, method] of [['resolve', 'resolve'], ['list', 'locationList'], ['read', 'locationRead'], ['exportChunk', 'locationExportChunk']]) {
    api.registerGatewayMethod(`vimicate.files.${name}`, async ({ params, respond }) => {
      try { respond(true, await call(method, params), undefined); }
      catch (error) { respond(false, undefined, formatError(error instanceof Error ? error.message : String(error))); }
    }, { scope: 'operator.read' });
  }
  api.registerService({ id: 'vimicate-registry', start: initialize,
    stop() { lifetime.abort(new Error('Vimicate registry stopped')); registry?.dispose(); } });
  return { history, narration, initialize };
}
