import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createSessionRunTruthReader, loadSessionRunTruthRuntime, registerSessionRunTruth } from './session-run-truth.mjs';

function fixture({ session = { key: 'agent:main:one', sessionId: 'generation', hasActiveRun: true, lastRunId: 'terminal' }, denied = false, target = { runId: 'actual' }, runContexts } = {}) {
  const calls = []; const response = [];
  const options = { client: { identity: 'caller' }, context: {}, params: { sessionKey: 'agent:main:one' }, respond: (...args) => response.push(args) };
  const reader = createSessionRunTruthReader({ describe: async opts => {
    assert.equal(opts.client, options.client); assert.equal(opts.context, options.context);
    assert.deepEqual(opts.params, { key: options.params.sessionKey });
    opts.respond(!denied, denied ? undefined : { session }, denied ? { code: 'FORBIDDEN' } : undefined);
  }, registry: { resolveCurrentMessageInjectionTarget(key) { calls.push(key); return target; } }, runContexts });
  return { reader, options, calls, response };
}

test('scoped native visibility precedes read of exact live steering owner', async () => {
  const f = fixture(); await f.reader(f.options);
  assert.deepEqual(f.calls, ['agent:main:one']);
  assert.deepEqual(f.response, [[true, { session: { key: 'agent:main:one', sessionId: 'generation', hasActiveRun: true, activeRunId: 'actual', status: 'running' } }]]);
});
test('denied and hidden sessions never consult runtime identity', async () => {
  for (const config of [{ denied: true }, { session: null }]) {
    const f = fixture(config); await f.reader(f.options); assert.equal(f.calls.length, 0);
    assert.equal(f.response[0][0], !config.denied);
  }
});
test('canonical alias mismatch, malformed and extra fields fail closed', async () => {
  const f = fixture({ session: { key: 'agent:main:canonical' } }); await f.reader(f.options);
  assert.equal(f.response[0][0], false); assert.equal(f.calls.length, 0);
  for (const params of [{ sessionKey: 'main' }, { sessionKey: 'agent:main:one', agentId: 'other' }]) {
    const g = fixture(); g.options.params = params; await g.reader(g.options); assert.equal(g.calls.length, 0); assert.equal(g.response[0][0], false);
  }
});
test('no target means identity unavailable, not idle or terminal fallback', async () => {
  const f = fixture({ target: null }); await f.reader(f.options);
  assert.equal(f.response[0][1].session.hasActiveRun, true);
  assert.equal(f.response[0][1].session.activeRunId, undefined);
  assert.equal(f.response[0][1].session.lastRunId, undefined);
});
test('retired caller does not consult runtime owner', async () => {
  const f = fixture(); f.options.hasCurrentClientAuthority = () => false;
  await assert.rejects(f.reader(f.options), /authority retired/); assert.equal(f.calls.length, 0);
});
test('unsupported or modified runtime fails before private import', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vimicate-run-truth-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.writeFile(path.join(root, 'package.json'), JSON.stringify({ name: 'openclaw', version: '2026.10.3' }));
  await assert.rejects(loadSessionRunTruthRuntime(root), /audited Gateway runtime/);
  await fs.writeFile(path.join(root, 'package.json'), JSON.stringify({ name: 'openclaw', version: '2026.10.4' }));
  await fs.mkdir(path.join(root, 'dist')); await fs.writeFile(path.join(root, 'dist/sessions-read-DziXtPpO.mjs'), 'throw new Error("must not import");');
  await assert.rejects(loadSessionRunTruthRuntime(root), /integrity mismatch/);
  await fs.writeFile(path.join(root, 'package.json'), JSON.stringify({ name: 'openclaw', version: '2026.10.5' }));
  await fs.writeFile(path.join(root, 'dist/sessions-read-DNOkgOd5.mjs'), 'throw new Error("must not import");');
  await assert.rejects(loadSessionRunTruthRuntime(root), /integrity mismatch/);
  await fs.writeFile(path.join(root, 'package.json'), JSON.stringify({ name: 'openclaw', version: '2026.10.6' }));
  await fs.writeFile(path.join(root, 'dist/sessions-read-CLHMalI8.mjs'), 'throw new Error("must not import");');
  await assert.rejects(loadSessionRunTruthRuntime(root), /integrity mismatch/);
});
test('registers one read-only method and returns unavailable on unsupported host', async () => {
  let handler;
  registerSessionRunTruth({ registerGatewayMethod(name, fn, options) { assert.equal(name, 'vimicate.runs.read'); assert.equal(options.scope, 'operator.read'); handler = fn; } }, { packageRoot: '/absent' });
  let reply; await handler({ respond: (...args) => { reply = args; } }); assert.equal(reply[0], false); assert.equal(reply[2].code, 'UNAVAILABLE');
});

