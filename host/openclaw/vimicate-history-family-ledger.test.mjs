import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { VIMICATE_ARCHIVED_FAMILY_PROOF } from
  "./vimicate-history-family-contract.mjs";
import { createOpenClawHistoryFamilyLedgerWriter } from
  "./vimicate-history-family-ledger.mjs";
import {
  loadOpenClawHistoryFamilyContract,
  openClawHistoryFamilyHostFiles
} from
  "./vimicate-history-family-openclaw.mjs";

const key = "agent:main:dashboard:ledger-fixture";
const firstId = "11111111-1111-4111-8111-111111111111";
const secondId = "22222222-2222-4222-8222-222222222222";

async function fixture({ tracked = true } = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "vimicate-ledger-"));
  const stateDir = path.join(root, "openclaw");
  const vimicateDir = path.join(root, "vimicate");
  const sessionsDir = path.join(stateDir, "agents", "main", "sessions");
  await fs.mkdir(sessionsDir, { recursive: true });
  await fs.mkdir(vimicateDir);
  const currentFile = path.join(sessionsDir, `${secondId}.jsonl`);
  const archivedFile = path.join(
    sessionsDir,
    `${firstId}.jsonl.reset.2026-07-19T10-00-00.000Z`
  );
  await fs.writeFile(archivedFile, "closed transcript\n");
  await fs.writeFile(currentFile, "current transcript\n");
  await fs.writeFile(path.join(sessionsDir, "sessions.json"), JSON.stringify({
    [key]: {
      sessionId: secondId,
      sessionStartedAt: 300,
      sessionFile: currentFile
    }
  }));
  await fs.writeFile(
    path.join(vimicateDir, openClawHistoryFamilyHostFiles.secret),
    `${"ab".repeat(32)}\n`,
    { mode: 0o600 }
  );
  await fs.writeFile(
    path.join(vimicateDir, openClawHistoryFamilyHostFiles.ledger),
    `${JSON.stringify({
      schemaVersion: 1,
      proof: VIMICATE_ARCHIVED_FAMILY_PROOF,
      families: tracked ? {
        [key]: {
          agentId: "main",
          segments: [{
            sessionId: firstId,
            startedAtMs: 100,
            transcriptFilename: `${firstId}.jsonl`
          }]
        }
      } : {}
    })}\n`,
    { mode: 0o600 }
  );
  return {
    root,
    stateDir,
    vimicateDir,
    sessionsDir,
    archivedFile,
    currentFile,
    writer: createOpenClawHistoryFamilyLedgerWriter({ stateDir, vimicateDir })
  };
}

function event(files, reason = "reset") {
  return {
    sessionId: firstId,
    sessionKey: key,
    reason,
    sessionFile: files.archivedFile,
    transcriptArchived: true,
    nextSessionId: secondId,
    nextSessionKey: key
  };
}

async function ledger(files) {
  return JSON.parse(await fs.readFile(
    path.join(files.vimicateDir, openClawHistoryFamilyHostFiles.ledger),
    "utf8"
  ));
}

test("session_end atomically closes and appends one tracked segment", async (t) => {
  const files = await fixture();
  t.after(() => fs.rm(files.root, { recursive: true, force: true }));
  assert.deepEqual(await files.writer.probe(), {
    contract: "session-end-ledger-v1",
    trackedFamilies: 1
  });
  const result = await files.writer.record(event(files), {
    agentId: "main",
    sessionKey: key
  });
  assert.equal(result.status, "appended");
  const family = (await ledger(files)).families[key];
  assert.equal(family.segments.length, 2);
  assert.deepEqual(family.segments[0], {
    sessionId: firstId,
    startedAtMs: 100,
    endedAtMs: 300,
    endReason: "reset",
    sourceRevision: crypto.createHash("sha256")
      .update("closed transcript\n")
      .digest("hex"),
    transcriptFilename: path.basename(files.archivedFile)
  });
  assert.deepEqual(family.segments[1], {
    sessionId: secondId,
    startedAtMs: 300,
    transcriptFilename: `${secondId}.jsonl`
  });
  assert.equal((await fs.stat(
    path.join(files.vimicateDir, openClawHistoryFamilyHostFiles.ledger)
  )).mode & 0o777, 0o600);
  const ownedDirectory = path.join(
    files.vimicateDir,
    openClawHistoryFamilyHostFiles.ownedTranscripts
  );
  const owned = path.join(ownedDirectory, `${firstId}.jsonl`);
  assert.equal(await fs.readFile(owned, "utf8"), "closed transcript\n");
  assert.equal((await fs.stat(ownedDirectory)).mode & 0o777, 0o700);
  assert.equal((await fs.stat(owned)).mode & 0o777, 0o600);
});

