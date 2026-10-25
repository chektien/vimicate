import assert from 'node:assert/strict';
import test from 'node:test';
import { createSqliteHistoryAuthority } from './sqlite-history-authority.mjs';
import { archiveRecordsDigest } from './session-archive-verification.mjs';

const key = 'agent:main:fixture';
const id = '00000000-0000-4000-a000-000000000127';
const events = [{ type: 'session', id }, { type: 'message', id: 'one', message: { role: 'assistant', content: 'body' } }];
const archive = { sessionId: id, records: 2, importedBytes: JSON.stringify(events).length, importedDigest: archiveRecordsDigest(events) };
function fixture(overrides = {}) {
  const calls = [];
  const native = {
    current: scope => { calls.push(scope); return { sessionId: id, sessionStartedAt: 100, lifecycleRevision: 'life', privateField: 'omit' }; },
    owner: () => key,
    stats: () => ({ eventCount: 2, maxSeq: 1, sizeBytes: JSON.stringify(events).length }),
    revision: () => ({ generation: 'rewrite-1', maxSeq: 1 }),
    events: () => events.map((event, seq) => ({ seq, event })),
    ...overrides,
  };
  return { owner: createSqliteHistoryAuthority({ stateDir: '/stage/state', env: {}, native }), calls };
}
test('reads only explicit SQLite scope with readOnly and verifies imported content digest', async () => {
  const { owner, calls } = fixture();
  assert.deepEqual(owner.readCurrent(key), { sessionId: id, sessionStartedAtMs: 100, lifecycleRevision: 'life' });
  assert.equal(calls[0].readOnly, true);
  assert.equal(calls[0].storePath, '/stage/state/agents/main/sessions/sessions.json');
  const stamp = await owner.verifyArchive({ stableSessionKey: key, archive });
  assert.match(stamp, /^[0-9a-f]{64}$/);
  assert.equal(stamp, owner.readArchiveRevision({ stableSessionKey: key, sessionId: id }));
});
test('rejects unchanged-size corruption, missing records, foreign scope and oversize before materializing', async () => {
  const corrupt = structuredClone(events); corrupt[1].message.content = 'evil';
  for (const native of [{ events: () => corrupt.map((event, seq) => ({ seq, event })) },
    { events: () => [] }, { owner: () => 'agent:main:foreign' },
    { stats: () => ({ eventCount: 999999, maxSeq: 999999, sizeBytes: 1 }), events: () => { assert.fail('must not read'); } },
    { stats: () => ({ eventCount: 2, maxSeq: 2, sizeBytes: 33554433 }), events: () => { assert.fail('must not read'); } }]) {
    await assert.rejects(fixture(native).owner.verifyArchive({ stableSessionKey: key, archive }));
  }
});
test('checks watermark after verification and never accepts a rewritten import', async () => {
  let read = 0;
  await assert.rejects(fixture({ revision: () => ({ generation: `rewrite-${++read}`, maxSeq: 1 }) })
    .owner.verifyArchive({ stableSessionKey: key, archive }), /changed during verification/);
});
test('official legacy import may lack lifecycleRevision until its first native mutation', () => {
  const { owner } = fixture({ current: () => ({ sessionId: id, sessionStartedAt: 100 }) });
  assert.deepEqual(owner.readCurrent(key), { sessionId: id, sessionStartedAtMs: 100, lifecycleRevision: null });
});
test('configured current census is read-only, bounded and scoped, including root projects', () => {
  const { owner } = fixture({ list: scope => {
    assert.equal(scope.readOnly, true); assert.equal(scope.agentId, 'main'); return [{ sessionKey: key, entry: { sessionId: id, sessionStartedAt: 100 } }];
  } });
  assert.deepEqual(owner.readCurrentGenerations(['main']), { [key]: owner.readCurrent(key) });
  assert.throws(() => owner.readCurrentGenerations(['../main']), /invalid configured/);
  assert.throws(() => fixture({ list: () => [{ sessionKey: 'agent:other:foreign' }] }).owner.readCurrentGenerations(['main']), /scope/);
  assert.throws(() => fixture({ list: () => Array(4097).fill({ sessionKey: key }) }).owner.readCurrentGenerations(['main']), /bound/);
  assert.deepEqual(fixture({ list: () => [{ sessionKey: key, entry: { updatedAt: 100 } }] }).owner.readCurrentGenerations(['main']), {});
  assert.deepEqual(fixture({ list: () => [{ sessionKey: key,
    entry: { sessionId: 'old-explicit-smoke-test', sessionStartedAt: 100 } }] }).owner.readCurrentGenerations(['main']), {});
});
test('rejects absent scope, escaped agents, cancellation and missing lifecycle metadata', async () => {
  const { owner } = fixture();
  for (const bad of [undefined, 'agent:../main:fixture', 'agent:main:fixture\n', 'agent:main:' ]) {
    assert.throws(() => owner.readCurrent(bad));
  }
  assert.throws(() => fixture({ current: () => ({ sessionId: id, updatedAt: 100 }) }).owner.readCurrent(key));
  assert.throws(() => fixture({ owner: () => 'agent:main:other' }).owner.readCurrent(key), /another route/);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(owner.verifyArchive({ stableSessionKey: key, archive, signal: controller.signal }));
});
