import assert from 'node:assert/strict';
import test from 'node:test';
import { createVimicateNarrationRecordContract } from './vimicate-narration-record-contract.mjs';

const key = 'agent:main:direct:synthetic-views';
const sessionId = '11111111-1111-4111-8111-111111111111';
const secondId = '22222222-2222-4222-8222-222222222222';
const params = overrides => ({ contract: 'shared-narration-v1', stableSessionKey: key, sessionId, ...overrides });
const event = (index, text = 'checking', overrides = {}) => ({
  stream: 'item', sessionKey: key, sessionId, runId: 'r', seq: index + 1, ts: 1000 + index,
  data: { kind: 'preamble', source: 'codex-app-server', phase: 'update', itemId: `pre-${index}`, progressText: text },
  ...overrides,
});
function fixture(options = {}) {
  let state; let clock = 0; let unavailable = false; let reads = 0;
  const contract = createVimicateNarrationRecordContract({
    readState: async () => { reads += 1; if (unavailable) throw new Error('authority unavailable'); return structuredClone(state); },
    commitState: async next => { state = structuredClone(next); },
    snapshotNow: () => clock, ...options,
  });
  return { contract, advance: milliseconds => { clock += milliseconds; },
    unavailable: value => { unavailable = value; }, corrupt: value => { state = value; },
    get reads() { return reads; } };
}

test('a 257-record reader finishes its original immutable view despite a write before every continuation', async () => {
  const { contract } = fixture();
  for (let index = 0; index < 257; index += 1) await contract.record(event(index));
  const first = await contract.request(params({ limit: 128 }));
  const received = [...first.records];
  let page = first;
  let growth = 'checking';
  while (page.hasMore) {
    growth += ' more';
    await contract.record(event(0, growth, { seq: 300 + received.length, ts: 2000 + received.length }));
    page = await contract.request(params({ cursor: page.nextCursor, limit: 128, snapshotToken: first.snapshotToken }));
    assert.equal(page.snapshotToken, first.snapshotToken);
    received.push(...page.records);
  }
  assert.equal(received.length, 257);
  assert.ok(received.every(row => row.text === 'checking'));
  const fresh = await contract.request(params({ limit: 128 }));
  assert.equal(fresh.records[0].text, growth);
  assert.notEqual(fresh.snapshotToken, first.snapshotToken);
});

test('the view expires at its fixed deadline even if recently accessed, allowing a fresh first page', async () => {
  const harness = fixture({ snapshotLimits: { lifetimeMs: 10 } });
  await harness.contract.record(event(0));
  const first = await harness.contract.request(params());
  harness.advance(9);
  await harness.contract.request(params({ snapshotToken: first.snapshotToken }));
  harness.advance(1);
  await assert.rejects(harness.contract.request(params({ snapshotToken: first.snapshotToken })), /snapshot changed/);
  assert.equal((await harness.contract.request(params())).records.length, 1);
});

test('bounded view count evicts the oldest snapshot without cross-session replay', async () => {
  const { contract } = fixture({ snapshotLimits: { maximumViews: 2 } });
  await contract.record(event(0));
  const first = await contract.request(params());
  const second = await contract.request(params());
  const third = await contract.request(params());
  await assert.rejects(contract.request(params({ snapshotToken: first.snapshotToken })), /snapshot changed/);
  await contract.request(params({ snapshotToken: second.snapshotToken }));
  await contract.request(params({ snapshotToken: third.snapshotToken }));
  await contract.record(event(0, 'another generation', { sessionId: secondId }));
  await assert.rejects(contract.request(params({ sessionId: secondId, snapshotToken: third.snapshotToken })), /snapshot changed/);
  await assert.rejects(contract.request(params({ stableSessionKey: `${key}-other`, snapshotToken: third.snapshotToken })), /snapshot changed/);
});

test('the byte budget evicts snapshots, including scope metadata, not only the count', async () => {
  const { contract } = fixture({ snapshotLimits: { maximumBytes: 1200 } });
  await contract.record(event(0, 'x'.repeat(600)));
  const first = await contract.request(params());
  const second = await contract.request(params());
  await assert.rejects(contract.request(params({ snapshotToken: first.snapshotToken })), /snapshot changed/);
  await contract.request(params({ snapshotToken: second.snapshotToken }));
});

test('cached views never bypass authority or malformed-state checks and are retired after failed validation', async () => {
  const harness = fixture();
  await harness.contract.record(event(0));
  const first = await harness.contract.request(params());
  const reads = harness.reads;
  await harness.contract.request(params({ snapshotToken: first.snapshotToken }));
  assert.equal(harness.reads, reads + 1);
  harness.unavailable(true);
  await assert.rejects(harness.contract.request(params({ snapshotToken: first.snapshotToken })), /authority unavailable/);
  harness.unavailable(false);
  await assert.rejects(harness.contract.request(params({ snapshotToken: first.snapshotToken })), /snapshot changed/);
  const fresh = await harness.contract.request(params());
  harness.corrupt({ schemaVersion: 999 });
  await assert.rejects(harness.contract.request(params({ snapshotToken: fresh.snapshotToken })), /state schema/);
});

test('views are isolated between store/contract instances even when their current contents are identical', async () => {
  const first = fixture().contract; const second = fixture().contract;
  await first.record(event(0)); await second.record(event(0));
  const page = await first.request(params());
  await assert.rejects(second.request(params({ snapshotToken: page.snapshotToken })), /snapshot changed/);
});

test('removed session authority cannot continue a retained view and returned pages cannot mutate it', async () => {
  const harness = fixture();
  await harness.contract.record(event(0));
  const first = await harness.contract.request(params());
  first.records[0].text = 'caller mutation';
  assert.equal((await harness.contract.request(params({ snapshotToken: first.snapshotToken }))).records[0].text, 'checking');
  harness.corrupt({ schemaVersion: 1, contract: 'shared-narration-v1', segments: [] });
  await assert.rejects(harness.contract.request(params({ snapshotToken: first.snapshotToken })), /snapshot changed/);
});

for (const snapshotLimits of [{ maximumViews: 0 }, { maximumViews: 17 },
  { maximumBytes: 32 * 1024 * 1024 + 1 }, { lifetimeMs: 60_001 }]) {
  test(`view policy cannot exceed hard production bounds: ${JSON.stringify(snapshotLimits)}`, () => {
    assert.throws(() => fixture({ snapshotLimits }), /accepted bound/);
  });
}

test('an oversized individual view cannot evict existing snapshots or exceed the budget', async () => {
  const { contract } = fixture({ snapshotLimits: { maximumBytes: 1200 } });
  await contract.record(event(0));
  const first = await contract.request(params());
  await contract.record(event(0, 'checking'.padEnd(2000, 'x'), { seq: 2, ts: 2000 }));
  await assert.rejects(contract.request(params()), /snapshot exceeds its byte bound/);
  assert.equal((await contract.request(params({ snapshotToken: first.snapshotToken }))).records[0].text, 'checking');
});

test('a nonzero cursor without a token cannot silently change its snapshot', async () => {
  const { contract } = fixture(); await contract.record(event(0));
  await assert.rejects(contract.request(params({ cursor: 1 })), /snapshot changed/);
  const first = await contract.request(params());
  await assert.rejects(contract.request(params({ cursor: 2, snapshotToken: first.snapshotToken })), /cursor exceeds/);
});
