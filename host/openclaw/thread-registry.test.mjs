import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createThreadRegistry, updateThreadRegistryWhenReady } from './thread-registry.mjs';
const key = 'agent:main:dashboard:thread';
const id = '00000000-0000-4000-a000-000000000127';
const entry = { threadID: key, parentProjectID: 'notes', label: 'fixture', state: 'active', order: 1,
  currentBinding: { backend: 'openclaw', stableSessionKey: key, state: 'current', sessionID: 'stale' }, bindings: [] };
function fixture(t, entries = [entry], currentOverride) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'vimicate-registry-')));
  t.after(() => fs.rmSync(root, { force: true, recursive: true }));
  fs.writeFileSync(path.join(root, 'projects.md'), '# projects\n');
  fs.writeFileSync(path.join(root, 'threads.json'), JSON.stringify({ version: 1, threads: entries, preserved: 'metadata' }));
  const current = { sessionId: id, sessionStartedAtMs: 1000, lifecycleRevision: 'first' };
  const registry = createThreadRegistry({ vimicateDir: root, readCurrent: currentOverride ?? (route => route === key ? current : null),
    capabilities: () => ({ sessionHistory: 'sqlite-display-v1' }) });
  return { root, registry, current, bytes: () => fs.readFileSync(path.join(root, 'threads.json'), 'utf8'),
    update: (mode, entries) => registry.update({ contract: 'host-current-v1', mode, entries }) };
}
test('registry read projects native current identity without writing or reviving tombstones', t => {
  const f = fixture(t, [entry, { ...entry, threadID: 'removed', state: 'removed' }]);
  const before = f.bytes(), result = f.registry.read();
  const rows = JSON.parse(result.threads.json).threads;
  assert.equal(rows[0].currentBinding.sessionID, id);
  assert.equal(rows[0].currentBinding.sessionStartedAtSeconds, 1);
  assert.equal(rows[1].currentBinding.sessionID, 'stale');
  assert.equal(f.bytes(), before);
  assert.equal(result.capabilities.sessionHistory, 'sqlite-display-v1');
  assert.equal(f.registry.read({ includeThreads: false }).threads, null);
});
test('nonmutating probe and exact reconciliation preserve metadata and same-ID reset epochs', t => {
  const f = fixture(t), before = f.bytes();
  assert.equal(f.update('probe', []).outcome, 'unchanged'); assert.equal(f.bytes(), before);
  assert.equal(f.update('reconcileCurrentSession', [entry]).outcome, 'updated');
  assert.equal(JSON.parse(f.bytes()).preserved, 'metadata');
  assert.equal(f.update('reconcileCurrentSession', [entry]).outcome, 'unchanged');
  f.current.sessionStartedAtMs = 2000;
  f.update('reconcileCurrentSession', [entry]);
  assert.equal(JSON.parse(f.bytes()).threads[0].currentBinding.sessionStartedAtSeconds, 2);
});
test('host current authority wins hostile client timestamps and no binding reassignment is allowed', t => {
  const f = fixture(t);
  f.update('upsert', [{ ...entry, currentBinding: { ...entry.currentBinding, sessionID: 'hostile', sessionStartedAtSeconds: 999999999 } }]);
  assert.equal(JSON.parse(f.bytes()).threads[0].currentBinding.sessionID, id);
  assert.throws(() => f.update('upsert', [{ ...entry, currentBinding: { ...entry.currentBinding, stableSessionKey: 'agent:main:foreign' } }]), /reassign/);
});
test('removed threads need an explicit newer recreation; metadata-only stale clients cannot resurrect them', t => {
  const f = fixture(t);
  f.update('remove', [{ ...entry, removedAtSeconds: 100 }]);
  const before = f.bytes();
  assert.throws(() => f.update('upsert', [entry]), /newer recreation/);
  assert.throws(() => f.update('reconcileCurrentSession', [entry]), /active thread/);
  assert.equal(f.bytes(), before);
  f.update('upsert', [{ ...entry, explicitlyCreatedAtSeconds: 101 }]);
  assert.equal(JSON.parse(f.bytes()).threads[0].state, 'active');
});
test('malformed, oversized and unavailable requests fail without mutation; stop is terminal', t => {
  const f = fixture(t), before = f.bytes();
  for (const request of [{}, { mode: 'probe', entries: [entry] }, { mode: 'upsert', entries: [] },
    { mode: 'upsert', entries: Array(129).fill(entry) }, { mode: 'upsert', entries: [{ ...entry, label: 'x'.repeat(4194304) }] }]) {
    assert.throws(() => f.registry.update({ contract: 'host-current-v1', ...request }));
  }
  assert.equal(f.bytes(), before);
  f.registry.dispose(); assert.throws(() => f.registry.read(), /stopped/); assert.throws(() => f.update('probe', []), /stopped/);
});
test('fixed registry files reject symlinks and do not follow an external target', t => {
  const f = fixture(t);
  fs.renameSync(path.join(f.root, 'threads.json'), path.join(f.root, 'retained.json'));
  fs.symlinkSync('retained.json', path.join(f.root, 'threads.json'));
  assert.throws(() => f.registry.read()); assert.throws(() => f.update('probe', []));
});


test('new-thread publication waits for native epoch without writing partial bindings', async t => {
  let reads = 0;
  const f = fixture(t, [], () => {
    if (++reads < 3) {
      assert.deepEqual(JSON.parse(f.bytes()).threads, []);
      throw new Error('vimicate sqlite history: invalid current lifecycle metadata');
    }
    return f.current;
  });
  const result = await updateThreadRegistryWhenReady(f.registry, { contract: 'host-current-v1', mode: 'upsert', entries: [entry] }, new AbortController().signal);
  assert.equal(result.outcome, 'updated');
  assert.equal(JSON.parse(f.bytes()).threads[0].currentBinding.sessionID, id);
  assert.equal(reads, 3);
});

test('lifecycle readiness is bounded, cancellable and does not retry unrelated failures', async () => {
  let reads = 0;
  const registry = { update() { reads++; throw new Error('vimicate sqlite history: invalid current lifecycle metadata'); } };
  const request = { mode: 'upsert' };
  await assert.rejects(updateThreadRegistryWhenReady(registry, request, new AbortController().signal), /invalid current lifecycle/);
  assert.equal(reads, 6);
  const controller = new AbortController();
  reads = 0;
  const pending = updateThreadRegistryWhenReady(registry, request, controller.signal);
  controller.abort();
  await assert.rejects(pending, { name: 'AbortError' });
  assert.equal(reads, 1);
  reads = 0;
  await assert.rejects(updateThreadRegistryWhenReady({ update() { reads++; throw new Error('concurrent thread registry change'); } }, request, new AbortController().signal), /concurrent/);
  assert.equal(reads, 1);
});
