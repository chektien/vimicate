import assert from "node:assert/strict";
import test from "node:test";

import {
  VIMICATE_SHARED_NARRATION_CONTRACT,
  createVimicateNarrationRecordContract
} from "./vimicate-narration-record-contract.mjs";

const stableSessionKey =
  "agent:main:direct:vimicate-ios";
const sessionId = "11111111-1111-4111-8111-111111111111";

function fixture(limits) {
  let state = {
    schemaVersion: 1,
    contract: VIMICATE_SHARED_NARRATION_CONTRACT,
    segments: []
  };
  let commits = 0;
  const contract = createVimicateNarrationRecordContract({
    readState: async () => structuredClone(state),
    commitState: async (next) => {
      state = structuredClone(next);
      commits += 1;
    },
    limits
  });
  return {
    contract,
    get state() { return structuredClone(state); },
    get commits() { return commits; }
  };
}

function preamble({
  runId = "run-a",
  itemId = "item-a",
  seq = 7,
  ts = 1_000,
  text = "I am checking the transcript.",
  key = stableSessionKey,
  concreteSessionId = sessionId,
  kind = "preamble",
  source = "codex-app-server"
} = {}) {
  return {
    runId,
    seq,
    ts,
    stream: "item",
    sessionKey: key,
    sessionId: concreteSessionId,
    data: {
      itemId,
      kind,
      source,
      phase: "update",
      progressText: text
    }
  };
}

function pageParams(overrides = {}) {
  return {
    contract: VIMICATE_SHARED_NARRATION_CONTRACT,
    stableSessionKey,
    sessionId,
    cursor: 0,
    limit: 128,
    ...overrides
  };
}

test("explicit Codex preamble is retained with stable identity and source order", async () => {
  const harness = fixture();
  assert.equal(await harness.contract.record(preamble()), "inserted");
  const page = await harness.contract.request(pageParams());
  assert.equal(page.contract, VIMICATE_SHARED_NARRATION_CONTRACT);
  assert.equal(page.stableSessionKey, stableSessionKey);
  assert.equal(page.sessionId, sessionId);
  assert.equal(page.totalRecords, 1);
  assert.equal(page.hasMore, false);
  assert.match(page.snapshotToken, /^[A-Za-z0-9_-]{43}$/);
  assert.deepEqual(page.records, [{
    runId: "run-a",
    itemId: "item-a",
    text: "I am checking the transcript.",
    firstSequence: 7,
    lastSequence: 7,
    firstTimestampMs: 1_000,
    lastTimestampMs: 1_000,
    revision: 1
  }]);
});

test("cumulative updates replace in place, equal frames do not write, rewrites reject", async () => {
  const harness = fixture();
  assert.equal(await harness.contract.record(preamble({ text: "Checking" })), "inserted");
  assert.equal(
    await harness.contract.record(preamble({ seq: 8, ts: 1_100, text: "Checking history" })),
    "replaced"
  );
  assert.equal(
    await harness.contract.record(preamble({ seq: 9, ts: 1_200, text: "Checking history" })),
    "unchanged"
  );
  assert.equal(
    await harness.contract.record(preamble({ seq: 10, ts: 1_300, text: "Different rewrite" })),
    "rejected"
  );
  assert.equal(harness.commits, 2);
  const page = await harness.contract.request(pageParams());
  assert.deepEqual(page.records, [{
    runId: "run-a",
    itemId: "item-a",
    text: "Checking history",
    firstSequence: 7,
    lastSequence: 8,
    firstTimestampMs: 1_000,
    lastTimestampMs: 1_100,
    revision: 2
  }]);
});

test("tools, reasoning, unknown items, missing authority, and wrong sources are ignored", async () => {
  const harness = fixture();
  const missingSessionId = preamble();
  delete missingSessionId.sessionId;
  const missingSessionKey = preamble();
  delete missingSessionKey.sessionKey;
  const candidates = [
    { ...preamble(), stream: "tool" },
    preamble({ kind: "function_call" }),
    preamble({ kind: "reasoning" }),
    preamble({ kind: "unknown" }),
    preamble({ source: "other-runtime" }),
    missingSessionId,
    missingSessionKey,
    {
      ...preamble(),
      data: { ...preamble().data, progressText: "   " }
    }
  ];
  for (const candidate of candidates) {
    assert.equal(await harness.contract.record(candidate), "ignored");
  }
  assert.equal(harness.commits, 0);
  assert.equal((await harness.contract.request(pageParams())).totalRecords, 0);
});

test("same text with distinct item or run identities remains distinct and ordered", async () => {
  const harness = fixture();
  await harness.contract.record(preamble({ text: "same", seq: 4 }));
  await harness.contract.record(preamble({ text: "same", itemId: "item-b", seq: 5 }));
  await harness.contract.record(preamble({ text: "same", runId: "run-b", seq: 6 }));
  const page = await harness.contract.request(pageParams());
  assert.deepEqual(
    page.records.map(({ runId, itemId, firstSequence }) => ({
      runId,
      itemId,
      firstSequence
    })),
    [
      { runId: "run-a", itemId: "item-a", firstSequence: 4 },
      { runId: "run-a", itemId: "item-b", firstSequence: 5 },
      { runId: "run-b", itemId: "item-a", firstSequence: 6 }
    ]
  );
});

test("paging binds an immutable snapshot token through ongoing record writes", async () => {
  const harness = fixture();
  await harness.contract.record(preamble({ itemId: "item-a", seq: 1 }));
  await harness.contract.record(preamble({ itemId: "item-b", seq: 2 }));
  const first = await harness.contract.request(pageParams({ limit: 1 }));
  assert.equal(first.hasMore, true);
  assert.equal(first.nextCursor, 1);
  await harness.contract.record(preamble({ itemId: "item-c", seq: 3 }));
  const continued = await harness.contract.request(pageParams({
      cursor: first.nextCursor,
      limit: 1,
      snapshotToken: first.snapshotToken
    }));
  assert.equal(continued.totalRecords, 2);
  assert.equal(continued.records[0].itemId, "item-b");
  assert.equal((await harness.contract.request(pageParams())).totalRecords, 3);
});

test("concrete session generations remain separate and segment bounds evict oldest", async () => {
  const secondSessionId = "22222222-2222-4222-8222-222222222222";
  const harness = fixture({ maximumSegments: 1 });
  await harness.contract.record(preamble({ concreteSessionId: sessionId, ts: 1_000 }));
  await harness.contract.record(preamble({
    concreteSessionId: secondSessionId,
    runId: "run-b",
    ts: 2_000
  }));
  assert.equal((await harness.contract.request(pageParams())).totalRecords, 0);
  assert.equal((await harness.contract.request(pageParams({
    sessionId: secondSessionId
  }))).totalRecords, 1);
});

test("per-segment record bound preserves the newest stable rows", async () => {
  const harness = fixture({ maximumRecordsPerSegment: 2 });
  await harness.contract.record(preamble({ itemId: "old", seq: 1, ts: 1_000 }));
  await harness.contract.record(preamble({ itemId: "middle", seq: 2, ts: 2_000 }));
  await harness.contract.record(preamble({ itemId: "new", seq: 3, ts: 3_000 }));
  const page = await harness.contract.request(pageParams());
  assert.deepEqual(page.records.map((record) => record.itemId), ["middle", "new"]);
});
