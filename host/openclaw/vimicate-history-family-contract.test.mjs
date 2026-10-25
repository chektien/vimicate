import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";

import {
  VIMICATE_ARCHIVED_FAMILY_CONTRACT,
  VIMICATE_ARCHIVED_FAMILY_PROOF,
  createVimicateHistoryFamilyContract
} from "./vimicate-history-family-contract.mjs";

const stableSessionKey = "agent:main:dashboard:00000000-0000-4000-9000-000000000163";
const ids = [
  "00000000-0000-4000-8000-000000000131",
  "00000000-0000-4000-8000-000000000129",
  "00000000-0000-4000-a000-000000000153",
  "00000000-0000-4000-a000-000000000159",
  "00000000-0000-4000-b000-000000000146"
];
const epochs = [100, 300, 500, 700, 900];
const filenames = [
  `${ids[0]}.jsonl.reset.2026-07-11T02-51-01.729Z`,
  `${ids[1]}.jsonl.reset.2026-07-11T03-50-53.997Z`,
  `${ids[2]}.jsonl.reset.2026-07-18T17-45-44.637Z`,
  `${ids[3]}.jsonl.reset.2026-07-19T00-15-07.465Z`,
  `${ids[4]}.jsonl`
];

function fixtureBytes(index) {
  return Buffer.from(`fixture-${index}`);
}

function fixtureRevision(index) {
  return crypto.createHash("sha256").update(fixtureBytes(index)).digest("hex");
}

function fixtureLedger() {
  return {
    schemaVersion: 1,
    proof: VIMICATE_ARCHIVED_FAMILY_PROOF,
    families: {
      [stableSessionKey]: {
        agentId: "main",
        segments: ids.map((sessionId, index) => ({
          sessionId,
          startedAtMs: epochs[index],
          ...(index === ids.length - 1 ? {} : {
            endedAtMs: epochs[index] + 100,
            endReason: index === 1 ? "daily-rotation" : "reset",
            sourceRevision: fixtureRevision(index)
          }),
          transcriptFilename: filenames[index]
        }))
      }
    }
  };
}

function fixtureHarness(overrides = {}) {
  const files = new Map(filenames.map((filename, index) => [
    filename,
    fixtureBytes(index)
  ]));
  const calls = [];
  const transcriptReads = [];
  let current = {
    sessionId: ids.at(-1),
    startedAtMs: epochs.at(-1),
    transcriptFilename: filenames.at(-1)
  };
  const contract = createVimicateHistoryFamilyContract({
    familySecret: Buffer.alloc(32, 7),
    readLedger: async () => fixtureLedger(),
    resolveCurrentSession: async () => current,
    readTranscriptEvidence: async (_agentId, filename, maximumBytes) => {
      transcriptReads.push(filename);
      const value = files.get(filename);
      if (!value) throw new Error("missing fixture transcript");
      assert.ok(value.byteLength <= maximumBytes);
      return {
        sourceRevision: crypto.createHash("sha256").update(value).digest("hex"),
        byteLength: value.byteLength
      };
    },
    readProjectedHistoryPage: async (request) => {
      calls.push(request);
      return {
        sessionId: request.sessionId,
        sessionKey: request.stableSessionKey,
        transcriptFilename: request.transcriptFilename,
        offset: request.offset,
        nextOffset: request.offset + 2,
        hasMore: true,
        totalMessages: 9,
        messages: [{ role: "assistant", content: "projected" }]
      };
    },
    ...overrides
  });
  return {
    contract,
    files,
    calls,
    transcriptReads,
    setCurrent(value) { current = value; }
  };
}

function baseParams(mode) {
  return {
    contract: VIMICATE_ARCHIVED_FAMILY_CONTRACT,
    mode,
    stableSessionKey,
    expectedCurrentSessionId: ids.at(-1),
    expectedCurrentSessionStartedAtMs: epochs.at(-1)
  };
}

