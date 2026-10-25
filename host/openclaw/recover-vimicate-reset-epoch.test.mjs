import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import { recoverResetEpoch } from "./recover-vimicate-reset-epoch.mjs";
import { VIMICATE_ARCHIVED_FAMILY_PROOF } from "./vimicate-history-family-contract.mjs";
import { requireStoppedGateway, parseArguments } from "./recover-vimicate-reset-epoch-cli.mjs";

const stableSessionKey = "agent:main:direct:vimicate-ios:project:epoch-fixture";
const previousSessionId = "11111111-1111-4111-8111-111111111111";
const currentSessionId = "22222222-2222-4222-8222-222222222222";
const timestamp = "2026-08-29T04:44:11.915Z";
const epoch = Date.parse(timestamp);

async function fixture(t) {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "vimicate-reset-epoch-")));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const stateDir = path.join(root, "openclaw"), vimicateDir = path.join(root, "vimicate");
  const sessionsDir = path.join(stateDir, "agents/main/sessions");
  await fs.mkdir(sessionsDir, { recursive: true });
  await fs.mkdir(vimicateDir, { mode: 0o700 });
  const currentFile = path.join(sessionsDir, `${currentSessionId}.jsonl`);
  const archivedFile = path.join(sessionsDir,
    `${previousSessionId}.jsonl.reset.${timestamp.replaceAll(":", "-")}`);
  const header = (id, date) => JSON.stringify({ type: "session", version: 3, id, timestamp: date }) + "\n";
  await fs.writeFile(currentFile, header(currentSessionId, timestamp) + '{"type":"message"}\n', { mode: 0o600 });
  await fs.writeFile(archivedFile, header(previousSessionId, "2026-08-27T22:32:28.116Z"), { mode: 0o600 });
  const storeFile = path.join(sessionsDir, "sessions.json");
  const store = { [stableSessionKey]: {
    sessionId: currentSessionId, sessionFile: currentFile, updatedAt: epoch + 90000,
    label: "unchanged label", model: "unchanged model", customMetadata: { preserve: true }
  }, "agent:main:unrelated": { sessionId: previousSessionId, updatedAt: epoch - 1000, label: "untouched" } };
  await fs.writeFile(storeFile, JSON.stringify(store), { mode: 0o600 });
  const ledgerFile = path.join(vimicateDir, "openclaw-history-families.json");
  await fs.writeFile(ledgerFile, JSON.stringify({ schemaVersion: 1, proof: VIMICATE_ARCHIVED_FAMILY_PROOF,
    families: { [stableSessionKey]: { agentId: "main", segments: [{ sessionId: previousSessionId,
      startedAtMs: epoch - 100000, transcriptFilename: `${previousSessionId}.jsonl` }] } }
  }), { mode: 0o600 });
  const options = { stateDir, vimicateDir, stableSessionKey, previousSessionId, currentSessionId, archivedFile, apply: true };
  const dependencies = {
    assertOffline: async () => {},
    updateSessionStore: async (file, update) => {
      const data = JSON.parse(await fs.readFile(file, "utf8"));
      const result = await update(data);
      if (result !== "unchanged") await fs.writeFile(file, JSON.stringify(data), { mode: 0o600 });
      return result;
    }
  };
  return { root, options, dependencies, store, storeFile, ledgerFile, currentFile, archivedFile };
}

test("an exact missed reset restores only its immutable epoch and retains the predecessor", async (t) => {
  const f = await fixture(t);
  const result = await recoverResetEpoch(f.options, f.dependencies);
  assert.equal(result.status, "appended");
  const store = JSON.parse(await fs.readFile(f.storeFile, "utf8"));
  assert.deepEqual(store, { ...f.store, [stableSessionKey]: { ...f.store[stableSessionKey], sessionStartedAt: epoch } });
  const family = JSON.parse(await fs.readFile(f.ledgerFile, "utf8")).families[stableSessionKey];
  assert.equal(family.segments.length, 2);
  assert.equal(family.segments[1].startedAtMs, epoch);
  assert.equal(await fs.readFile(path.join(f.options.vimicateDir, "openclaw-history-family-owned", `${previousSessionId}.jsonl`), "utf8"), await fs.readFile(f.archivedFile, "utf8"));
  assert.equal((await recoverResetEpoch(f.options, f.dependencies)).status, "unchanged");
  assert.equal((await fs.stat(result.backupDirectory)).mode & 0o777, 0o700);
  const backup = JSON.parse(await fs.readFile(path.join(result.backupDirectory, "session-entry.json"), "utf8"));
  assert.deepEqual(backup.entry, f.store[stableSessionKey]);
  assert.equal((await fs.stat(path.join(result.backupDirectory, "session-entry.json"))).mode & 0o777, 0o600);
});