test("an explicit exact repair retains one missed unrenamed replacement", async (t) => {
  const files = await fixture();
  t.after(() => fs.rm(files.root, { recursive: true, force: true }));
  const unrenamed = path.join(files.sessionsDir, `${firstId}.jsonl`);
  await fs.rename(files.archivedFile, unrenamed);

  const result = await files.writer.repairExactReplacement({
    stableSessionKey: key,
    previousSessionId: firstId,
    currentSessionId: secondId
  });

  assert.equal(result.status, "appended");
  const family = (await ledger(files)).families[key];
  assert.equal(family.segments.length, 2);
  assert.deepEqual(family.segments[0], {
    sessionId: firstId,
    startedAtMs: 100,
    endedAtMs: 300,
    endReason: "replacement",
    sourceRevision: crypto.createHash("sha256")
      .update("closed transcript\n")
      .digest("hex"),
    transcriptFilename: `${firstId}.jsonl.reset.1970-01-01T00-00-00.300Z`
  });
  assert.equal(
    await fs.readFile(path.join(
      files.vimicateDir,
      openClawHistoryFamilyHostFiles.ownedTranscripts,
      `${firstId}.jsonl`
    ), "utf8"),
    "closed transcript\n"
  );
});

test("a model observation repairs only a replacement witnessed after the probe", async (t) => {
  const files = await fixture();
  t.after(() => fs.rm(files.root, { recursive: true, force: true }));
  const unrenamed = path.join(files.sessionsDir, `${firstId}.jsonl`);
  await fs.rename(files.archivedFile, unrenamed);
  await fs.writeFile(path.join(files.sessionsDir, "sessions.json"), JSON.stringify({
    [key]: {
      sessionId: firstId,
      sessionStartedAt: 100,
      sessionFile: unrenamed
    }
  }));
  await files.writer.probe();
  await fs.writeFile(path.join(files.sessionsDir, "sessions.json"), JSON.stringify({
    [key]: {
      sessionId: secondId,
      sessionStartedAt: 300,
      sessionFile: files.currentFile
    }
  }));

  const result = await files.writer.observeCurrent({
    sessionKey: key,
    sessionId: secondId
  }, { agentId: "main" });

  assert.equal(result.status, "appended");
  assert.deepEqual(
    (await ledger(files)).families[key].segments.map((segment) => segment.sessionId),
    [firstId, secondId]
  );
});

test("a post-restart observation cannot guess across an unobserved replacement", async (t) => {
  const files = await fixture();
  t.after(() => fs.rm(files.root, { recursive: true, force: true }));
  await files.writer.probe();

  assert.deepEqual(await files.writer.observeCurrent({
    sessionKey: key,
    sessionId: secondId
  }, { agentId: "main" }), { status: "ignored-unobserved" });
  assert.equal((await ledger(files)).families[key].segments.length, 1);
});

test("probe leaves a tracked but currently unavailable family unobserved", async (t) => {
  const files = await fixture();
  t.after(() => fs.rm(files.root, { recursive: true, force: true }));
  await fs.writeFile(path.join(files.sessionsDir, "sessions.json"), "{}\n");

  assert.deepEqual(await files.writer.probe(), {
    contract: "session-end-ledger-v1",
    trackedFamilies: 1
  });
  assert.deepEqual(await files.writer.observeCurrent({
    sessionKey: key,
    sessionId: secondId
  }), { status: "ignored-unobserved" });
});