const cronContext = (patch = {}) => ({ sessionKey: 'agent:main:one', sessionId: 'generation', cronRunsByJobId: new Map([['job', { pacingEnabled: true }]]), ...patch });
function contexts(context, live = true) {
  const reads = [];
  return { reads, getAgentRunContext(runId) { reads.push(runId); return context; }, hasLiveAgentRunContext(runId) { reads.push(`live:${runId}`); return live; } };
}
test('reports scheduled origin only for the exact live cron-claimed steering target', async () => {
  const runContexts = contexts(cronContext());
  const f = fixture({ runContexts }); await f.reader(f.options);
  assert.deepEqual(f.response, [[true, { session: { key: 'agent:main:one', sessionId: 'generation', hasActiveRun: true, activeRunId: 'actual',
    activeRunOrigin: { kind: 'scheduled', runId: 'actual', sessionId: 'generation' }, status: 'running' } }]]);
  assert.deepEqual(runContexts.reads, ['actual', 'live:actual']);
});
test('announcement, agent RPC, stale, foreign and unscoped contexts stay unknown', async () => {
  for (const [context, live, session] of [
    [{ sessionKey: 'agent:main:one', sessionId: 'generation' }, true],
    [cronContext({ cronRunsByJobId: new Map() }), true],
    [cronContext({ cronRunsByJobId: { job: {} } }), true],
    [cronContext(), false],
    [cronContext({ sessionKey: 'agent:main:other' }), true],
    [cronContext({ sessionId: 'previous' }), true],
    [undefined, true],
    [cronContext(), true, { key: 'agent:main:one', hasActiveRun: true }],
  ]) {
    const f = fixture({ runContexts: contexts(context, live), ...(session ? { session } : {}) }); await f.reader(f.options);
    assert.equal(f.response[0][0], true); assert.equal(f.response[0][1].session.activeRunId, 'actual');
    assert.equal(f.response[0][1].session.activeRunOrigin, undefined);
  }
});
test('no steering target, hidden route or missing context reader never reads origin', async () => {
  const runContexts = contexts(cronContext());
  for (const config of [{ target: null, runContexts }, { denied: true, runContexts }, { session: null, runContexts }]) {
    const f = fixture(config); await f.reader(f.options); assert.equal(f.response[0][1]?.session?.activeRunOrigin, undefined);
  }
  assert.deepEqual(runContexts.reads, []);
  const legacy = fixture(); await legacy.reader(legacy.options); assert.equal(legacy.response[0][1].session.activeRunOrigin, undefined);
});
test('pins the installed run-context registry before origin reads', async () => {
  const source = await fs.readFile(new URL('./session-run-truth.mjs', import.meta.url), 'utf8');
  assert.match(source, /'agent-run-registry-BaxMDLZF\.mjs': '[0-9a-f]{64}'/);
});

test('exposes the authorized concrete generation independently of scheduled origin', async () => {
  const f = fixture(); await f.reader(f.options);
  assert.equal(f.response[0][1].session.sessionId, 'generation');
  assert.equal(f.response[0][1].session.activeRunOrigin, undefined);
});
// Native run_not_ready reads resolveCurrentInterruptTarget. The reader exposes
// that attached current owner separately and never as a steering target.
function attachedFixture({ operation = { sessionId: 'generation', result: null, abortSignal: { aborted: false } }, target = { runId: 'attached', isCurrent: () => true }, current = operation } = {}) {
  const f = fixture({ target: null });
  const registry = { resolveCurrentMessageInjectionTarget: () => null, resolveCurrentInterruptTarget: () => target, get: () => current };
  return { ...f, reader: createSessionRunTruthReader({ describe: async opts => opts.respond(true, { session: { key: 'agent:main:one', sessionId: 'generation', hasActiveRun: true } }), registry }) };
}
test('reports an attached current non-injectable run separately from the steering target', async () => {
  const f = attachedFixture(); await f.reader(f.options);
  const session = f.response[0][1].session;
  assert.equal(session.attachedRunId, 'attached');
  assert.equal(session.activeRunId, undefined);
  assert.equal(session.hasActiveRun, true);
  assert.equal(session.sessionId, 'generation');
});
test('unattached, stale, terminal, aborting and changed-generation owners expose no attached run', async () => {
  const live = { sessionId: 'generation', result: null, abortSignal: { aborted: false } };
  for (const variant of [
    { target: null }, { target: { isCurrent: () => true } }, { target: { runId: ' ', isCurrent: () => true } },
    { target: { runId: 'attached', isCurrent: () => false } }, { target: { runId: 'attached' } },
    { current: null },
    { operation: { ...live, result: { kind: 'completed' } } }, { operation: { ...live, abortSignal: { aborted: true } } },
    { operation: { ...live, sessionId: 'previous-generation' } },
  ]) {
    const f = attachedFixture(variant); await f.reader(f.options);
    assert.equal(f.response[0][1].session.attachedRunId, undefined, JSON.stringify(variant));
  }
});
test('a runtime without the interrupt-target read omits attached identity', async () => {
  const f = fixture({ target: null }); await f.reader(f.options);
  assert.equal(f.response[0][1].session.attachedRunId, undefined);
});
