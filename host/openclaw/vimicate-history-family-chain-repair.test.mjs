import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createOpenClawHistoryFamilyLedgerWriter } from "./vimicate-history-family-ledger.mjs";
import { VIMICATE_ARCHIVED_FAMILY_PROOF } from "./vimicate-history-family-contract.mjs";
import crypto from "node:crypto";
import { loadOpenClawHistoryFamilyContract } from "./vimicate-history-family-openclaw.mjs";

const key = "agent:main:direct:vimicate-ios:project:chain-fixture";
const ids = ["11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222",
  "33333333-3333-4333-8333-333333333333"];
const epochs = [1787917645945, 1787947500697, 1788033900064];
const iso = (epoch) => new Date(epoch).toISOString();

async function fixture(t) {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "vimicate-chain-")));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const stateDir = path.join(root, "state"), vimicateDir = path.join(root, "vimicate");
  const sessionsDir = path.join(stateDir, "agents/main/sessions");
  await fs.mkdir(sessionsDir, { recursive: true });
  await fs.mkdir(vimicateDir, { mode: 0o700 });
  const sourceFiles = ids.map(id => path.join(sessionsDir, `${id}.jsonl`));
  for (const [index, file] of sourceFiles.entries()) {
    await fs.writeFile(file, JSON.stringify({ type: "session", id: ids[index],
      timestamp: iso(epochs[index] + (index === 2 ? 609 : 0)) }) + "\n" +
      JSON.stringify({ type: "message", text: `distinct generation ${index}` }) + "\n", { mode: 0o600 });
  }
  const storeFile = path.join(sessionsDir, "sessions.json");
  await fs.writeFile(storeFile, JSON.stringify({ [key]: { sessionId: ids[2],
    sessionStartedAt: epochs[2], sessionFile: sourceFiles[2], updatedAt: epochs[2] + 999999 },
    unrelated: { preserve: "every field" } }), { mode: 0o600 });
  const ledgerFile = path.join(vimicateDir, "openclaw-history-families.json");
  await fs.writeFile(ledgerFile, JSON.stringify({ schemaVersion: 1,
    proof: VIMICATE_ARCHIVED_FAMILY_PROOF, families: { [key]: { agentId: "main",
      segments: [{ sessionId: ids[0], startedAtMs: epochs[0], transcriptFilename: `${ids[0]}.jsonl` }] },
      unrelated: { preserve: "unchanged" } } }), { mode: 0o600 });
  // Concrete authority comes from each record, never the trajectory filename.
  const trajectory = path.join(sessionsDir, `${ids[0]}.trajectory.jsonl`);
  const records = ids.map((sessionId, index) => ({ traceSchema: "openclaw-trajectory", schemaVersion: 1,
    type: "session.started", sessionId, sessionKey: key, ts: iso(epochs[index] + 1) }));
  await fs.writeFile(trajectory, records.map(r => JSON.stringify(r)).join("\n") + "\n", { mode: 0o600 });
  return { stateDir, vimicateDir, sessionsDir, sourceFiles, ledgerFile, storeFile, trajectory, records,
    writer: createOpenClawHistoryFamilyLedgerWriter({ stateDir, vimicateDir }),
    request: { stableSessionKey: key, sessionIds: ids, apply: true } };
}

test("offline recovery retains every missed generation in one append without changing the store", async t => {
  const f = await fixture(t), storeBefore = await fs.readFile(f.storeFile);
  let checks = 0;
  const result = await f.writer.repairWitnessedChain(f.request, async () => { checks++; });
  assert.equal(result.status, "appended");
  assert.ok(checks >= 3);
  const ledger = JSON.parse(await fs.readFile(f.ledgerFile));
  assert.deepEqual(ledger.families.unrelated, { preserve: "unchanged" });
  const segments = ledger.families[key].segments;
  assert.deepEqual(segments.map(s => s.sessionId), ids);
  assert.deepEqual(segments.map(s => s.startedAtMs), epochs);
  assert.deepEqual(segments.slice(0, -1).map(s => s.endedAtMs), epochs.slice(1));
  assert.deepEqual(await fs.readFile(f.storeFile), storeBefore);
  for (const [index, id] of ids.slice(0, -1).entries()) {
    const owned = path.join(f.vimicateDir, "openclaw-history-family-owned", `${id}.jsonl`);
    assert.deepEqual(await fs.readFile(owned), await fs.readFile(f.sourceFiles[index]));
    assert.equal((await fs.stat(owned)).mode & 0o777, 0o600);
  }
  assert.equal((await fs.stat(result.backupDirectory)).mode & 0o777, 0o700);
  assert.equal((await f.writer.repairWitnessedChain(f.request, async () => {})).status, "unchanged");
});

