import assert from 'node:assert/strict';
import test from 'node:test';
import { createSqliteHistoryFamily, SQLITE_FAMILY_CONTRACT, SQLITE_FAMILY_PROOF } from './sqlite-history-family.mjs';

const key = 'agent:main:direct:fixture';
const old = '00000000-0000-4000-a000-000000000127';
const currentId = '00000000-0000-4000-b000-000000000132';
const digest = 'a'.repeat(64);
const manifest = { contract: 'sqlite-import-manifest-v1', sourceLedgerDigest: digest, families: {
  [key]: { anchorSessionId: currentId, archives: [{ sessionId: old, sourceRevision: digest,
    importedDigest: 'b'.repeat(64), importedBytes: 400, records: 4 }] },
} };
function fixture(options = {}) {
  let current = { sessionId: currentId, sessionStartedAtMs: 100, lifecycleRevision: 'lifecycle-1' };
  let revision = 'c'.repeat(64);
  const seen = [];
  const authority = {
    readCurrent: () => current,
    verifyArchive: async ({ archive }) => { seen.push(['verify', archive.sessionId]); return revision; },
    readArchiveRevision: () => revision,
    ...options.authority,
  };
  const reader = { readPage: async request => { seen.push(['page', request]); return {
    sessionKey: key, sessionId: old, offset: request.offset, totalMessages: 4,
    messages: [{ role: 'assistant', content: 'fixture' }], hasMore: false,
  }; }, ...options.reader };
  const family = createSqliteHistoryFamily({ manifest: options.manifest ?? manifest,
    secret: Buffer.alloc(32, 1), authority, reader });
  const params = { contract: SQLITE_FAMILY_CONTRACT, stableSessionKey: key,
    expectedCurrentSessionId: currentId, expectedCurrentSessionStartedAtMs: 100,
    mode: 'segments', cursor: 0, limit: 128 };
  return { family, params, seen, setCurrent: value => { current = value; },
    setRevision: value => { revision = value; } };
}
async function pageRequest(f) {
  const census = await f.family.request(f.params);
  const segment = census.segments[0];
  return { ...f.params, mode: 'page', offset: 0, limit: 16,
    familyToken: census.familyToken, sessionId: old, segmentOrder: 0,
    sourceRevision: segment.sourceRevision };
}

test('must finish verified startup before exposing the new authority contract', async () => {
  const f = fixture();
  await assert.rejects(f.family.request(f.params), /not ready/);
  await f.family.start();
  const census = await f.family.request(f.params);
  assert.equal(census.contract, 'sqlite-family-v1');
  assert.equal(census.proof, SQLITE_FAMILY_PROOF);
  assert.deepEqual(census.segments.map(s => [s.sessionId, s.state]), [[old, 'archived'], [currentId, 'current']]);
  assert.equal(census.segments[0].transcriptFilename, undefined);
  assert.equal(census.segments[0].importedDigest, undefined);
  const page = await f.family.request(await pageRequest(f));
  assert.equal(page.messages[0].content, 'fixture');
  assert.equal(f.seen.filter(v => v[0] === 'verify').length, 1);
});

test('same-ID reset preserves archives, rejects the stale epoch and issues a new token', async () => {
  const f = fixture(); await f.family.start();
  const oldPage = await pageRequest(f);
  f.setCurrent({ sessionId: currentId, sessionStartedAtMs: 200, lifecycleRevision: 'lifecycle-2' });
  await assert.rejects(f.family.request(oldPage), /current session generation changed/);
  const next = { ...f.params, expectedCurrentSessionStartedAtMs: 200 };
  const census = await f.family.request(next);
  assert.notEqual(census.familyToken, oldPage.familyToken);
  assert.equal(census.segments.length, 2);
  await assert.rejects(f.family.request({ ...oldPage, ...next, mode: 'page' }), /family token is stale/);
});