test("probe leaves malformed current authority to the family audit instead of disabling observation", async (t) => {
  const files = await fixture();
  t.after(() => fs.rm(files.root, { recursive: true, force: true }));
  await fs.writeFile(path.join(files.sessionsDir, "sessions.json"), JSON.stringify({
    [key]: {
      sessionId: secondId,
      sessionStartedAt: 0,
      sessionFile: files.currentFile
    }
  }));

  assert.equal((await files.writer.probe()).contract, "session-end-ledger-v1");
  assert.deepEqual(await files.writer.observeCurrent({
    sessionKey: key,
    sessionId: secondId
  }), { status: "ignored-unobserved" });
});

test("session_end retains canonical topic transcript names", async (t) => {
  const files = await fixture();
  t.after(() => fs.rm(files.root, { recursive: true, force: true }));
  const archivedTopic = path.join(
    files.sessionsDir,
    `${firstId}-topic-supervising.jsonl.reset.2026-07-19T10-00-00.000Z`
  );
  const currentTopic = path.join(
    files.sessionsDir,
    `${secondId}-topic-supervising.jsonl`
  );
  await fs.rename(files.archivedFile, archivedTopic);
  await fs.rename(files.currentFile, currentTopic);
  const currentLedger = await ledger(files);
  currentLedger.families[key].segments[0].transcriptFilename =
    `${firstId}-topic-supervising.jsonl`;
  await fs.writeFile(
    path.join(files.vimicateDir, openClawHistoryFamilyHostFiles.ledger),
    `${JSON.stringify(currentLedger)}\n`,
    { mode: 0o600 }
  );
  await fs.writeFile(
    path.join(files.sessionsDir, "sessions.json"),
    JSON.stringify({
      [key]: {
        sessionId: secondId,
        sessionStartedAt: 300,
        sessionFile: currentTopic
      }
    })
  );

  const result = await files.writer.record({
    ...event(files),
    sessionFile: archivedTopic
  });

  assert.equal(result.status, "appended");
  const family = (await ledger(files)).families[key];
  assert.equal(family.segments[0].transcriptFilename, path.basename(archivedTopic));
  assert.equal(family.segments[1].transcriptFilename, path.basename(currentTopic));
});

test("owned copy survives removal of the OpenClaw reset source", async (t) => {
  const files = await fixture();
  t.after(() => fs.rm(files.root, { recursive: true, force: true }));
  await files.writer.record(event(files));
  await fs.rm(files.archivedFile);

  const projectionRequests = [];
  const contract = await loadOpenClawHistoryFamilyContract({
    stateDir: files.stateDir,
    vimicateDir: files.vimicateDir,
    readProjectedHistoryPage: async (request) => {
      projectionRequests.push(request);
      return {
        sessionId: request.sessionId,
        sessionKey: request.stableSessionKey,
        transcriptFilename: request.transcriptFilename,
        offset: request.offset,
        hasMore: false,
        totalMessages: 1,
        messages: [{ role: "assistant", content: await fs.readFile(request.sessionFile, "utf8") }]
      };
    }
  });
  assert.equal((await contract.probe()).segments, 2);
  const census = await contract({
    contract: "archived-family-v1",
    mode: "segments",
    stableSessionKey: key,
    expectedCurrentSessionId: secondId,
    expectedCurrentSessionStartedAtMs: 300,
    cursor: 0,
    limit: 8
  });
  const archived = census.segments[0];
  const page = await contract({
    contract: "archived-family-v1",
    mode: "page",
    stableSessionKey: key,
    expectedCurrentSessionId: secondId,
    expectedCurrentSessionStartedAtMs: 300,
    familyToken: census.familyToken,
    sessionId: archived.sessionId,
    segmentOrder: archived.order,
    sourceRevision: archived.sourceRevision,
    offset: 0,
    limit: 8
  });
  assert.equal(page.messages[0].content, "closed transcript\n");
  assert.equal(
    path.dirname(projectionRequests[0].sessionFile),
    "/dev/fd"
  );
  assert.match(
    projectionRequests[0].sessionFile,
    /^\/dev\/fd\/\d+$/
  );
  await assert.rejects(fs.readFile(projectionRequests[0].sessionFile));
  assert.equal(
    projectionRequests[0].storePath,
    "/dev/fd/sessions.json"
  );
});