test("a direct old-to-current shortcut cannot skip a witnessed intermediate", async t => {
  const f = await fixture(t), before = await fs.readFile(f.ledgerFile);
  await assert.rejects(f.writer.repairWitnessedChain({ ...f.request, sessionIds: [ids[0], ids[2]] },
    async () => {}), /witness.*complete|missing.*generation/);
  assert.deepEqual(await fs.readFile(f.ledgerFile), before);
});

test("a hash-verified audited prefix does not require already-retired trajectory records", async t => {
  const f = await fixture(t), priorId = "00000000-0000-4000-8000-000000000001";
  const ownedDir = path.join(f.vimicateDir, "openclaw-history-family-owned");
  await fs.mkdir(ownedDir, { mode: 0o700 });
  const bytes = Buffer.from("audited prior archive\n");
  await fs.writeFile(path.join(ownedDir, `${priorId}.jsonl`), bytes, { mode: 0o600 });
  const prior = { sessionId: priorId, startedAtMs: epochs[0] - 10000, endedAtMs: epochs[0],
    endReason: "daily", sourceRevision: crypto.createHash("sha256").update(bytes).digest("hex"),
    transcriptFilename: `${priorId}.jsonl.reset.${iso(epochs[0]).replaceAll(":", "-")}` };
  const ledger = JSON.parse(await fs.readFile(f.ledgerFile));
  ledger.families[key].segments.unshift(prior);
  await fs.writeFile(f.ledgerFile, JSON.stringify(ledger));
  assert.equal((await f.writer.repairWitnessedChain(f.request, async () => {})).status, "appended");
  assert.deepEqual(JSON.parse(await fs.readFile(f.ledgerFile)).families[key].segments[0], prior);
  await fs.appendFile(path.join(ownedDir, `${priorId}.jsonl`), "tampered\n");
  await assert.rejects(f.writer.repairWitnessedChain(f.request, async () => {}), /revision changed/);
});

test("dry run writes neither copies, backups nor a changed ledger", async t => {
  const f = await fixture(t), before = await fs.readFile(f.ledgerFile);
  const result = await f.writer.repairWitnessedChain({ ...f.request, apply: false });
  assert.equal(result.status, "dry-run");
  assert.deepEqual(await fs.readFile(f.ledgerFile), before);
  assert.deepEqual(await fs.readdir(f.vimicateDir), ["openclaw-history-families.json"]);
});

test("a prior audited segment keeps its exact metadata and revision and all pages remain distinct", async t => {
  const f = await fixture(t), priorId = "00000000-0000-4000-8000-000000000001";
  const ownedDir = path.join(f.vimicateDir, "openclaw-history-family-owned");
  await fs.mkdir(ownedDir, { mode: 0o700 });
  const bytes = Buffer.from("distinct prior generation\n");
  await fs.writeFile(path.join(ownedDir, `${priorId}.jsonl`), bytes, { mode: 0o600 });
  const prior = { sessionId: priorId, startedAtMs: epochs[0] - 10000, endedAtMs: epochs[0],
    endReason: "daily", sourceRevision: crypto.createHash("sha256").update(bytes).digest("hex"),
    transcriptFilename: `${priorId}.jsonl.reset.${iso(epochs[0]).replaceAll(":", "-")}` };
  const ledger = JSON.parse(await fs.readFile(f.ledgerFile));
  ledger.families[key].segments.unshift(prior);
  await fs.writeFile(f.ledgerFile, JSON.stringify(ledger));
  await fs.appendFile(f.trajectory, JSON.stringify({ ...f.records[0], sessionId: priorId,
    ts: iso(epochs[0] - 9999) }) + "\n");
  await f.writer.repairWitnessedChain(f.request, async () => {});
  assert.deepEqual(JSON.parse(await fs.readFile(f.ledgerFile)).families[key].segments[0], prior);
  await fs.writeFile(path.join(f.vimicateDir, "openclaw-history-family-hmac.key"), "ab".repeat(32) + "\n", { mode: 0o600 });
  const contract = await loadOpenClawHistoryFamilyContract({ ...f,
    readProjectedHistoryPage: async request => ({ sessionId: request.sessionId,
      sessionKey: request.stableSessionKey, transcriptFilename: request.transcriptFilename,
      offset: request.offset, hasMore: false, totalMessages: 1,
      messages: [{ role: "assistant", content: await fs.readFile(request.sessionFile, "utf8") }] }) });
  const base = { contract: "archived-family-v1", stableSessionKey: key,
    expectedCurrentSessionId: ids[2], expectedCurrentSessionStartedAtMs: epochs[2] };
  const census = await contract({ ...base, mode: "segments", cursor: 0, limit: 8 });
  assert.deepEqual(census.segments.map(s => s.sessionId), [priorId, ...ids]);
  const contents = [];
  for (const segment of census.segments) {
    const page = await contract({ ...base, mode: "page", familyToken: census.familyToken,
      sessionId: segment.sessionId, segmentOrder: segment.order, sourceRevision: segment.sourceRevision,
      offset: 0, limit: 8 });
    contents.push(page.messages[0].content);
  }
  assert.equal(new Set(contents).size, 4);
});

