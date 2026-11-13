import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fork } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Native describe owns session activity. A run registered as hidden from it
// (11.3 private completions, coordination, internal turns) must not become
// Vimicate activity or a run identity through the reply-run registry.
const target = process.env.OPENCLAW_HISTORY_TEST_PACKAGE_ROOT;
const fixtures = {
  '2026.11.3': { io: 'io.runtime-B2RjP7Ie.mjs', accessor: 'session-accessor-FPvTcdkh.mjs', projection: 'session-row-projection-CUMINbhN.mjs',
    projectionAccess: 'session-row-projection-access-BUm5f-cY.mjs', registry: 'reply-run-registry.registry-DjlsSV_e.mjs',
    contexts: 'agent-run-registry-gmaPgO-n.mjs', caller: 'gateway-caller-context-Be176_GV.mjs', runs: 'runs-Dfw2sm74.mjs',
    command: 'agent-command-brmizINq.mjs' },
  '2026.11.1': { io: 'io.runtime-3AQXKbcT.mjs', accessor: 'session-accessor-B_vtmJRr.mjs', projection: 'session-row-projection-DXPxEHLA.mjs',
    projectionAccess: 'session-row-projection-access-BUm5f-cY.mjs', registry: 'reply-run-registry.registry-BlzIDIz-.mjs',
    contexts: 'agent-run-registry-BBn72PQp.mjs', caller: 'gateway-caller-context-C_CpiC_T.mjs', runs: 'runs-D1QJGy0l.mjs',
    command: 'agent-command-s72IJjMR.mjs' },
};
// The exact flags each runtime's prepareEmbeddedSessionState registers.
const PRIVATE = { isControlUiVisible: false, projectSessionMessages: false, projectSessionActive: false };
const COORDINATION = { isControlUiVisible: true, projectSessionMessages: false, projectSessionActive: false };