test("census is cursor-complete and includes the audited hidden predecessor", async () => {
  const harness = fixtureHarness();
  const first = await harness.contract({ ...baseParams("segments"), cursor: 0, limit: 3 });
  assert.equal(first.contract, VIMICATE_ARCHIVED_FAMILY_CONTRACT);
  assert.equal(first.proof, VIMICATE_ARCHIVED_FAMILY_PROOF);
  assert.deepEqual(first.segments.map((segment) => segment.sessionId), ids.slice(0, 3));
  assert.equal(first.nextCursor, 3);
  assert.equal(first.totalSegments, 5);
  assert.equal(first.segments[1].endReason, "daily-rotation");
  assert.ok(!JSON.stringify(first).includes("transcriptFilename"));
  assert.deepEqual(harness.transcriptReads, filenames);

  const second = await harness.contract({
    ...baseParams("segments"),
    cursor: 3,
    limit: 3,
    familyToken: first.familyToken
  });
  assert.deepEqual(second.segments.map((segment) => segment.sessionId), ids.slice(3));
  assert.equal(second.hasMore, false);
  assert.equal(second.nextCursor, undefined);
  assert.equal(second.familyToken, first.familyToken);
});

test("handler startup probe audits every family segment and current authority", async () => {
  const harness = fixtureHarness();
  const audit = await harness.contract.probe();
  assert.deepEqual(audit, {
    contract: "archived-family-audit-v1",
    proof: VIMICATE_ARCHIVED_FAMILY_PROOF,
    families: 1,
    segments: 5,
    transcriptBytes: ids.reduce(
      (total, _id, index) => total + fixtureBytes(index).byteLength,
      0
    )
  });
  assert.deepEqual(harness.transcriptReads, filenames);

  harness.files.set(filenames[0], Buffer.from("mutated-retained-source"));
  await assert.rejects(
    harness.contract.probe(),
    /archived segment no longer matches its ledger revision/
  );
});

test("startup probe quarantines one unavailable family without hiding healthy archives", async () => {
  const staleSessionKey = "agent:main:dashboard:deleted-project";
  const ledger = fixtureLedger();
  ledger.families[staleSessionKey] = structuredClone(ledger.families[stableSessionKey]);
  const harness = fixtureHarness({
    readLedger: async () => ledger,
    resolveCurrentSession: async (key) => key === staleSessionKey
      ? (() => {
          const error = new Error("current family is unavailable");
          error.vimicateHistoryFamilyFailureKind = "unavailable";
          throw error;
        })()
      : {
          sessionId: ids.at(-1),
          startedAtMs: epochs.at(-1),
          transcriptFilename: filenames.at(-1)
        }
  });

  const audit = await harness.contract.probe();
  assert.equal(audit.families, 1);
  assert.equal(audit.unavailableFamilies, 1);
  const response = await harness.contract({ ...baseParams("segments"), cursor: 0, limit: 3 });
  assert.equal(response.hasMore, true);
  assert.deepEqual(response.segments.map((segment) => segment.sessionId), ids.slice(0, 3));
});

test("a store-owned topic filename remains bound to the current segment", async () => {
  const ledger = fixtureLedger();
  const topicFilename = `${ids.at(-1)}-topic-supervising.jsonl`;
  ledger.families[stableSessionKey].segments.at(-1).transcriptFilename = topicFilename;
  const transcriptReads = [];
  const contract = createVimicateHistoryFamilyContract({
    familySecret: Buffer.alloc(32, 7),
    readLedger: async () => ledger,
    resolveCurrentSession: async () => ({
      sessionId: ids.at(-1),
      startedAtMs: epochs.at(-1),
      transcriptFilename: topicFilename
    }),
    readTranscriptEvidence: async (_agentId, filename) => {
      transcriptReads.push(filename);
      const index = filename === topicFilename
        ? ids.length - 1
        : filenames.indexOf(filename);
      return {
        sourceRevision: fixtureRevision(index),
        byteLength: fixtureBytes(index).byteLength
      };
    },
    readProjectedHistoryPage: async () => {
      throw new Error("unused");
    }
  });

  const census = await contract({
    ...baseParams("segments"),
    cursor: 0,
    limit: 5
  });

  assert.equal(census.totalSegments, 5);
  assert.equal(transcriptReads.at(-1), topicFilename);
});

test("handler startup probe fails before work beyond its family bound", async () => {
  const ledger = fixtureLedger();
  const template = ledger.families[stableSessionKey];
  ledger.families = Object.fromEntries(
    Array.from({ length: 1025 }, (_, index) => [
      `agent:main:dashboard:audit-${index}`,
      template
    ])
  );
  const harness = fixtureHarness({ readLedger: async () => ledger });
  await assert.rejects(harness.contract.probe(), /family bound/);
  assert.deepEqual(harness.transcriptReads, []);
});

