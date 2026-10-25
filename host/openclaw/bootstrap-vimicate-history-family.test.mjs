import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const script = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  "bootstrap-vimicate-history-family.mjs"
);

async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "vimicate-history-bootstrap-"));
  const stateDir = path.join(root, "openclaw");
  const sessionsDir = path.join(stateDir, "agents", "main", "sessions");
  const vimicateDir = path.join(root, "vimicate");
  await fs.mkdir(sessionsDir, { recursive: true });
  await fs.mkdir(vimicateDir, { recursive: true, mode: 0o700 });
  await fs.chmod(vimicateDir, 0o700);
  await fs.mkdir(path.join(vimicateDir, "openclaw-history-family-owned"), {
    mode: 0o700
  });
  return { root, stateDir, sessionsDir, vimicateDir };
}

test("an explicit current-only family establishes a tracked baseline", async () => {
  const value = await fixture();
  try {
    const key = "agent:main:direct:vimicate-ios:project:new-project";
    const sessionId = "11111111-1111-4111-8111-111111111111";
    const startedAt = "2026-08-27T00:00:00.000Z";
    const sessionFile = path.join(value.sessionsDir, `${sessionId}.jsonl`);
    await fs.writeFile(
      sessionFile,
      `${JSON.stringify({ type: "session", version: 3, id: sessionId, timestamp: startedAt })}\n`
    );
    await fs.writeFile(
      path.join(value.sessionsDir, "sessions.json"),
      JSON.stringify({
        [key]: {
          sessionId,
          sessionFile,
          sessionStartedAt: Date.parse(startedAt)
        }
      })
    );

    const result = spawnSync(process.execPath, [
      script,
      "--state-dir", value.stateDir,
      "--vimicate-dir", value.vimicateDir,
      "--stable-session-key", key,
      "--segment-file", sessionFile
    ], { encoding: "utf8" });

    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), {
      dryRun: false,
      stableSessionKey: key,
      archivedSegments: 0,
      currentSessionId: sessionId,
      aggregateBytes: (await fs.stat(sessionFile)).size
    });
    const ledger = JSON.parse(await fs.readFile(
      path.join(value.vimicateDir, "openclaw-history-families.json"),
      "utf8"
    ));
    assert.deepEqual(ledger.families[key], {
      agentId: "main",
      segments: [{
        sessionId,
        startedAtMs: Date.parse(startedAt),
        transcriptFilename: `${sessionId}.jsonl`
      }]
    });
    assert.equal(
      (await fs.readdir(path.join(value.vimicateDir, "openclaw-history-family-owned"))).length,
      0
    );
  } finally {
    await fs.rm(value.root, { recursive: true, force: true });
  }
});

test("a current-only family still requires exact current store authority", async () => {
  const value = await fixture();
  try {
    const key = "agent:main:direct:vimicate-ios:project:new-project";
    const sessionId = "22222222-2222-4222-8222-222222222222";
    const sessionFile = path.join(value.sessionsDir, `${sessionId}.jsonl`);
    await fs.writeFile(
      sessionFile,
      `${JSON.stringify({
        type: "session",
        version: 3,
        id: sessionId,
        timestamp: "2026-08-27T00:00:00.000Z"
      })}\n`
    );
    await fs.writeFile(path.join(value.sessionsDir, "sessions.json"), "{}\n");

    const result = spawnSync(process.execPath, [
      script,
      "--state-dir", value.stateDir,
      "--vimicate-dir", value.vimicateDir,
      "--stable-session-key", key,
      "--segment-file", sessionFile
    ], { encoding: "utf8" });

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /current OpenClaw session authority disagrees/);
  } finally {
    await fs.rm(value.root, { recursive: true, force: true });
  }
});

test("a store-owned topic transcript is a valid current-only family", async () => {
  const value = await fixture();
  try {
    const key = "agent:main:direct:vimicate-ios:project:notes:thread:supervising";
    const sessionId = "44444444-4444-4444-8444-444444444444";
    const startedAt = "2026-08-27T00:00:00.000Z";
    const sessionFile = path.join(
      value.sessionsDir,
      `${sessionId}-topic-supervising.jsonl`
    );
    await fs.writeFile(
      sessionFile,
      `${JSON.stringify({ type: "session", version: 3, id: sessionId, timestamp: startedAt })}\n`
    );
    await fs.writeFile(
      path.join(value.sessionsDir, "sessions.json"),
      JSON.stringify({
        [key]: {
          sessionId,
          sessionFile,
          sessionStartedAt: Date.parse(startedAt)
        }
      })
    );

    const result = spawnSync(process.execPath, [
      script,
      "--state-dir", value.stateDir,
      "--vimicate-dir", value.vimicateDir,
      "--stable-session-key", key,
      "--segment-file", sessionFile
    ], { encoding: "utf8" });

    assert.equal(result.status, 0, result.stderr);
    const ledger = JSON.parse(await fs.readFile(
      path.join(value.vimicateDir, "openclaw-history-families.json"),
      "utf8"
    ));
    assert.equal(
      ledger.families[key].segments[0].transcriptFilename,
      `${sessionId}-topic-supervising.jsonl`
    );
  } finally {
    await fs.rm(value.root, { recursive: true, force: true });
  }
});