if (process.env.VIMICATE_RUN_VISIBILITY_CHILD !== '1') {
  test('hidden native owners never become Vimicate activity, visible owners keep theirs', { skip: !target }, async t => {
    const version = JSON.parse(await fs.readFile(path.join(target, 'package.json'), 'utf8')).version;
    if (!fixtures[version]) return t.skip('no visibility fixture for this runtime');
    const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'vimicate-run-visibility-')));
    t.after(() => fs.rm(root, { recursive: true, force: true }));
    const child = fork(fileURLToPath(import.meta.url), [], { execArgv: [], stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
      env: { ...process.env, VIMICATE_RUN_VISIBILITY_CHILD: '1', VIMICATE_RUN_VISIBILITY_ROOT: root } });
    let stdout = '', stderr = '';
    child.stdout.on('data', data => { stdout += data; });
    child.stderr.on('data', data => { stderr += data; });
    const code = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('visibility child timed out')); }, 90_000);
      child.on('close', value => { clearTimeout(timer); resolve(value); });
    });
    assert.equal(code, 0, stderr);
    const report = JSON.parse(stdout.split('\n').find(line => line.startsWith('{')));
    const at = name => report.cases[name];
    assert.equal(report.privateCompletionHiddenByNative, version === '2026.11.3');
    assert.equal(report.coordinationHiddenByNative, true);
    for (const name of ['private-completion', 'coordination']) {
      const observed = at(name);
      assert.equal(observed.injectionTarget, `visibility-${name}`, `${name} is an injection target`);
      assert.equal(observed.native.hasActiveRun, false, `${name} native describe is inactive`);
      assert.equal(observed.plugin.hasActiveRun, false, `${name} is not revived as active`);
      assert.equal(observed.plugin.activeRunId, undefined);
      assert.equal(observed.plugin.attachedRunId, undefined);
      assert.equal(observed.plugin.status, observed.native.status);
    }
    assert.equal(at('visible-active').native.hasActiveRun, true);
    assert.deepEqual(at('visible-active').plugin, { hasActiveRun: true, status: 'running', activeRunId: 'visibility-visible-active' });
    const busy = at('visible-not-injectable');
    assert.equal(busy.injectionTarget, null);
    assert.equal(busy.native.hasActiveRun, true);
    assert.equal(busy.plugin.hasActiveRun, true, 'a visible owner that cannot be steered stays busy');
    assert.equal(busy.plugin.activeRunId, undefined);
    assert.equal(busy.plugin.attachedRunId, 'visibility-visible-not-injectable', 'its attached identity is kept');
    assert.equal(at('hidden-attached').injectionTarget, null);
    assert.equal(at('hidden-attached').plugin.attachedRunId, undefined);
    assert.equal(at('hidden-attached').plugin.hasActiveRun, at('hidden-attached').native.hasActiveRun);
    assert.equal(at('visible-chat-run').plugin.activeRunId, 'visibility-visible-chat-run');
    assert.equal(at('hidden-chat-run').injectionTarget, 'visibility-hidden-chat-run');
    assert.equal(at('hidden-chat-run').plugin.activeRunId, undefined);
    assert.equal(at('hidden-chat-run').plugin.hasActiveRun, at('hidden-chat-run').native.hasActiveRun);
    console.log(JSON.stringify({ version, ...report }));
  });
} else {
  const root = process.env.VIMICATE_RUN_VISIBILITY_ROOT;
  process.env.OPENCLAW_STATE_DIR = root;
  process.env.OPENCLAW_CONFIG_PATH = path.join(root, 'openclaw.json');
  await fs.writeFile(process.env.OPENCLAW_CONFIG_PATH, '{}');
  const version = JSON.parse(await fs.readFile(path.join(target, 'package.json'), 'utf8')).version;
  const f = fixtures[version];
  // Bind owners by their exported function names, not minified letters.
  async function named(file, names) {
    const source = await fs.readFile(path.join(target, 'dist', file), 'utf8');
    const keys = {};
    for (const [, clause] of source.matchAll(/export\s*\{([^}]*)\}/g)) for (const item of clause.split(',')) {
      const [local, exported] = item.trim().split(/\s+as\s+/);
      if (local) keys[local] = exported ?? local;
    }
    const module = await import(pathToFileURL(path.join(target, 'dist', file)).href);
    return Object.fromEntries(names.map(name => {
      assert.ok(keys[name] && module[keys[name]] !== undefined, `${file} exports ${name}`);
      return [name, module[keys[name]]];
    }));
  }
  const command = await fs.readFile(path.join(target, 'dist', f.command), 'utf8');
  const preparation = command.slice(command.indexOf('async function prepareEmbeddedSessionState(params)'));
  const registration = preparation.slice(0, preparation.indexOf('let sessionEntry = params.sessionEntry;'));
  assert.match(registration, /isSubagentCoordinationInputProvenance\(params\.opts\.inputProvenance\)/);
  assert.match(registration, /projectSessionMessages: false/);
  const privateCompletionHiddenByNative = /params\.opts\.privateCompletion === true/.test(registration);
  const { captureRuntimeConfigAsyncReader } = await named(f.io, ['captureRuntimeConfigAsyncReader']);
  await captureRuntimeConfigAsyncReader()();
  const { replaceSessionEntrySync } = await import(pathToFileURL(path.join(target, 'dist', f.accessor)).href);
  const { createSessionRowProjection } = await named(f.projection, ['createSessionRowProjection']);
  const { bindSessionRowProjection } = await named(f.projectionAccess, ['bindSessionRowProjection']);
  const { replyRunRegistry: registry } = await named(f.registry, ['replyRunRegistry']);
  assert.equal(typeof registry.resolveCurrentMessageInjectionTarget, 'function');
  const contexts = await named(f.contexts, ['claimAgentRunDelegatedAuthority', 'claimAgentRunContext',
    'clearAgentRunContext', 'releaseAgentRunDelegatedAuthority']);
  const { withGatewayToolCallerIdentity } = await named(f.caller, ['withGatewayToolCallerIdentity']);
  const { setActiveEmbeddedRun, clearActiveEmbeddedRun } = await named(f.runs, ['setActiveEmbeddedRun', 'clearActiveEmbeddedRun']);
  const { createSessionRunTruthReader, loadSessionRunTruthRuntime } = await import('./session-run-truth.mjs');
  const projection = await createSessionRowProjection({ cfg: {}, modelCatalog: [] });
  const context = { getRuntimeConfig: () => ({}), chatAbortControllers: new Map() };
  bindSessionRowProjection(context, () => projection);
  const runtime = await loadSessionRunTruthRuntime(target);
  const reader = createSessionRunTruthReader(runtime);
  const options = { context, client: { connect: { role: 'operator', scopes: ['operator.read'] } } };
  const refuse = action => () => { throw new Error(`read must not ${action}`); };
  let serial = 0;
  function session(name) {
    const key = `agent:main:visibility-${name}`, runId = `visibility-${name}`;
    const sessionId = `00000000-0000-4000-a000-${String(++serial).padStart(12, '0')}`;
    replaceSessionEntrySync({ agentId: 'main', sessionKey: key, sessionId,
      storePath: path.join(root, 'agents/main/sessions/sessions.json'), env: process.env }, { sessionId, updatedAt: Date.now() });
    return { key, runId, sessionId };
  }
  async function observe(key) {
    const injectionTarget = registry.resolveCurrentMessageInjectionTarget(key)?.runId ?? null;
    let nativeReply, pluginReply;
    await runtime.describe({ ...options, params: { key }, respond: (...args) => { nativeReply = args; } });
    await reader({ ...options, params: { sessionKey: key }, respond: (...args) => { pluginReply = args; } });
    assert.equal(nativeReply[0], true, JSON.stringify(nativeReply[2]));
    assert.equal(pluginReply[0], true, JSON.stringify(pluginReply[2]));
    const { hasActiveRun, status, activeRunId, attachedRunId } = pluginReply[1].session;
    const plugin = Object.fromEntries(Object.entries({ hasActiveRun, status, activeRunId, attachedRunId }).filter(([, value]) => value !== undefined));
    return { injectionTarget, native: { hasActiveRun: nativeReply[1].session.hasActiveRun, status: nativeReply[1].session.status }, plugin };
  }
  async function embedded(name, flags) {
    const { key, runId, sessionId } = session(name);
    const operationalRunInstance = { instanceId: `${name}-instance`, runId };
    const authority = contexts.claimAgentRunDelegatedAuthority(operationalRunInstance, () => {});
    contexts.claimAgentRunContext(runId, { sessionKey: key, sessionId, agentId: 'main', ...flags });
    // A direct embedded run is always a native injection target. Availability
    // is checked at queue time, so the non-steerable owner is a reply operation.
    const handle = { runId, isAborted: () => false, isStopped: () => false, isStreaming: () => true, abort: refuse('abort'),
      messageInjectionV2: { version: 2, isAvailable: () => true, queueMessageAsync: refuse('inject') } };
    withGatewayToolCallerIdentity({ agentId: 'main', sessionKey: key, operationalRunInstance,
      embeddedRunToolAuthorityBinding: () => ({ source: 'attempt', assertActive() {} }) },
    () => setActiveEmbeddedRun(sessionId, handle, key, undefined, 'main'));
    try { return await observe(key); } finally {
      clearActiveEmbeddedRun(sessionId, handle);
      contexts.releaseAgentRunDelegatedAuthority(authority);
      contexts.clearAgentRunContext(runId);
    }
  }
  async function attached(name, flags, { injectable = false, chat } = {}) {
    const { key, runId, sessionId } = session(name);
    contexts.claimAgentRunContext(runId, { sessionKey: key, sessionId, agentId: 'main', ...flags });
    if (chat) context.chatAbortControllers.set(runId, { sessionKey: key, sessionId, agentId: 'main', ...chat });
    const operation = registry.begin({ sessionKey: key, sessionId });
    operation.setPhase('running');
    operation.attachBackend({ kind: 'embedded', runId, cancel: refuse('cancel'),
      messageInjection: { isAvailable: () => injectable, queueMessage: refuse('inject') } });
    try { return await observe(key); } finally {
      operation.complete();
      context.chatAbortControllers.delete(runId);
      contexts.clearAgentRunContext(runId);
    }
  }
  const cases = {};
  try {
    cases['private-completion'] = await embedded('private-completion', PRIVATE);
    cases.coordination = await embedded('coordination', COORDINATION);
    cases['visible-active'] = await embedded('visible-active', {});
    cases['visible-not-injectable'] = await attached('visible-not-injectable', {});
    cases['hidden-attached'] = await attached('hidden-attached', PRIVATE);
    cases['hidden-chat-run'] = await attached('hidden-chat-run', {}, { injectable: true, chat: { controlUiVisible: false, projectSessionActive: false } });
    cases['visible-chat-run'] = await attached('visible-chat-run', {}, { injectable: true, chat: {} });
  } finally { projection.dispose(); }
  console.log(JSON.stringify({ privateCompletionHiddenByNative, coordinationHiddenByNative: true, cases }));
  process.exit(0);
}
