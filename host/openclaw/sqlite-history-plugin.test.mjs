import assert from 'node:assert/strict';
import test from 'node:test';
import { registerSqliteHistoryPlugin } from './sqlite-history-plugin.mjs';

function fixture(overrides = {}) {
  const methods = new Map(); let service, disposed = 0, started = 0;
  const candidate = { start: async () => { started++; }, dispose: () => { disposed++; },
    request: async () => ({ contract: 'sqlite-family-v1', messages: [] }),
    isReady: () => started > 0 && disposed === 0, ...overrides.candidate };
  const api = { registerGatewayMethod: (name, handler, options) => methods.set(name, { handler, options }),
    registerService: value => { service = value; } };
  const plugin = registerSqliteHistoryPlugin(api, { createFamily: async () => candidate,
    formatError: message => ({ code: 'UNAVAILABLE', message }), ...overrides.dependencies });
  const invoke = async params => {
    const responses = [];
    await methods.get('vimicate.history.family').handler({ params,
      respond: (...args) => responses.push(args) });
    assert.equal(responses.length, 1); return responses[0];
  };
  return { plugin, service, methods, invoke, disposed: () => disposed, started: () => started };
}
test('publishes only operator.read after startup and removes capabilities on stop', async () => {
  const f = fixture();
  assert.deepEqual(f.methods.get('vimicate.history.family').options, { scope: 'operator.read' });
  assert.deepEqual(f.plugin.capabilities(), {});
  assert.equal((await f.invoke({}))[0], false);
  await f.service.start();
  assert.deepEqual(f.plugin.capabilities(), { archivedSessionFamily: 'sqlite-family-v1', sessionHistory: 'sqlite-display-v1' });
  assert.equal((await f.invoke({}))[0], true);
  await f.service.stop();
  assert.deepEqual(f.plugin.capabilities(), {});
  assert.equal((await f.invoke({}))[0], false);
  assert.equal(f.disposed(), 1);
});
test('late activation after stop is disposed and never published', async () => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const f = fixture({ candidate: { start: () => gate } });
  const starting = f.service.start();
  await Promise.resolve();
  await f.service.stop(); release(); await starting;
  assert.deepEqual(f.plugin.capabilities(), {});
  assert.equal(f.disposed(), 1);
});
test('verification failure cannot advertise native reset compatibility', async () => {
  const f = fixture({ candidate: { start: async () => { throw new Error('invalid import'); } } });
  await f.service.start();
  assert.deepEqual(f.plugin.capabilities(), {});
  assert.match(f.plugin.failure().message, /invalid import/);
  assert.equal(f.disposed(), 1);
});
test('stop does not wait for a stuck factory, and owns its late disposal', async () => {
  let release, disposed = 0;
  const gate = new Promise(resolve => { release = resolve; });
  const f = fixture({ dependencies: { createFamily: () => gate } });
  const starting = f.service.start();
  await f.service.stop(); await starting;
  release({ dispose() { disposed++; } });
  await Promise.resolve(); await Promise.resolve();
  assert.equal(disposed, 1);
  assert.deepEqual(f.plugin.capabilities(), {});
});
test('stop aborts a stuck request promptly, with no second late success', async () => {
  let release;
  const f = fixture({ candidate: { request: () => new Promise(resolve => { release = resolve; }) } });
  await f.service.start();
  const pending = f.invoke({});
  await f.service.stop();
  assert.equal((await pending)[0], false);
  release({ messages: ['late'] }); await Promise.resolve();
  assert.deepEqual(f.plugin.capabilities(), {});
});
test('bounds concurrent RPC work and releases slots on cancellation', async () => {
  const f = fixture({ candidate: { request: () => new Promise(() => {}) } });
  await f.service.start();
  const one = f.invoke({}), two = f.invoke({});
  assert.match((await f.invoke({}))[2].message, /busy/);
  await f.service.stop();
  assert.equal((await one)[0], false); assert.equal((await two)[0], false);
});