test("an explicit audit may add older segments and close the prior audited tail", async () => {
  const value = await fixture();
  try {
    const key = "agent:main:direct:vimicate-ios:project:expanded";
    const firstId = "11111111-1111-4111-8111-111111111111";
    const priorTailId = "22222222-2222-4222-8222-222222222222";
    const currentId = "33333333-3333-4333-8333-333333333333";
    const firstStarted = "2026-08-25T00:00:00.000Z";
    const priorStarted = "2026-08-26T00:00:00.000Z";
    const currentStarted = "2026-08-27T00:00:00.000Z";
    const first = path.join(
      value.sessionsDir,
      `${firstId}.jsonl.reset.2026-08-26T00-00-00.000Z`
    );
    const prior = path.join(
      value.sessionsDir,
      `${priorTailId}.jsonl.reset.2026-08-27T00-00-00.000Z`
    );
    const current = path.join(value.sessionsDir, `${currentId}.jsonl`);
    for (const [file, id, timestamp] of [
      [first, firstId, firstStarted],
      [prior, priorTailId, priorStarted],
      [current, currentId, currentStarted]
    ]) {
      await fs.writeFile(
        file,
        `${JSON.stringify({ type: "session", version: 3, id, timestamp })}\n`
      );
    }
    await fs.writeFile(
      path.join(value.sessionsDir, "sessions.json"),
      JSON.stringify({
        [key]: {
          sessionId: currentId,
          sessionFile: current,
          sessionStartedAt: Date.parse(currentStarted)
        }
      })
    );
    await fs.writeFile(
      path.join(value.vimicateDir, "openclaw-history-families.json"),
      `${JSON.stringify({
        schemaVersion: 1,
        proof: "audited-baseline+contiguous-ledger-v1",
        families: {
          [key]: {
            agentId: "main",
            segments: [{
              sessionId: priorTailId,
              startedAtMs: Date.parse(priorStarted),
              transcriptFilename: `${priorTailId}.jsonl`
            }]
          }
        }
      })}\n`,
      { mode: 0o600 }
    );

    const result = spawnSync(process.execPath, [
      script,
      "--state-dir", value.stateDir,
      "--vimicate-dir", value.vimicateDir,
      "--stable-session-key", key,
      "--segment-file", first,
      "--segment-file", prior,
      "--segment-file", current
    ], { encoding: "utf8" });

    assert.equal(result.status, 0, result.stderr);
    const ledger = JSON.parse(await fs.readFile(
      path.join(value.vimicateDir, "openclaw-history-families.json"),
      "utf8"
    ));
    assert.deepEqual(
      ledger.families[key].segments.map((segment) => segment.sessionId),
      [firstId, priorTailId, currentId]
    );
    assert.equal(ledger.families[key].segments[1].endReason, "reset");
    assert.equal(ledger.families[key].segments[2].endedAtMs, undefined);
  } finally {
    await fs.rm(value.root, { recursive: true, force: true });
  }
});

test("an explicit audit still refuses a family that does not contain the prior audit", async () => {
  const value = await fixture();
  try {
    const key = "agent:main:direct:vimicate-ios:project:refuse-replacement";
    const currentId = "33333333-3333-4333-8333-333333333333";
    const currentStarted = "2026-08-27T00:00:00.000Z";
    const current = path.join(value.sessionsDir, `${currentId}.jsonl`);
    await fs.writeFile(
      current,
      `${JSON.stringify({
        type: "session",
        version: 3,
        id: currentId,
        timestamp: currentStarted
      })}\n`
    );
    await fs.writeFile(
      path.join(value.sessionsDir, "sessions.json"),
      JSON.stringify({
        [key]: {
          sessionId: currentId,
          sessionFile: current,
          sessionStartedAt: Date.parse(currentStarted)
        }
      })
    );
    await fs.writeFile(
      path.join(value.vimicateDir, "openclaw-history-families.json"),
      `${JSON.stringify({
        schemaVersion: 1,
        proof: "audited-baseline+contiguous-ledger-v1",
        families: {
          [key]: {
            agentId: "main",
            segments: [{
              sessionId: "11111111-1111-4111-8111-111111111111",
              startedAtMs: Date.parse("2026-08-26T00:00:00.000Z"),
              transcriptFilename: "11111111-1111-4111-8111-111111111111.jsonl"
            }]
          }
        }
      })}\n`,
      { mode: 0o600 }
    );

    const result = spawnSync(process.execPath, [
      script,
      "--state-dir", value.stateDir,
      "--vimicate-dir", value.vimicateDir,
      "--stable-session-key", key,
      "--segment-file", current
    ], { encoding: "utf8" });

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /not a contiguous subset/);
  } finally {
    await fs.rm(value.root, { recursive: true, force: true });
  }
});