test("duplicate and concurrent duplicate hooks are idempotent", async (t) => {
  const files = await fixture();
  t.after(() => fs.rm(files.root, { recursive: true, force: true }));
  const [first, duplicate] = await Promise.all([
    files.writer.record(event(files)),
    files.writer.record(event(files))
  ]);
  assert.deepEqual([first.status, duplicate.status], ["appended", "unchanged"]);
  assert.equal((await ledger(files)).families[key].segments.length, 2);
});

test("writer refuses to replace a mismatched preexisting owned transcript", async (t) => {
  const files = await fixture();
  t.after(() => fs.rm(files.root, { recursive: true, force: true }));
  await files.writer.probe();
  const owned = path.join(
    files.vimicateDir,
    openClawHistoryFamilyHostFiles.ownedTranscripts,
    `${firstId}.jsonl`
  );
  await fs.writeFile(owned, "different retained bytes\n", { mode: 0o600 });
  await assert.rejects(
    files.writer.record(event(files)),
    /owned transcript disagrees/
  );
  assert.equal((await ledger(files)).families[key].segments.length, 1);
  assert.equal(await fs.readFile(owned, "utf8"), "different retained bytes\n");
});

test("shutdown without a successor is ignored", async (t) => {
  const files = await fixture();
  t.after(() => fs.rm(files.root, { recursive: true, force: true }));
  assert.equal((await files.writer.record({
    sessionId: firstId,
    sessionKey: key,
    reason: "shutdown",
    sessionFile: `${firstId}.jsonl`
  })).status, "ignored-terminal");
  assert.equal((await ledger(files)).families[key].segments.length, 1);
});

test("untracked families are not inferred from lifecycle events", async (t) => {
  const files = await fixture({ tracked: false });
  t.after(() => fs.rm(files.root, { recursive: true, force: true }));
  assert.equal((await files.writer.record(event(files))).status, "ignored-untracked");
  assert.deepEqual((await ledger(files)).families, {});
});

test("untracked successor detail cannot disable tracked-family lineage", async (t) => {
  const files = await fixture({ tracked: false });
  t.after(() => fs.rm(files.root, { recursive: true, force: true }));
  const result = await files.writer.record({
    sessionKey: key,
    sessionId: "not-a-uuid",
    nextSessionId: "also-not-a-uuid",
    nextSessionKey: "agent:other:different",
    reason: "future-host-reason",
    sessionFile: "/untrusted/path"
  }, { agentId: "other" });
  assert.equal(result.status, "ignored-untracked");
  assert.deepEqual((await ledger(files)).families, {});
});

test("unknown replacement reason is normalized only with a successor", async (t) => {
  const files = await fixture();
  t.after(() => fs.rm(files.root, { recursive: true, force: true }));
  await files.writer.record(event(files, "unknown"));
  assert.equal((await ledger(files)).families[key].segments[0].endReason, "replacement");
});

for (const reason of ["new", "idle", "daily"]) {
  test(`writer records typed ${reason} transition`, async (t) => {
    const files = await fixture();
    t.after(() => fs.rm(files.root, { recursive: true, force: true }));
    await files.writer.record(event(files, reason));
    assert.equal((await ledger(files)).families[key].segments[0].endReason, reason);
  });
}

test("writer records the real host new-id compaction shape", async (t) => {
  const files = await fixture();
  t.after(() => fs.rm(files.root, { recursive: true, force: true }));
  const unrenamed = path.join(files.sessionsDir, `${firstId}.jsonl`);
  await fs.rename(files.archivedFile, unrenamed);
  const compacted = event(files, "compaction");
  compacted.sessionFile = unrenamed;
  compacted.transcriptArchived = false;
  await files.writer.record(compacted);
  const family = (await ledger(files)).families[key];
  assert.equal(family.segments[0].endReason, "compaction");
  assert.equal(family.segments[0].transcriptFilename, `${firstId}.jsonl`);
});