async function editJSON(file, mutate) {
  const value = JSON.parse(await fs.readFile(file, "utf8"));
  mutate(value);
  await fs.writeFile(file, JSON.stringify(value));
}

test("dry run validates proof without a writer, backup or state mutation", async (t) => {
  const f = await fixture(t);
  const before = await fs.readFile(f.storeFile, "utf8");
  assert.deepEqual(await recoverResetEpoch({ ...f.options, apply: false }), {
    status: "dry-run", epoch, alreadyCommitted: false
  });
  assert.equal(await fs.readFile(f.storeFile, "utf8"), before);
  assert.deepEqual(await fs.readdir(f.options.vimicateDir), ["openclaw-history-families.json"]);
});

const invalidCases = {
  "rebound current identity": (f) => editJSON(f.storeFile, (s) => { s[stableSessionKey].sessionId = previousSessionId; }),
  "foreign current path": (f) => editJSON(f.storeFile, (s) => { s[stableSessionKey].sessionFile = f.archivedFile; }),
  "conflicting existing epoch": (f) => editJSON(f.storeFile, (s) => { s[stableSessionKey].sessionStartedAt = epoch + 1; }),
  "explicit null epoch": (f) => editJSON(f.storeFile, (s) => { s[stableSessionKey].sessionStartedAt = null; }),
  "missing current entry": (f) => editJSON(f.storeFile, (s) => { delete s[stableSessionKey]; }),
  "untracked family": (f) => editJSON(f.ledgerFile, (s) => { delete s.families[stableSessionKey]; }),
  "wrong audited tail": (f) => editJSON(f.ledgerFile, (s) => { s.families[stableSessionKey].segments[0].sessionId = currentSessionId; }),
  "closed predecessor": (f) => editJSON(f.ledgerFile, (s) => { s.families[stableSessionKey].segments[0].endedAtMs = epoch; }),
  "nonadvancing epoch": (f) => editJSON(f.ledgerFile, (s) => { s.families[stableSessionKey].segments[0].startedAtMs = epoch; }),
  "wrong current header": (f) => fs.writeFile(f.currentFile, JSON.stringify({ type: "session", id: previousSessionId, timestamp }) + "\n"),
  "wrong archived header": (f) => fs.writeFile(f.archivedFile, JSON.stringify({ type: "session", id: currentSessionId, timestamp }) + "\n"),
  "noncanonical timestamp": (f) => fs.writeFile(f.currentFile, JSON.stringify({ type: "session", id: currentSessionId, timestamp: "2026-08-29" }) + "\n"),
  "unbounded header": (f) => fs.writeFile(f.currentFile, "x".repeat(256 * 1024 + 1) + "\n"),
  "missing exact archive": (f) => fs.rename(f.archivedFile, f.archivedFile.replace("11.915", "11.916")),
  "ambiguous archives": (f) => fs.copyFile(f.archivedFile, f.archivedFile.replace("11.915", "11.916")),
  "unrenamed predecessor": (f) => fs.copyFile(f.archivedFile, path.join(path.dirname(f.archivedFile), `${previousSessionId}.jsonl`)),
  "hardlinked transcript": (f) => fs.link(f.currentFile, path.join(f.root, "alias")),
  "symlink transcript": async (f) => { await fs.rename(f.currentFile, f.currentFile + ".real"); await fs.symlink(f.currentFile + ".real", f.currentFile); },
  "symlink state ancestor": async (f) => { const actual = f.options.stateDir; const alias = path.join(f.root, "alias"); await fs.symlink(actual, alias); f.options.stateDir = alias; },
};
for (const [label, mutate] of Object.entries(invalidCases)) {
  test(`refuses ${label} without changing session state or ledger`, async (t) => {
    const f = await fixture(t);
    await mutate(f);
    const store = await fs.readFile(f.storeFile, "utf8"), ledger = await fs.readFile(f.ledgerFile, "utf8");
    await assert.rejects(recoverResetEpoch(f.options, f.dependencies));
    assert.equal(await fs.readFile(f.storeFile, "utf8"), store);
    assert.equal(await fs.readFile(f.ledgerFile, "utf8"), ledger);
  });
}

test("refuses absent or failed offline authority before using a store writer", async (t) => {
  const f = await fixture(t);
  await assert.rejects(recoverResetEpoch(f.options), /offline maintenance proof/);
  await assert.rejects(recoverResetEpoch(f.options, { ...f.dependencies,
    assertOffline: async () => { throw new Error("Gateway is running"); },
    updateSessionStore: async () => assert.fail("writer must not run")
  }), /Gateway is running/);
});

