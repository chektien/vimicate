import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { buildSqlitePlugin } from './build-sqlite-plugin.mjs';

const target = process.env.OPENCLAW_HISTORY_TEST_PACKAGE_ROOT;
const fixtures = {
  '2026.11.3': ['reply-run-registry.registry-DjlsSV_e.mjs', 'sessions-read-QORJB2sW.mjs', 'plugin-setup-module-DUPuK-Np.mjs'],
  '2026.11.1': ['reply-run-registry.registry-BlzIDIz-.mjs', 'sessions-read-8WZVwcoa.mjs', 'plugin-setup-module-fwWGzhte.mjs'],
  '2026.10.10': ['reply-run-registry.registry-AU46m76C.mjs', 'sessions-read-BSqkIDDT.mjs', 'plugin-setup-module-T3m9n359.mjs'],
  '2026.10.8': ['reply-run-registry.registry-P4L3EVyw.mjs', 'sessions-read-DaqLIW6z.mjs', 'plugin-setup-module-CDxHOMjX.mjs'],
  '2026.10.7': ['reply-run-registry.registry-CLWEwkqe.mjs', 'sessions-read-BXwTspcX.mjs', 'plugin-setup-module-DkTSoH8N.mjs'],
  '2026.10.4': ['reply-run-registry.registry-5e3UVXZS.mjs', 'sessions-read-DziXtPpO.mjs', 'plugin-setup-module-CeetwhwH.mjs'],
  '2026.10.5': ['reply-run-registry.registry-BswPq0Xd.mjs', 'sessions-read-DNOkgOd5.mjs', 'plugin-setup-module-ivVK8RSf.mjs'],
  '2026.10.6': ['reply-run-registry.registry-BzgREenr.mjs', 'sessions-read-CLHMalI8.mjs', 'plugin-setup-module-BtgPcZxn.mjs'],
};
if (process.env.VIMICATE_RUN_TRUTH_ACCEPTANCE_CHILD !== '1') {
  test('captured reader observes the native steering backend, not a duplicate module-local registry',
    { skip: !target }, async t => {
      const metadata = JSON.parse(await fs.readFile(path.join(target, 'package.json')));
      if (!fixtures[metadata.version]) return t.skip('no run-truth fixture for this runtime');
      const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'vimicate-run-truth-')));
      t.after(() => fs.rm(root, { recursive: true, force: true }));
      const plugin = path.join(root, 'plugin');
      await buildSqlitePlugin(plugin);
      const { stdout } = await promisify(execFile)(process.execPath, [fileURLToPath(import.meta.url)], {
        timeout: 90000, env: { ...process.env, VIMICATE_RUN_TRUTH_ACCEPTANCE_CHILD: '1',
          VIMICATE_RUN_TRUTH_ACCEPTANCE_ROOT: root, VIMICATE_RUN_TRUTH_ACCEPTANCE_PLUGIN: plugin },
      });
      assert.match(stdout, /native and captured steering identity accepted/);
    });
} else {
  const root = process.env.VIMICATE_RUN_TRUTH_ACCEPTANCE_ROOT;
  process.env.OPENCLAW_STATE_DIR = path.join(root, 'state');
  process.env.OPENCLAW_CONFIG_PATH = path.join(root, 'openclaw.json');
  await fs.writeFile(process.env.OPENCLAW_CONFIG_PATH, '{}');
  const load = name => import(pathToFileURL(path.join(target, 'dist', name)).href);
  const version = JSON.parse(await fs.readFile(path.join(target, 'package.json'))).version;
  const fixture = fixtures[version];
  const contexts = await load(version === '2026.11.3' ? 'agent-run-registry-gmaPgO-n.mjs' : version === '2026.11.1' ? 'agent-run-registry-BBn72PQp.mjs' : ['2026.10.10', '2026.11.1', '2026.11.3'].includes(version) ? 'agent-run-registry-Dvv4_0by.mjs' : ['2026.10.5', '2026.10.6', '2026.10.7', '2026.10.8', '2026.10.10', '2026.11.1', '2026.11.3'].includes(version) ? (version === '2026.10.8' ? 'agent-run-registry-fu4Yij2z.mjs' : ['2026.10.6', '2026.10.7', '2026.10.8', '2026.10.10', '2026.11.1', '2026.11.3'].includes(version) ? 'agent-run-registry-B2Kia58i.mjs' : 'agent-run-registry-zReSioYT.mjs') : 'agent-run-registry-BaxMDLZF.mjs');
  const claim = contexts[['2026.10.5', '2026.10.6', '2026.10.7', '2026.10.8', '2026.10.10', '2026.11.1', '2026.11.3'].includes(version) ? 'i' : 'r'];
  const clear = contexts[['2026.10.5', '2026.10.6', '2026.10.7', '2026.10.8', '2026.10.10', '2026.11.1', '2026.11.3'].includes(version) ? 'o' : 'a'];
  const { g: registry } = await load(fixture[0]);
  const { t: handlers } = await load(fixture[1]);
  const { n: PluginInstance, r: bindPluginInstanceModuleLoader } = await load(fixture[2]);
  const instance = new PluginInstance('vimicate-history-family');
  const plugin = process.env.VIMICATE_RUN_TRUTH_ACCEPTANCE_PLUGIN;
  const source = path.join(plugin, 'session-run-truth.mjs');
  bindPluginInstanceModuleLoader({ instance, source, rootDir: plugin, origin: 'global' });
  const captured = instance.loadModule(source);
  const native = await import('./session-run-truth.mjs');
  const key = 'agent:main:run-truth-fixture';
  const operation = registry.begin({ sessionKey: key, sessionId: 'run-truth-fixture-session' });
  operation.setPhase('running');
  operation.attachBackend({ kind: 'embedded', runId: 'actual-native-run',
    messageInjection: { isAvailable: () => true, queueMessage() { throw new Error('read must not inject'); } },
    cancel() { throw new Error('read must not cancel'); } });
  const context = { sessionKey: key, sessionId: 'run-truth-fixture-session',
    cronRunsByJobId: new Map([['fixture-job', { pacingEnabled: true }]]) };
  claim('actual-native-run', context, { trackOwner: true, ownsContext: true });
  try {
    assert.equal(registry.resolveCurrentMessageInjectionTarget(key)?.runId, 'actual-native-run');
    for (const module of [native, captured]) {
      const runtime = await module.loadSessionRunTruthRuntime(target);
      // Equality alone with a separately captured namespace was the old false
      // assurance. The attached native backend proves the identity boundary.
      assert.equal(runtime.registry.resolveCurrentMessageInjectionTarget(key)?.runId, 'actual-native-run');
      assert.equal(runtime.registry, registry);
      assert.equal(runtime.describe, handlers['sessions.describe']);
      const reader = module.createSessionRunTruthReader({ ...runtime,
        describe: async options => options.respond(true, { session: { key, sessionId: context.sessionId, hasActiveRun: true } }) });
      let reply;
      await reader({ params: { sessionKey: key }, respond: (...args) => { reply = args; } });
      assert.equal(reply[1].session.activeRunId, 'actual-native-run');
      assert.equal(reply[1].session.sessionId, context.sessionId);
      assert.deepEqual(reply[1].session.activeRunOrigin, { kind: 'scheduled', runId: 'actual-native-run', sessionId: context.sessionId });
      context.cronRunsByJobId.clear();
      runtime.runContexts.getAgentRunContext('actual-native-run').cronRunsByJobId.clear();
      await reader({ params: { sessionKey: key }, respond: (...args) => { reply = args; } });
      assert.equal(reply[1].session.activeRunOrigin, undefined);
      assert.equal(reply[1].session.sessionId, context.sessionId);
      runtime.runContexts.getAgentRunContext('actual-native-run').cronRunsByJobId.set('fixture-job', { pacingEnabled: true });
    }
    operation.complete();
    assert.equal(registry.resolveCurrentMessageInjectionTarget(key), undefined);
    assert.equal((await captured.loadSessionRunTruthRuntime(target)).registry.resolveCurrentMessageInjectionTarget(key), undefined);
    if (['2026.10.5', '2026.10.6', '2026.10.7', '2026.10.8', '2026.10.10', '2026.11.1', '2026.11.3'].includes(version)) await acceptAttachedRunIdentity();
    console.log('native and captured steering identity accepted');
  } finally {
    clear('actual-native-run');
    operation.complete();
    assert.deepEqual((await instance.dispose()).errors, []);
  }
  process.exit(0);

  // Attached identity comes from the native backend owner, including while
  // injection is unavailable. Never name unattached, completed, changed-generation
  // or aborting work. Older profiles additionally retain their strict refusal check.
  async function acceptAttachedRunIdentity() {
    // Historical profiles also characterize the old strict-steering refusal.
    // 10.10 adopts native steering and must never import that dropped helper.
    const assertActiveSteerTarget = ['2026.10.10', '2026.11.1', '2026.11.3'].includes(version) ? undefined
      : (await load('strict-active-steering-local.mjs')).assertActiveSteerTarget;
    const refusal = expected => {
      try { assertActiveSteerTarget({ steerPolicy: 'require-active', expectedActiveRunId: expected }, undefined,
        () => registry.resolveCurrentInterruptTarget(key)); } catch (error) { return error.details; }
      throw new Error('strict steering unexpectedly admitted');
    };
    const read = async (module, sessionId = 'run-truth-fixture-session') => {
      const reader = module.createSessionRunTruthReader({ ...(await module.loadSessionRunTruthRuntime(target)),
        describe: async options => options.respond(true, { session: { key, sessionId, hasActiveRun: true } }) });
      let reply; await reader({ params: { sessionKey: key }, respond: (...args) => { reply = args; } });
      return reply[1].session;
    };
    const unattached = registry.begin({ sessionKey: key, sessionId: 'run-truth-fixture-session' });
    unattached.setPhase('running');
    try {
      if (assertActiveSteerTarget) assert.equal(refusal('attached-run').reason, 'no_active_run');
      assert.equal(registry.resolveCurrentInterruptTarget(key)?.runId, undefined);
      for (const module of [native, captured]) assert.equal((await read(module)).attachedRunId, undefined);
    } finally { unattached.complete(); }
    const busy = registry.begin({ sessionKey: key, sessionId: 'run-truth-fixture-session' });
    busy.setPhase('running');
    busy.attachBackend({ kind: 'embedded', runId: 'attached-run',
      messageInjection: { isAvailable: () => false, queueMessage() { throw new Error('read must not inject'); } },
      cancel() { throw new Error('read must not cancel'); } });
    try {
      if (assertActiveSteerTarget) assert.deepEqual(refusal('attached-run'), { reason: 'run_not_ready', expectedActiveRunId: 'attached-run',
        activeRunId: 'attached-run', inputDisposition: 'not-dispatched', suggestedQueueMode: 'interrupt' });
      assert.equal(registry.resolveCurrentMessageInjectionTarget(key), undefined);
      if (['2026.10.10', '2026.11.1', '2026.11.3'].includes(version)) assert.equal((await native.loadSessionRunTruthRuntime(target)).getAttachedBackend(busy)?.runId, 'attached-run');
      else assert.equal(registry.resolveCurrentInterruptTarget(key)?.runId, 'attached-run');
      for (const module of [native, captured]) {
        const session = await read(module);
        assert.equal(session.activeRunId, undefined); // Never a steering target.
        assert.equal(session.attachedRunId, 'attached-run');
        assert.equal(session.sessionId, 'run-truth-fixture-session');
        assert.equal((await read(module, 'successor-generation')).attachedRunId, undefined);
      }
    } finally { busy.complete(); }
    if (assertActiveSteerTarget) assert.equal(refusal('attached-run').reason, 'no_active_run');
    assert.equal(registry.resolveCurrentInterruptTarget(key), undefined);
    for (const module of [native, captured]) assert.equal((await read(module)).attachedRunId, undefined);
    const successor = registry.begin({ sessionKey: key, sessionId: 'run-truth-fixture-session' });
    successor.setPhase('running');
    successor.attachBackend({ kind: 'embedded', runId: 'successor-run',
      messageInjection: { isAvailable: () => false, queueMessage() { throw new Error('read must not inject'); } },
      cancel() {} });
    try {
      // A stale expected identity is a changed run, never a queue proof.
      if (assertActiveSteerTarget) assert.equal(refusal('attached-run').reason, 'active_run_changed');
      if (['2026.10.10', '2026.11.1', '2026.11.3'].includes(version)) assert.equal((await native.loadSessionRunTruthRuntime(target)).getAttachedBackend(successor)?.runId, 'successor-run');
      else assert.equal(registry.resolveCurrentInterruptTarget(key)?.runId, 'successor-run');
      assert.equal((await read(native)).attachedRunId, 'successor-run');
      successor.abortByUser();
      for (const module of [native, captured]) assert.equal((await read(module)).attachedRunId, undefined);
    } finally { successor.complete(); }
  }
}