test("page binds the census segment and uses canonical projection metadata", async () => {
  const harness = fixtureHarness();
  const census = await harness.contract({ ...baseParams("segments"), cursor: 0, limit: 5 });
  const segment = census.segments[2];
  const page = await harness.contract({
    ...baseParams("page"),
    familyToken: census.familyToken,
    sessionId: segment.sessionId,
    segmentOrder: segment.order,
    sourceRevision: segment.sourceRevision,
    offset: 4,
    limit: 2
  });
  assert.equal(page.sessionId, ids[2]);
  assert.equal(page.offset, 4);
  assert.equal(page.nextOffset, 6);
  assert.equal(page.totalMessages, 9);
  assert.deepEqual(page.messages, [{ role: "assistant", content: "projected" }]);
  assert.deepEqual(harness.calls[0], {
    stableSessionKey,
    agentId: "main",
    sessionId: ids[2],
    state: "archived",
    startedAtMs: epochs[2],
    sourceRevision: segment.sourceRevision,
    transcriptFilename: filenames[2],
    offset: 4,
    limit: 2
  });
  assert.ok(!JSON.stringify(page).includes("transcriptFilename"));
});

test("stale token, source revision, and generation all fail closed", async () => {
  const harness = fixtureHarness();
  const census = await harness.contract({ ...baseParams("segments"), cursor: 0, limit: 5 });
  const segment = census.segments[0];
  const request = {
    ...baseParams("page"),
    familyToken: census.familyToken,
    sessionId: segment.sessionId,
    segmentOrder: segment.order,
    sourceRevision: segment.sourceRevision,
    offset: 0,
    limit: 2
  };
  await assert.rejects(harness.contract({ ...request, familyToken: "x".repeat(43) }));
  await assert.rejects(harness.contract({ ...request, sourceRevision: "y".repeat(64) }));
  harness.setCurrent({
    sessionId: ids[3],
    startedAtMs: epochs[3],
    transcriptFilename: filenames[3]
  });
  await assert.rejects(harness.contract(request), /current session generation/);
});

test("source mutation during projection prevents page publication", async () => {
  let harness;
  harness = fixtureHarness({
    readProjectedHistoryPage: async (request) => {
      harness.files.set(request.transcriptFilename, Buffer.from("changed"));
      return {
        sessionId: request.sessionId,
        sessionKey: request.stableSessionKey,
        transcriptFilename: request.transcriptFilename,
        offset: 0,
        hasMore: false,
        totalMessages: 1,
        messages: []
      };
    }
  });
  const census = await harness.contract({ ...baseParams("segments"), cursor: 0, limit: 5 });
  const segment = census.segments[0];
  await assert.rejects(harness.contract({
    ...baseParams("page"),
    familyToken: census.familyToken,
    sessionId: segment.sessionId,
    segmentOrder: segment.order,
    sourceRevision: segment.sourceRevision,
    offset: 0,
    limit: 2
  }), /archived segment no longer matches|family evidence changed/);
});

test("canonical projection must echo the exact bound segment identity", async () => {
  const variants = [
    { sessionId: ids[1], expected: /invalid page metadata/ },
    { sessionKey: `${stableSessionKey}:wrong`, expected: /invalid page metadata/ },
    { transcriptFilename: filenames[1], expected: /invalid page metadata/ }
  ];
  for (const variant of variants) {
    const harness = fixtureHarness({
      readProjectedHistoryPage: async (request) => ({
        sessionId: request.sessionId,
        sessionKey: request.stableSessionKey,
        transcriptFilename: request.transcriptFilename,
        offset: request.offset,
        hasMore: false,
        totalMessages: 1,
        messages: [],
        ...variant
      })
    });
    const census = await harness.contract({
      ...baseParams("segments"), cursor: 0, limit: 5
    });
    const segment = census.segments[0];
    await assert.rejects(harness.contract({
      ...baseParams("page"),
      familyToken: census.familyToken,
      sessionId: segment.sessionId,
      segmentOrder: segment.order,
      sourceRevision: segment.sourceRevision,
      offset: 0,
      limit: 2
    }), variant.expected);
  }
});