test("writer ignores the real host same-id file-only compaction shape", async (t) => {
  const files = await fixture();
  t.after(() => fs.rm(files.root, { recursive: true, force: true }));
  const sameIDCompaction = {
    sessionId: firstId,
    sessionKey: key,
    reason: "compaction",
    sessionFile: path.join(files.sessionsDir, `${firstId}.jsonl`),
    transcriptArchived: false,
    nextSessionId: firstId
  };
  assert.equal(
    (await files.writer.record(sameIDCompaction)).status,
    "ignored-same-session-compaction"
  );
  assert.equal((await ledger(files)).families[key].segments.length, 1);
});

test("tracked rollover without a successor disables lineage", async (t) => {
  const files = await fixture();
  t.after(() => fs.rm(files.root, { recursive: true, force: true }));
  await assert.rejects(files.writer.record({
    sessionId: firstId,
    sessionKey: key,
    reason: "reset",
    sessionFile: files.archivedFile
  }), /missing its successor/);
  assert.equal((await ledger(files)).families[key].segments.length, 1);
});

test("tracked-family discontinuity fails closed without changing the ledger", async (t) => {
  const files = await fixture();
  t.after(() => fs.rm(files.root, { recursive: true, force: true }));
  const before = await fs.readFile(
    path.join(files.vimicateDir, openClawHistoryFamilyHostFiles.ledger),
    "utf8"
  );
  const bad = event(files);
  bad.sessionId = "33333333-3333-4333-8333-333333333333";
  await assert.rejects(files.writer.record(bad), /archived transcript filename/);
  assert.equal(await fs.readFile(
    path.join(files.vimicateDir, openClawHistoryFamilyHostFiles.ledger),
    "utf8"
  ), before);
});

test("writer rejects a successor store that does not own the declared id", async (t) => {
  const files = await fixture();
  t.after(() => fs.rm(files.root, { recursive: true, force: true }));
  const bad = event(files);
  bad.nextSessionId = "33333333-3333-4333-8333-333333333333";
  await assert.rejects(files.writer.record(bad), /does not own the declared successor/);
  assert.equal((await ledger(files)).families[key].segments.length, 1);
});

test("writer rejects symlinked archived transcript", async (t) => {
  const files = await fixture();
  t.after(() => fs.rm(files.root, { recursive: true, force: true }));
  const target = `${files.archivedFile}.target`;
  await fs.rename(files.archivedFile, target);
  await fs.symlink(target, files.archivedFile);
  await assert.rejects(files.writer.record(event(files)), /without following links/);
  assert.equal((await ledger(files)).families[key].segments.length, 1);
});

test("writer rejects a non-host archive timestamp", async (t) => {
  const files = await fixture();
  t.after(() => fs.rm(files.root, { recursive: true, force: true }));
  const bad = event(files);
  bad.sessionFile = path.join(
    files.sessionsDir,
    `${firstId}.jsonl.reset.not-a-host-timestamp`
  );
  await fs.rename(files.archivedFile, bad.sessionFile);
  await assert.rejects(files.writer.record(bad), /timestamp is not canonical/);
  assert.equal((await ledger(files)).families[key].segments.length, 1);
});

test("writer pins the Vimicate ledger directory across lifecycle writes", async (t) => {
  const files = await fixture();
  t.after(() => fs.rm(files.root, { recursive: true, force: true }));
  await files.writer.probe();
  const displaced = `${files.vimicateDir}.displaced`;
  await fs.rename(files.vimicateDir, displaced);
  await fs.mkdir(files.vimicateDir);
  await fs.copyFile(
    path.join(displaced, openClawHistoryFamilyHostFiles.ledger),
    path.join(files.vimicateDir, openClawHistoryFamilyHostFiles.ledger)
  );
  await assert.rejects(
    files.writer.record(event(files)),
    /Vimicate host directory identity changed/
  );
});

test("writer pins the OpenClaw sessions directory across lifecycle writes", async (t) => {
  const files = await fixture();
  t.after(() => fs.rm(files.root, { recursive: true, force: true }));
  await files.writer.record(event(files));
  const displaced = `${files.sessionsDir}.displaced`;
  await fs.rename(files.sessionsDir, displaced);
  await fs.cp(displaced, files.sessionsDir, { recursive: true });
  await assert.rejects(
    files.writer.record(event(files)),
    /sessions directory chain identity changed/
  );
  assert.equal((await ledger(files)).families[key].segments.length, 2);
});
