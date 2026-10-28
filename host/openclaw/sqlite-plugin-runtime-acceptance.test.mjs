import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import { buildSqlitePlugin } from './build-sqlite-plugin.mjs';

const target = process.env.OPENCLAW_HISTORY_TEST_PACKAGE_ROOT;
const fixtures = {
  '2026.10.7': ['registry-BwDJiK-z.mjs', 'runtime-CCZWjmme.mjs', 'session-accessor-DHlzhHwY.mjs'],
  '2026.10.2': ['registry-854ZO8XT.mjs', 'runtime-B_YqhyYs.mjs', 'session-accessor-Ba0RADzo.mjs'],
  '2026.10.5': ['registry-HOGUZGcB.mjs', 'runtime-DTYJlWfc.mjs', 'session-accessor-ripvAz_n.mjs'],
  '2026.10.6': ['registry-Ctt4xQAS.mjs', 'runtime-BUO_63fN.mjs', 'session-accessor-6sSzHMY-.mjs'],
  '2026.10.4': ['registry-bnv-1upR.mjs', 'runtime-NsVZTERq.mjs', 'session-accessor-C2axcAVZ.mjs'],
};
if (process.env.VIMICATE_API_ACCEPTANCE_CHILD !== '1') {
  test('audited native plugin API retains RPC scopes, thread authority and lifecycle narration',
    { skip: !target }, async t => {
      const metadata = JSON.parse(await fs.readFile(path.join(target, 'package.json')));
      // 9.9 keeps its registry factory private inside the loader; its existing
      // integration tests remain the applicable registration boundary.
      if (!fixtures[metadata.version]) return t.skip('no exported registry fixture for this runtime');
      const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'vimicate-native-api-')));
      t.after(() => fs.rm(root, { recursive: true, force: true }));
      const pluginRoot = path.join(root, 'plugin');
      await buildSqlitePlugin(pluginRoot);
      const stateDir = path.join(root, 'state');
      await fs.mkdir(stateDir, { mode: 0o700 });
      const { stdout } = await promisify(execFile)(process.execPath, [fileURLToPath(import.meta.url)], {
        timeout: 30000, env: { ...process.env, VIMICATE_API_ACCEPTANCE_CHILD: '1',
          VIMICATE_API_ACCEPTANCE_STATE: stateDir, VIMICATE_API_ACCEPTANCE_PLUGIN: pluginRoot },
      });
      assert.match(stdout, /native API acceptance: 14 scopes, current binding, nonmutating probe, 1 narration record/);
    });
} else {
  const stateDir = process.env.VIMICATE_API_ACCEPTANCE_STATE;
  process.env.OPENCLAW_STATE_DIR = stateDir;
  process.env.OPENCLAW_CONFIG_PATH = path.join(stateDir, 'openclaw.json');
  await fs.writeFile(process.env.OPENCLAW_CONFIG_PATH, '{}');
  const load = name => import(pathToFileURL(path.join(target, 'dist', name)));
  const version = JSON.parse(await fs.readFile(path.join(target, 'package.json'))).version;
  const fixture = fixtures[version];
  const { t: createPluginRegistry } = await load(fixture[0]);
  const { C: setActivePluginRegistry, r: clearActivePluginRegistry } = await load(fixture[1]);
  const events = await load(['2026.10.5', '2026.10.6', '2026.10.7'].includes(version) ? (version === '2026.10.7' ? 'agent-events-DwWyqfWg.mjs' : version === '2026.10.6' ? 'agent-events-CJDT60f4.mjs' : 'agent-events-CCeMHYh0.mjs') : 'agent-events-GvNTkbe3.mjs');
  const emitAgentEvent = events[['2026.10.5', '2026.10.6', '2026.10.7'].includes(version) ? 'a' : 'i'];
  assert.equal(createPluginRegistry.name, 'createPluginRegistry');
  assert.equal(emitAgentEvent.name, 'emitAgentEvent');
  const native = await load(fixture[2]);
  assert.equal(native.replaceSessionEntrySync.name, 'replaceSessionEntrySync');
  const key = 'agent:main:fixture', id = '11111111-1111-4111-8111-111111111111';
  native.replaceSessionEntrySync({ agentId: 'main', sessionKey: key, env: process.env,
    storePath: path.join(stateDir, 'agents/main/sessions/sessions.json') },
  { sessionId: id, sessionStartedAt: 1700000000000, updatedAt: 1700000000000 });
  const vimicateDir = path.join(stateDir, 'vimicate');
  await fs.mkdir(vimicateDir, { mode: 0o700 });
  await fs.writeFile(path.join(vimicateDir, 'projects.md'), '# fixture\n');
  const threadsFile = path.join(vimicateDir, 'threads.json');
  await fs.writeFile(threadsFile, JSON.stringify({ version: 1, threads: [{ threadID: key,
    parentProjectID: 'notes', label: 'fixture', state: 'active', order: 1,
    currentBinding: { backend: 'openclaw', stableSessionKey: key, state: 'current', sessionID: 'stale' }, bindings: [] }] }));
  const before = await fs.readFile(threadsFile);
  const logger = { info() {}, warn() {}, error() {}, debug() {} };
  const host = createPluginRegistry({ runtime: { config: { current: () => ({ agents: { entries: { main: {} } } }) } },
    logger, coreGatewayMethodNames: [], activateGlobalSideEffects: false });
  const record = { id: 'vimicate-history-family', name: 'Vimicate', source: import.meta.filename,
    rootDir: process.env.VIMICATE_API_ACCEPTANCE_PLUGIN, origin: 'global', status: 'loaded',
    services: [], gatewayMethods: [], hookNames: [], toolNames: [], channelIds: [], providerIds: [] };
  host.registry.plugins.push(record);
  setActivePluginRegistry(host.registry, 'fixture');
  const pluginConfig = { packageRoot: target, stateDir, vimicateDir,
    manifestPath: path.join(stateDir, 'absent-manifest.json'), secretPath: path.join(stateDir, 'absent-secret') };
  const api = host.createApi(record, { config: {}, pluginConfig });
  const { default: packaged } = await import(pathToFileURL(path.join(record.rootDir, 'index.mjs')));
  packaged.register(api);
  if (['2026.10.4', '2026.10.5', '2026.10.6', '2026.10.7'].includes(version)) {
    const { loadSessionRunTruthRuntime } = await import(pathToFileURL(path.join(record.rootDir, 'session-run-truth.mjs')));
    const runtime = await loadSessionRunTruthRuntime(target);
    assert.equal(runtime.describe, (await load(['2026.10.5', '2026.10.6', '2026.10.7'].includes(version) ? (version === '2026.10.7' ? 'sessions-read-BXwTspcX.mjs' : version === '2026.10.6' ? 'sessions-read-CLHMalI8.mjs' : 'sessions-read-DNOkgOd5.mjs') : 'sessions-read-DziXtPpO.mjs')).t['sessions.describe']);
    assert.equal(runtime.registry, (await load(['2026.10.5', '2026.10.6', '2026.10.7'].includes(version) ? (version === '2026.10.7' ? 'reply-run-registry.registry-CLWEwkqe.mjs' : version === '2026.10.6' ? 'reply-run-registry.registry-BzgREenr.mjs' : 'reply-run-registry.registry-BswPq0Xd.mjs') : 'reply-run-registry.registry-5e3UVXZS.mjs')).g);
  }
  const descriptors = host.registry.gatewayMethodDescriptors;
  assert.equal(descriptors.length, 14);
  for (const { name, scope } of descriptors) {
    assert.equal(scope, name === 'vimicate.registry.updateThreads' ? 'operator.write' : 'operator.read');
  }
  assert.equal(host.registry.diagnostics.filter(d => d.level === 'error').length, 0);
  async function call(method, params) {
    let response;
    await host.registry.gatewayHandlers[method]({ params, respond: (...args) => { response = args; } }, {});
    assert.equal(response[0], true, JSON.stringify(response[2]));
    return response[1];
  }
  const registry = await call('vimicate.registry.read', {});
  assert.equal(JSON.parse(registry.threads.json).threads[0].currentBinding.sessionID, id);
  assert.equal(registry.currentSessionGenerations[key].sessionId, id);
  assert.equal((await call('vimicate.registry.updateThreads',
    { contract: 'host-current-v1', mode: 'probe', entries: [] })).outcome, 'unchanged');
  assert.deepEqual(await fs.readFile(threadsFile), before);
  const narration = host.registry.services.find(entry => entry.id === 'vimicate-shared-narration').service;
  await narration.start();
  emitAgentEvent({ runId: 'fixture-run', stream: 'lifecycle', sessionKey: key, sessionId: id,
    data: { phase: 'start', startedAt: Date.now() } });
  // The upstream item event intentionally omits concrete session authority;
  // the real dispatcher must retain the earlier lifecycle in run context.
  emitAgentEvent({ runId: 'fixture-run', stream: 'item', data: { kind: 'preamble', phase: 'update',
    source: 'codex-app-server', itemId: 'fixture-item', progressText: 'Fixture preamble' } });
  let page;
  for (let guard = 0; guard < 40; guard++) {
    await new Promise(resolve => setTimeout(resolve, 25));
    page = await call('vimicate.narration.page', { contract: 'shared-narration-v1',
      stableSessionKey: key, sessionId: id, cursor: 0, limit: 128 });
    if (page.records.length) break;
  }
  assert.equal(page.records.length, 1);
  assert.equal(page.records[0].text, 'Fixture preamble');
  assert.equal(page.records[0].runId, 'fixture-run');
  assert.equal(page.hasMore, false);
  for (const { service } of host.registry.services) await service.stop();
  clearActivePluginRegistry();
  console.log('native API acceptance: 14 scopes, current binding, nonmutating probe, 1 narration record');
  process.exit(0);
}
