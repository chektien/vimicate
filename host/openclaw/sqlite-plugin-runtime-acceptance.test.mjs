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
  '2026.11.1': ['registry-BuVg2_RV.mjs', 'runtime-CNnMUogG.mjs', 'session-accessor-B_vtmJRr.mjs'],
  '2026.10.10': ['registry-Cp3Ucw57.mjs', 'runtime-DbAbpcIy.mjs', 'session-accessor-DN7dldOi.mjs'],
  '2026.10.8': ['registry-vAFp5m5F.mjs', 'runtime-BXQF4n0S.mjs', 'session-accessor-ebdiOYjA.mjs'],
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
      assert.match(stdout, /native API acceptance: 15 scopes, current binding, nonmutating probe, 1 narration record/);
      if (['2026.10.10', '2026.11.1'].includes(metadata.version)) {
        const negativeState = path.join(root, 'negative-state');
        await fs.mkdir(negativeState, { mode: 0o700 });
        await assert.rejects(promisify(execFile)(process.execPath, [fileURLToPath(import.meta.url)], {
          timeout: 30000, env: { ...process.env, VIMICATE_API_ACCEPTANCE_CHILD: '1',
            VIMICATE_API_ACCEPTANCE_STATE: negativeState, VIMICATE_API_ACCEPTANCE_PLUGIN: pluginRoot,
            VIMICATE_API_ACCEPTANCE_NEGATIVE_SCOPE: '1' },
        }), error => error.code === 1 && /native read-only caller must not invoke a write handler/.test(error.stderr));
        console.log('native authorization negative control rejected weakened write scope');
      }
    });
} else {
  const stateDir = process.env.VIMICATE_API_ACCEPTANCE_STATE;
  process.env.OPENCLAW_STATE_DIR = stateDir;
  process.env.OPENCLAW_CONFIG_PATH = path.join(stateDir, 'openclaw.json');
  await fs.writeFile(process.env.OPENCLAW_CONFIG_PATH, '{}');
  const load = name => import(pathToFileURL(path.join(target, 'dist', name)));
  const version = JSON.parse(await fs.readFile(path.join(target, 'package.json'))).version;
  const fixture = fixtures[version];
  if (['2026.10.10', '2026.11.1'].includes(version)) {
    const { t: captureRuntimeConfigAsyncReader } = await load(version === '2026.11.1' ? 'io.runtime-3AQXKbcT.mjs' : 'io.runtime-BcDhh2yB.mjs');
    await captureRuntimeConfigAsyncReader()();
  }
  const { t: createPluginRegistry } = await load(fixture[0]);
  const { C: setActivePluginRegistry, r: clearActivePluginRegistry } = await load(fixture[1]);
  assert.equal(setActivePluginRegistry.name, 'setActivePluginRegistry');
  assert.equal(clearActivePluginRegistry.name, 'clearActivePluginRegistry');
  const events = await load(version === '2026.11.1' ? 'agent-events--ilVEEKp.mjs' : version === '2026.10.10' ? 'agent-events-BkjBm4i4.mjs' : ['2026.10.5', '2026.10.6', '2026.10.7', '2026.10.8'].includes(version) ? (version === '2026.10.8' ? 'agent-events-B_uc1nn7.mjs' : version === '2026.10.7' ? 'agent-events-DwWyqfWg.mjs' : version === '2026.10.6' ? 'agent-events-CJDT60f4.mjs' : 'agent-events-CCeMHYh0.mjs') : 'agent-events-GvNTkbe3.mjs');
  const emitAgentEvent = events[['2026.10.10', '2026.11.1'].includes(version) ? 'a' : ['2026.10.5', '2026.10.6', '2026.10.7', '2026.10.8'].includes(version) ? 'a' : 'i'];
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
  if (['2026.11.1', '2026.10.10', '2026.10.4', '2026.10.5', '2026.10.6', '2026.10.7', '2026.10.8'].includes(version)) {
    const { loadSessionRunTruthRuntime } = await import(pathToFileURL(path.join(record.rootDir, 'session-run-truth.mjs')));
    const runtime = await loadSessionRunTruthRuntime(target);
    assert.equal(runtime.describe, (await load(version === '2026.11.1' ? 'sessions-read-8WZVwcoa.mjs' : version === '2026.10.10' ? 'sessions-read-BSqkIDDT.mjs' : ['2026.10.5', '2026.10.6', '2026.10.7', '2026.10.8'].includes(version) ? (version === '2026.10.8' ? 'sessions-read-DaqLIW6z.mjs' : version === '2026.10.7' ? 'sessions-read-BXwTspcX.mjs' : version === '2026.10.6' ? 'sessions-read-CLHMalI8.mjs' : 'sessions-read-DNOkgOd5.mjs') : 'sessions-read-DziXtPpO.mjs')).t['sessions.describe']);
    assert.equal(runtime.registry, (await load(version === '2026.11.1' ? 'reply-run-registry.registry-BlzIDIz-.mjs' : version === '2026.10.10' ? 'reply-run-registry.registry-AU46m76C.mjs' : ['2026.10.5', '2026.10.6', '2026.10.7', '2026.10.8'].includes(version) ? (version === '2026.10.8' ? 'reply-run-registry.registry-P4L3EVyw.mjs' : version === '2026.10.7' ? 'reply-run-registry.registry-CLWEwkqe.mjs' : version === '2026.10.6' ? 'reply-run-registry.registry-BzgREenr.mjs' : 'reply-run-registry.registry-BswPq0Xd.mjs') : 'reply-run-registry.registry-5e3UVXZS.mjs')).g);
  }
  const descriptors = host.registry.gatewayMethodDescriptors;
  assert.equal(descriptors.length, 15);
  for (const { name, scope } of descriptors) {
    assert.equal(scope, ['vimicate.registry.updateThreads', 'vimicate.registry.removeProject'].includes(name) ? 'operator.write' : 'operator.read');
  }
  assert.equal(host.registry.diagnostics.filter(d => d.level === 'error').length, 0);
  const dispatch = version === '2026.11.1' ? (await load('server-methods-DnNzgKWz.mjs')).n : version === '2026.10.10' ? (await load('server-methods-CVw-m1_3.mjs')).n : undefined;
  if (dispatch) assert.equal(dispatch.name, 'handleGatewayRequest');
  async function invoke(method, params, scopes = ['operator.read']) {
    let response;
    const respond = (...args) => { response = args; };
    if (dispatch) await dispatch({ req: { type: 'req', id: 'fixture-request', method, params },
      client: { connId: 'fixture-operator', connect: { role: 'operator', scopes } },
      isWebchatConnect: () => false, hasCurrentClientAuthority: () => true,
      context: { getRuntimeConfig: () => ({}), logGateway: logger }, respond });
    else await host.registry.gatewayHandlers[method]({ params, respond }, {});
    assert.ok(response, 'native handler must respond');
    return response;
  }
  async function call(method, params, scopes) {
    const response = await invoke(method, params, scopes);
    assert.equal(response[0], true, JSON.stringify(response[2]));
    return response[1];
  }
  const registry = await call('vimicate.registry.read', {});
  assert.equal(JSON.parse(registry.threads.json).threads[0].currentBinding.sessionID, id);
  assert.equal(registry.currentSessionGenerations[key].sessionId, id);
  assert.equal((await call('vimicate.registry.updateThreads',
    { contract: 'host-current-v1', mode: 'probe', entries: [] }, ['operator.write'])).outcome, 'unchanged');
  assert.deepEqual(await fs.readFile(threadsFile), before);
  if (dispatch) {
    const noReadScope = await invoke('vimicate.registry.read', {}, []);
    assert.equal(noReadScope[0], false);
    assert.match(JSON.stringify(noReadScope[2]), /operator.read/);
    if (process.env.VIMICATE_API_ACCEPTANCE_NEGATIVE_SCOPE === '1')
      descriptors.find(entry => entry.name === 'vimicate.registry.updateThreads').scope = 'operator.read';
    const original = JSON.parse(before).threads[0];
    const update = { contract: 'host-current-v1', mode: 'upsert', entries: [{ ...original,
      currentBinding: { ...original.currentBinding, sessionID: 'untrusted-client-generation' } }] };
    const unauthorized = await invoke('vimicate.registry.updateThreads', update);
    assert.equal(unauthorized[0], false, 'native read-only caller must not invoke a write handler');
    assert.match(JSON.stringify(unauthorized[2]), /operator.write/);
    assert.deepEqual(await fs.readFile(threadsFile), before);
    assert.equal((await call('vimicate.registry.updateThreads', update, ['operator.write'])).outcome, 'updated');
    const written = await fs.readFile(threadsFile);
    assert.equal(JSON.parse(written).threads[0].currentBinding.sessionID, id,
      'native concrete generation must override the client generation');
    const reassigned = await invoke('vimicate.registry.updateThreads', { ...update, entries: [{ ...original,
      currentBinding: { ...original.currentBinding, stableSessionKey: 'agent:main:other' } }] }, ['operator.write']);
    assert.equal(reassigned[0], false);
    assert.match(JSON.stringify(reassigned[2]), /cannot reassign/);
    assert.deepEqual(await fs.readFile(threadsFile), written);
    const invalidContract = await invoke('vimicate.registry.updateThreads', { ...update,
      contract: 'untrusted-schema-version' }, ['operator.write']);
    assert.equal(invalidContract[0], false);
    assert.match(JSON.stringify(invalidContract[2]), /contract must be host-current-v1/);
    assert.deepEqual(await fs.readFile(threadsFile), written);
  }
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
  console.log('native API acceptance: 15 scopes, current binding, nonmutating probe, 1 narration record');
  process.exit(0);
}