for (const [name, mutate, pattern] of [
  ["reordered generations", async f => { f.request.sessionIds = [ids[0], ids[2], ids[1]]; }, /successor/],
  ["unwitnessed generation", async f => { await fs.writeFile(f.trajectory, f.records.filter(r => r.sessionId !== ids[1]).map(JSON.stringify).join("\n") + "\n"); }, /complete/],
  ["body mention is not ownership", async f => { f.records[1].sessionKey = "other"; f.records[1].type = "message"; f.records[1].data = { text: key }; await fs.writeFile(f.trajectory, f.records.map(JSON.stringify).join("\n") + "\n"); }, /complete/],
  ["foreign route reuses concrete ID", async f => { await fs.appendFile(f.trajectory, JSON.stringify({ ...f.records[1], sessionKey: "other" }) + "\n"); }, /conflicting route/],
  ["no session-start witness", async f => { f.records[1].type = "message"; await fs.writeFile(f.trajectory, f.records.map(JSON.stringify).join("\n") + "\n"); }, /strictly ordered/],
  ["overlapping generations", async f => { await fs.appendFile(f.trajectory, JSON.stringify({ ...f.records[0], type: "message", ts: iso(epochs[1] + 20) }) + "\n"); }, /strictly ordered/],
  ["conflicting header ID", async f => { await fs.writeFile(f.sourceFiles[1], JSON.stringify({ type: "session", id: ids[0], timestamp: iso(epochs[1]) }) + "\n"); }, /header identity/],
  ["header epoch not backed by start witness", async f => { await fs.writeFile(f.sourceFiles[1], JSON.stringify({ type: "session", id: ids[1], timestamp: iso(epochs[1] + 61000) }) + "\n"); }, /strictly ordered/],
  ["partial trajectory record", async f => { await fs.appendFile(f.trajectory, "{\"incomplete\":"); }, /incomplete/],
  ["malformed record", async f => { await fs.appendFile(f.trajectory, "not json\n"); }, /JSON/],
  ["trajectory hardlink", async f => { await fs.link(f.trajectory, path.join(f.sessionsDir, "duplicate.trajectory.jsonl")); }, /bounded owned/],
  ["source symlink", async f => { await fs.rename(f.sourceFiles[1], f.sourceFiles[1] + ".saved"); await fs.symlink(f.sourceFiles[1] + ".saved", f.sourceFiles[1]); }, /ELOOP/],
  ["oversized trajectory", async f => { await fs.truncate(f.trajectory, 64 * 1024 * 1024 + 1); }, /bounded owned/],
  ["duplicate declared ID", async f => { f.request.sessionIds = [ids[0], ids[0], ids[2]]; }, /distinct/]
]) {
  test(`refuses ${name} without changing the ledger`, async t => {
    const f = await fixture(t), before = await fs.readFile(f.ledgerFile);
    await mutate(f);
    await assert.rejects(f.writer.repairWitnessedChain(f.request, async () => {}), pattern);
    assert.deepEqual(await fs.readFile(f.ledgerFile), before);
  });
}

for (const boundary of ["trajectory", "ledger", "current epoch"]) {
  test(`rejects a changed ${boundary} after retaining a predecessor`, async t => {
    const f = await fixture(t);
    let checks = 0, expected = await fs.readFile(f.ledgerFile);
    await assert.rejects(f.writer.repairWitnessedChain(f.request, async () => {
      if (++checks !== 4) return;
      if (boundary === "trajectory") await fs.appendFile(f.trajectory, JSON.stringify({ ...f.records[2], type: "message" }) + "\n");
      if (boundary === "ledger") {
        const ledger = JSON.parse(expected); ledger.families.unrelated.preserve = "newer write";
        expected = Buffer.from(JSON.stringify(ledger)); await fs.writeFile(f.ledgerFile, expected);
      }
      if (boundary === "current epoch") {
        const store = JSON.parse(await fs.readFile(f.storeFile)); store[key].sessionStartedAt++;
        await fs.writeFile(f.storeFile, JSON.stringify(store));
      }
    }), /changed before commit/);
    assert.deepEqual(await fs.readFile(f.ledgerFile), expected);
  });
}

test("requires offline proof and resumes safely after a stopped partial retention", async t => {
  const f = await fixture(t), before = await fs.readFile(f.ledgerFile);
  await assert.rejects(f.writer.repairWitnessedChain(f.request), /offline/);
  let checks = 0;
  await assert.rejects(f.writer.repairWitnessedChain(f.request, async () => {
    if (++checks === 4) throw new Error("Gateway restarted");
  }), /Gateway restarted/);
  assert.deepEqual(await fs.readFile(f.ledgerFile), before);
  assert.equal((await f.writer.repairWitnessedChain(f.request, async () => {})).status, "appended");
});