test('a lifecycle change with the same timestamp also invalidates old tokens', async () => {
  const f = fixture(); await f.family.start(); const page = await pageRequest(f);
  f.setCurrent({ sessionId: currentId, sessionStartedAtMs: 100, lifecycleRevision: 'lifecycle-2' });
  await assert.rejects(f.family.request(page), /family token is stale/);
});
test('imported absent lifecycle revision is explicit and cannot mask its first native reset', async () => {
  const f = fixture();
  f.setCurrent({ sessionId: currentId, sessionStartedAtMs: 100, lifecycleRevision: null });
  await f.family.start(); const page = await pageRequest(f);
  f.setCurrent({ sessionId: currentId, sessionStartedAtMs: 100, lifecycleRevision: 'first-native' });
  await assert.rejects(f.family.request(page), /family token is stale/);
});

test('never adopts unknown, retired or rebound concrete session routes', async () => {
  const f = fixture(); await f.family.start();
  await assert.rejects(f.family.request({ ...f.params, stableSessionKey: 'agent:main:other' }), /not in the verified import/);
  f.setCurrent(null);
  await assert.rejects(f.family.request(f.params), /current session generation changed/);
  f.setCurrent({ sessionId: old, sessionStartedAtMs: 200, lifecycleRevision: 'new' });
  await assert.rejects(f.family.request({ ...f.params, expectedCurrentSessionId: old, expectedCurrentSessionStartedAtMs: 200 }), /anchor changed/);
});

test('native continuity includes disjoint windows but not a copied branch predecessor', async () => {
  const nextId = '00000000-0000-4000-b000-000000000133';
  for (const prior of [[], [currentId]]) {
    const f = fixture({ authority: { readNativeSegments: ({ anchorSessionId, sessionId }) => {
      assert.equal(anchorSessionId, currentId); assert.equal(sessionId, nextId); return prior;
    } } });
    await f.family.start();
    f.setCurrent({ sessionId: nextId, sessionStartedAtMs: 200, lifecycleRevision: 'new' });
    const result = await f.family.request({ ...f.params, expectedCurrentSessionId: nextId, expectedCurrentSessionStartedAtMs: 200 });
    assert.deepEqual(result.segments.map(s => s.sessionId), [old, ...prior, nextId]);
  }
});
test('new native routes with explicit database ownership need no legacy import manifest entry', async () => {
  const f = fixture({ authority: { readNativeSegments: ({ anchorSessionId }) => {
    assert.equal(anchorSessionId, undefined); return [];
  } } });
  await f.family.start();
  const result = await f.family.request({ ...f.params, stableSessionKey: 'agent:main:new' });
  assert.deepEqual(result.segments.map(s => s.sessionId), [currentId]);
});

test('a fresh host needs no fabricated legacy family and still requires native ownership', async () => {
  const empty = { contract: 'sqlite-import-manifest-v1', sourceLedgerDigest: digest, families: {} };
  const f = fixture({ manifest: empty, authority: { readNativeSegments: ({ anchorSessionId }) => {
    assert.equal(anchorSessionId, undefined); return [];
  } } });
  await f.family.start();
  assert.equal(f.family.isReady(), true);
  const result = await f.family.request(f.params);
  assert.deepEqual(result.segments.map(s => s.sessionId), [currentId]);
  assert.deepEqual(f.seen, []);
  f.setCurrent(null);
  await assert.rejects(f.family.request(f.params), /unavailable/);
  f.family.dispose();

  const missingNativeOwnership = fixture({ manifest: empty });
  await missingNativeOwnership.family.start();
  await assert.rejects(missingNativeOwnership.family.request(missingNativeOwnership.params), /not in the verified import/);
  missingNativeOwnership.family.dispose();
});