test("canonical projection may expand display rows within the app parser bound", async () => {
  const harness = fixtureHarness({
    readProjectedHistoryPage: async (request) => ({
      sessionId: request.sessionId,
      sessionKey: request.stableSessionKey,
      transcriptFilename: request.transcriptFilename,
      offset: request.offset,
      hasMore: false,
      totalMessages: 1,
      messages: Array.from({ length: 5 }, (_, index) => ({
        role: "assistant",
        content: `projected-${index}`
      }))
    })
  });
  const census = await harness.contract({
    ...baseParams("segments"), cursor: 0, limit: 5
  });
  const segment = census.segments[0];
  const page = await harness.contract({
    ...baseParams("page"),
    familyToken: census.familyToken,
    sessionId: segment.sessionId,
    segmentOrder: segment.order,
    sourceRevision: segment.sourceRevision,
    offset: 0,
    limit: 2
  });
  assert.equal(page.messages.length, 5);
});

test("an unrelated segment mutation during projection invalidates publication", async () => {
  let harness;
  harness = fixtureHarness({
    readProjectedHistoryPage: async (request) => {
      harness.files.set(filenames[3], Buffer.from("unrelated-change"));
      return {
        sessionId: request.sessionId,
        sessionKey: request.stableSessionKey,
        transcriptFilename: request.transcriptFilename,
        offset: request.offset,
        hasMore: false,
        totalMessages: 1,
        messages: []
      };
    }
  });
  const census = await harness.contract({
    ...baseParams("segments"), cursor: 0, limit: 5
  });
  const segment = census.segments[0];
  await assert.rejects(harness.contract({
    ...baseParams("page"),
    familyToken: census.familyToken,
    sessionId: segment.sessionId,
    segmentOrder: segment.order,
    sourceRevision: segment.sourceRevision,
    offset: 0,
    limit: 2
  }), /archived segment no longer matches|family evidence changed/);
});

test("ledger revisions must be exact lowercase SHA-256 hex", async () => {
  for (const invalidRevision of ["x".repeat(43), "A".repeat(64)]) {
    const ledger = fixtureLedger();
    ledger.families[stableSessionKey].segments[0].sourceRevision = invalidRevision;
    const harness = fixtureHarness({ readLedger: async () => ledger });
    await assert.rejects(
      harness.contract({ ...baseParams("segments"), cursor: 0, limit: 5 }),
      /lowercase SHA-256 digest/
    );
  }
});

test("archived source mutation after census prevents projection", async () => {
  const harness = fixtureHarness();
  const census = await harness.contract({ ...baseParams("segments"), cursor: 0, limit: 5 });
  const segment = census.segments[0];
  harness.files.set(filenames[0], Buffer.from("changed-before-projection"));
  await assert.rejects(harness.contract({
    ...baseParams("page"),
    familyToken: census.familyToken,
    sessionId: segment.sessionId,
    segmentOrder: segment.order,
    sourceRevision: segment.sourceRevision,
    offset: 0,
    limit: 2
  }), /no longer matches its ledger revision/);
  assert.equal(harness.calls.length, 0);
});

test("unsafe transcript paths and incomplete current ledger are rejected", async () => {
  const unsafe = fixtureLedger();
  unsafe.families[stableSessionKey].segments[0].transcriptFilename = "../secret";
  const unsafeHarness = fixtureHarness({ readLedger: async () => unsafe });
  await assert.rejects(
    unsafeHarness.contract({ ...baseParams("segments"), cursor: 0, limit: 5 }),
    /basename/
  );

  const badArchiveTimestamp = fixtureLedger();
  badArchiveTimestamp.families[stableSessionKey].segments[0].transcriptFilename =
    `${ids[0]}.jsonl.reset.not-a-host-timestamp`;
  const badArchiveHarness = fixtureHarness({
    readLedger: async () => badArchiveTimestamp
  });
  await assert.rejects(
    badArchiveHarness.contract({ ...baseParams("segments"), cursor: 0, limit: 5 }),
    /timestamp is not canonical/
  );

  const incomplete = fixtureLedger();
  const wrongCurrentId = "11111111-1111-4111-8111-111111111111";
  incomplete.families[stableSessionKey].segments.at(-1).sessionId = wrongCurrentId;
  incomplete.families[stableSessionKey].segments.at(-1).transcriptFilename =
    `${wrongCurrentId}.jsonl`;
  const incompleteHarness = fixtureHarness({ readLedger: async () => incomplete });
  await assert.rejects(
    incompleteHarness.contract({ ...baseParams("segments"), cursor: 0, limit: 5 }),
    /generation/
  );

  const targetMismatchHarness = fixtureHarness();
  targetMismatchHarness.setCurrent({
    sessionId: ids.at(-1),
    startedAtMs: epochs.at(-1),
    transcriptFilename: filenames[0]
  });
  await assert.rejects(
    targetMismatchHarness.contract({ ...baseParams("segments"), cursor: 0, limit: 5 }),
    /generation/
  );
});