test("rechecks proof and current generation inside the store writer", async (t) => {
  const f = await fixture(t);
  await assert.rejects(recoverResetEpoch(f.options, { ...f.dependencies,
    updateSessionStore: async (file, update, options) => {
      await editJSON(f.storeFile, (s) => { s[stableSessionKey].sessionId = previousSessionId; });
      return f.dependencies.updateSessionStore(file, update, options);
    }
  }), /current session authority changed/);
  assert.equal(JSON.parse(await fs.readFile(f.storeFile, "utf8"))[stableSessionKey].sessionStartedAt, undefined);
});

test("changed archive proof cannot reach the epoch commit", async (t) => {
  const f = await fixture(t);
  await assert.rejects(recoverResetEpoch(f.options, { ...f.dependencies,
    updateSessionStore: async (file, update, options) => {
      await fs.writeFile(f.archivedFile, JSON.stringify({ type: "session", id: previousSessionId, timestamp: "2026-08-27T22:32:28.117Z" }) + "\n");
      return f.dependencies.updateSessionStore(file, update, options);
    }
  }), /reset proof changed/);
  assert.equal(JSON.parse(await fs.readFile(f.storeFile, "utf8"))[stableSessionKey].sessionStartedAt, undefined);
});

test("a stopped maintenance attempt after epoch restoration resumes idempotently", async (t) => {
  const f = await fixture(t);
  let checks = 0;
  await assert.rejects(recoverResetEpoch(f.options, { ...f.dependencies,
    assertOffline: async () => { if (++checks === 3) throw new Error("maintenance ended"); }
  }), /maintenance ended/);
  assert.equal(JSON.parse(await fs.readFile(f.storeFile, "utf8"))[stableSessionKey].sessionStartedAt, epoch);
  assert.equal(JSON.parse(await fs.readFile(f.ledgerFile, "utf8")).families[stableSessionKey].segments.length, 1);
  const result = await recoverResetEpoch(f.options, f.dependencies);
  assert.equal(result.status, "appended");
  assert.equal(result.epochRestored, false);
});

test("OpenClaw's real maintenance writer preserves activity and unrelated metadata", {
  skip: !process.env.VIMICATE_OPENCLAW_SDK_FILE
}, async (t) => {
  const f = await fixture(t);
  const { updateSessionStore } = await import(pathToFileURL(process.env.VIMICATE_OPENCLAW_SDK_FILE).href);
  await recoverResetEpoch(f.options, { ...f.dependencies, updateSessionStore });
  assert.deepEqual(JSON.parse(await fs.readFile(f.storeFile, "utf8")), {
    ...f.store, [stableSessionKey]: { ...f.store[stableSessionKey], sessionStartedAt: epoch }
  });
  const bytes = await fs.readFile(f.storeFile, "utf8");
  assert.equal((await recoverResetEpoch(f.options, { ...f.dependencies, updateSessionStore })).status, "unchanged");
  assert.equal(await fs.readFile(f.storeFile, "utf8"), bytes);
});

test("maintenance CLI requires both an unloaded service and an unoccupied Gateway port", () => {
  const stopped = { service: { loaded: false, runtime: { status: "stopped" } }, port: { status: "free", listeners: [] } };
  assert.doesNotThrow(() => requireStoppedGateway(stopped));
  assert.throws(() => requireStoppedGateway(stopped, "/state"));
  assert.doesNotThrow(() => requireStoppedGateway({ ...stopped,
    config: { daemon: { path: "/state/openclaw.json" } } }, "/state"));
  assert.throws(() => requireStoppedGateway({ ...stopped,
    config: { daemon: { path: "/other/openclaw.json" } } }, "/state"));
  for (const state of [undefined, {}, { ...stopped, service: { loaded: true } },
    { ...stopped, service: { loaded: false, runtime: { pid: 123 } } },
    { ...stopped, service: { loaded: false, runtime: { status: "running" } } },
    { ...stopped, port: { status: "busy", listeners: [] } },
    { ...stopped, port: { status: "free", listeners: [{ pid: 123 }] } },
    { ...stopped, port: { status: "free" } }]) assert.throws(() => requireStoppedGateway(state));
});

test("maintenance CLI requires explicit mode, paths and exact identities", () => {
  const args = ["--state-dir", "/state", "--vimicate-dir", "/vimicate", "--stable-session-key", stableSessionKey,
    "--previous-session-id", previousSessionId, "--current-session-id", currentSessionId, "--openclaw-root", "/package"];
  assert.equal(parseArguments([...args, "--dry-run"]).apply, false);
  assert.equal(parseArguments([...args, "--apply"]).apply, true);
  assert.throws(() => parseArguments(args));
  assert.throws(() => parseArguments([...args, "--dry-run", "--apply"]));
  assert.throws(() => parseArguments([...args, "--apply", "--unverified", "true"]));
  assert.throws(() => parseArguments(["--apply"]));
});