test('archive revision loss, mutation, foreign page and bad raw cursors fail closed', async () => {
  const f = fixture(); await f.family.start(); const page = await pageRequest(f);
  f.setRevision('d'.repeat(64));
  await assert.rejects(f.family.request(page), /verified archive changed/);
  assert.equal(f.family.isReady(), false);
  for (const bad of [{ sessionId: currentId }, { sessionKey: 'agent:main:other' },
    { offset: 9 }, { hasMore: true, nextOffset: 0 }, { totalMessages: 40_000 },
    { messages: [{ content: 'x'.repeat(524288) }] }]) {
    const g = fixture({ reader: { readPage: async () => ({ sessionKey: key, sessionId: old,
      offset: 0, totalMessages: 4, messages: [], hasMore: false, ...bad }) } });
    await g.family.start();
    await assert.rejects(g.family.request(await pageRequest(g)), /invalid native page/);
  }
});
test('detects a concurrent external reset before returning a census', async () => {
  let reads = 0;
  const f = fixture({ authority: { readCurrent: () => ({ sessionId: currentId,
    sessionStartedAtMs: ++reads < 4 ? 100 : 200, lifecycleRevision: 'life' }) } });
  await f.family.start();
  await assert.rejects(f.family.request(f.params), /changed during census/);
});

test('reset, cancellation and disposal during projection prevent late publication', async () => {
  for (const action of ['reset', 'abort', 'dispose']) {
    const controller = new AbortController();
    let release;
    const g = fixture({ reader: { readPage: () => new Promise(resolve => { release = resolve; }) } });
    await g.family.start();
    const pending = g.family.request(await pageRequest(g), { signal: controller.signal });
    // The family snapshot and native reader are synchronous up to projection.
    if (action === 'reset') g.setCurrent({ sessionId: currentId, sessionStartedAtMs: 200, lifecycleRevision: 'new' });
    if (action === 'abort') controller.abort();
    if (action === 'dispose') g.family.dispose();
    release({ sessionKey: key, sessionId: old, offset: 0, totalMessages: 4, hasMore: false, messages: [] });
    await assert.rejects(pending);
  }
});

test('rejects malformed manifests and fails startup on unverified imports', async () => {
  for (const patch of [{ contract: 'archived-family-v1' }, { sourceLedgerDigest: '' },
    { families: { [key]: { anchorSessionId: currentId, archives: [manifest.families[key].archives[0], manifest.families[key].archives[0]] } } }]) {
    assert.throws(() => fixture({ manifest: { ...manifest, ...patch } }));
  }
  const f = fixture({ authority: { verifyArchive: async () => { throw new Error('import digest mismatch'); } } });
  await assert.rejects(f.family.start(), /digest mismatch/);
  await assert.rejects(f.family.request(f.params), /not ready/);
});
test('caps aggregate verification bytes and allows cancellation between imports', async () => {
  const archives = Array.from({ length: 9 }, (_, i) => ({ ...manifest.families[key].archives[0],
    sessionId: `${String(i + 1).padStart(8, '0')}-ed7c-4f69-a165-f92ef8d1f9fd`, importedBytes: 32 * 1024 * 1024 }));
  assert.throws(() => fixture({ manifest: { ...manifest, families: { [key]: { anchorSessionId: currentId, archives } } } }), /byte bound/);
  const controller = new AbortController();
  const f = fixture({ authority: { verifyArchive: async () => {
    setImmediate(() => controller.abort()); return 'c'.repeat(64);
  } } });
  await assert.rejects(f.family.start({ signal: controller.signal }), /abort/i);
  assert.equal(f.family.isReady(), false);
});

test('rejects forged selectors, tokens, current-window reads and unsafe bounds', async () => {
  const f = fixture(); await f.family.start(); const page = await pageRequest(f);
  for (const patch of [{ contract: 'archived-family-v1' }, { offset: -1 }, { limit: 129 },
    { familyToken: 'x'.repeat(43) }, { sessionId: currentId }, { segmentOrder: 1 }, { sourceRevision: digest }]) {
    await assert.rejects(f.family.request({ ...page, ...patch }));
  }
  assert.equal(f.seen.filter(v => v[0] === 'page').length, 0);
});