test("ledger accepts the host's unrenamed closed transcript only for compaction", async () => {
  const compaction = fixtureLedger();
  const exactFilename = `${ids[0]}.jsonl`;
  compaction.families[stableSessionKey].segments[0].endReason = "compaction";
  compaction.families[stableSessionKey].segments[0].transcriptFilename = exactFilename;
  const bytes = fixtureBytes(0);
  const harness = fixtureHarness({
    readLedger: async () => compaction,
    readTranscriptEvidence: async (_agentId, filename) => ({
      sourceRevision: filename === exactFilename
        ? crypto.createHash("sha256").update(bytes).digest("hex")
        : fixtureRevision(filenames.indexOf(filename)),
      byteLength: filename === exactFilename
        ? bytes.byteLength
        : fixtureBytes(filenames.indexOf(filename)).byteLength
    })
  });
  const response = await harness.contract({
    ...baseParams("segments"),
    cursor: 0,
    limit: 5
  });
  assert.equal(response.segments[0].endReason, "compaction");

  compaction.families[stableSessionKey].segments[0].endReason = "reset";
  await assert.rejects(
    harness.contract({ ...baseParams("segments"), cursor: 0, limit: 5 }),
    /only compaction/
  );
});

test("family token is HMAC-bound to the host secret", async () => {
  const first = fixtureHarness();
  const second = fixtureHarness({ familySecret: Buffer.alloc(32, 8) });
  const firstPage = await first.contract({ ...baseParams("segments"), cursor: 0, limit: 5 });
  const secondPage = await second.contract({ ...baseParams("segments"), cursor: 0, limit: 5 });
  assert.notEqual(firstPage.familyToken, secondPage.familyToken);
  assert.match(firstPage.familyToken, /^[A-Za-z0-9_-]{43}$/);
});

test("aggregate family work is rejected before exceeding its byte budget", async () => {
  let reads = 0;
  const harness = fixtureHarness({
    readTranscriptEvidence: async (_agentId, _filename, maximumBytes) => {
      reads += 1;
      return {
        sourceRevision: fixtureRevision(reads - 1),
        byteLength: reads === 1 ? maximumBytes : 1
      };
    }
  });
  await assert.rejects(
    harness.contract({ ...baseParams("segments"), cursor: 0, limit: 5 }),
    /transcript byteLength/
  );
  assert.equal(reads, 2);
});

test("cancelled family work stops before reading another transcript", async () => {
  const controller = new AbortController();
  let reads = 0;
  const harness = fixtureHarness({
    readTranscriptEvidence: async (_agentId, filename) => {
      reads += 1;
      controller.abort();
      const index = filenames.indexOf(filename);
      return {
        sourceRevision: fixtureRevision(index),
        byteLength: fixtureBytes(index).byteLength
      };
    }
  });
  await assert.rejects(
    harness.contract(
      { ...baseParams("segments"), cursor: 0, limit: 5 },
      { signal: controller.signal }
    ),
    /cancelled/
  );
  assert.equal(reads, 1);
});

test("ledger corruption is typed separately from an unknown-family client request", async () => {
  const malformed = fixtureLedger();
  malformed.families[stableSessionKey].segments[0].sessionId = "not-a-uuid";
  const corruptHarness = fixtureHarness({ readLedger: async () => malformed });
  await assert.rejects(
    corruptHarness.contract({ ...baseParams("segments"), cursor: 0, limit: 5 }),
    (error) => error?.vimicateHistoryFamilyFailureKind === "integrity"
      && /segment sessionId/.test(error.message)
  );

  const healthyHarness = fixtureHarness();
  await assert.rejects(
    healthyHarness.contract({
      ...baseParams("segments"),
      stableSessionKey: "agent:main:dashboard:unknown-family",
      cursor: 0,
      limit: 5
    }),
    (error) => error?.vimicateHistoryFamilyFailureKind === "client"
      && /not audited/.test(error.message)
  );
});
