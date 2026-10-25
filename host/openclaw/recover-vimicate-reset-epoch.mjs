import crypto from "node:crypto";
import fsNative from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { createOpenClawHistoryFamilyLedgerWriter } from
  "./vimicate-history-family-ledger.mjs";
import { VIMICATE_ARCHIVED_FAMILY_PROOF } from "./vimicate-history-family-contract.mjs";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const MAX_HEADER_BYTES = 256 * 1024;
const identity = (stat) => [stat.dev, stat.ino, stat.size, stat.mtimeNs, stat.ctimeNs].join(":");
const digest = (bytes) => crypto.createHash("sha256").update(bytes).digest("hex");
function fail(message) { throw new Error(`vimicate reset-epoch recovery: ${message}`); }

async function fixedDirectory(directory) {
  const resolved = path.resolve(directory);
  const stat = await fs.lstat(resolved);
  if (!stat.isDirectory() || stat.isSymbolicLink() || await fs.realpath(resolved) !== resolved) {
    fail("directory is not canonical and fixed");
  }
  return `${resolved}:${stat.dev}:${stat.ino}`;
}

async function readFixed(file, maximumBytes, headerOnly = false) {
  const handle = await fs.open(file, fsNative.constants.O_RDONLY | fsNative.constants.O_NOFOLLOW);
  try {
    const before = await handle.stat({ bigint: true });
    if (!before.isFile() || before.nlink !== 1n || before.size < 1n
        || before.uid !== BigInt(process.getuid())
        || (!headerOnly && before.size > BigInt(maximumBytes))) fail("file is not bounded and owned");
    const bytes = Buffer.alloc(Number(before.size < BigInt(maximumBytes + 1) ? before.size : BigInt(maximumBytes + 1)));
    let offset = 0;
    while (offset < bytes.length) {
      const { bytesRead } = await handle.read(bytes, offset, bytes.length - offset, offset);
      if (!bytesRead) break;
      offset += bytesRead;
    }
    const after = await handle.stat({ bigint: true });
    const fixed = await fs.lstat(file, { bigint: true });
    if (offset !== bytes.length || identity(before) !== identity(after)
        || identity(after) !== identity(fixed) || fixed.isSymbolicLink()) fail("file changed during validation");
    if (!headerOnly) return bytes;
    const end = bytes.indexOf(10);
    if (end < 1 || end > maximumBytes) fail("session header is not bounded");
    return bytes.subarray(0, end);
  } finally { await handle.close(); }
}

async function header(file, id) {
  const bytes = await readFixed(file, MAX_HEADER_BYTES, true);
  const value = JSON.parse(bytes);
  const epoch = typeof value.timestamp === "string" ? Date.parse(value.timestamp) : NaN;
  if (value.type !== "session" || value.id !== id || !Number.isSafeInteger(epoch)
      || epoch <= 0 || new Date(epoch).toISOString() !== value.timestamp) fail("session header identity/epoch is invalid");
  return { epoch, timestamp: value.timestamp, hash: digest(bytes) };
}

function requireCurrent(entry, plan) {
  if (entry?.sessionId !== plan.currentSessionId || entry?.sessionFile !== plan.currentFile) {
    fail("current session authority changed");
  }
  if (Object.hasOwn(entry, "sessionStartedAt") && entry.sessionStartedAt !== plan.epoch) {
    fail("existing epoch conflicts with the exact reset proof");
  }
}

export async function inspectResetEpochRecovery(options) {
  const { stateDir, vimicateDir, stableSessionKey, previousSessionId, currentSessionId } = options;
  const match = /^agent:([A-Za-z0-9_-]+):[^\r\n]+$/.exec(stableSessionKey ?? "");
  if (!match || !UUID.test(previousSessionId) || !UUID.test(currentSessionId)
      || previousSessionId === currentSessionId) fail("explicit distinct session identities are required");
  const agentId = match[1];
  const sessionsDir = path.resolve(stateDir, "agents", agentId, "sessions");
  const pins = await Promise.all([fixedDirectory(stateDir), fixedDirectory(sessionsDir), fixedDirectory(vimicateDir)]);
  const storeFile = path.join(sessionsDir, "sessions.json");
  const ledgerFile = path.resolve(vimicateDir, "openclaw-history-families.json");
  const ledgerBytes = await readFixed(ledgerFile, 1024 * 1024);
  const ledger = JSON.parse(ledgerBytes);
  if (ledger.schemaVersion !== 1 || ledger.proof !== VIMICATE_ARCHIVED_FAMILY_PROOF) fail("ledger schema is invalid");
  const family = ledger.families?.[stableSessionKey];
  if (family?.agentId !== agentId || !Array.isArray(family.segments)) fail("family is not audited");
  const tail = family.segments.at(-1);
  const alreadyCommitted = tail?.sessionId === currentSessionId;
  const previous = alreadyCommitted ? family.segments.at(-2) : tail;
  if (previous?.sessionId !== previousSessionId) fail("predecessor is not the exact audited tail");
  const currentFile = path.join(sessionsDir, `${currentSessionId}.jsonl`);
  const currentHeader = await header(currentFile, currentSessionId);
  const archivedFilename = `${previousSessionId}.jsonl.reset.${currentHeader.timestamp.replaceAll(":", "-")}`;
  const candidates = (await fs.readdir(sessionsDir)).filter((name) => name === `${previousSessionId}.jsonl`
    || name.startsWith(`${previousSessionId}.jsonl.reset.`));
  if (candidates.length !== 1 || candidates[0] !== archivedFilename) fail("reset archive is missing or ambiguous");
  const archivedFile = path.join(sessionsDir, archivedFilename);
  const previousHeader = await header(archivedFile, previousSessionId);
  if (!Number.isSafeInteger(previous.startedAtMs) || previous.startedAtMs <= 0
      || previous.startedAtMs >= currentHeader.epoch || previousHeader.epoch >= currentHeader.epoch) {
    fail("reset epochs do not advance");
  }
  if (alreadyCommitted) {
    if (tail.startedAtMs !== currentHeader.epoch || tail.transcriptFilename !== `${currentSessionId}.jsonl`
        || tail.endedAtMs != null || tail.endReason != null
        || previous.transcriptFilename !== archivedFilename || previous.endReason !== "reset"
        || previous.endedAtMs !== currentHeader.epoch) fail("committed lineage conflicts with exact reset proof");
  } else if (previous.transcriptFilename !== `${previousSessionId}.jsonl`
      || previous.endedAtMs != null || previous.endReason != null) fail("predecessor is already closed");
  const entry = JSON.parse(await readFixed(storeFile, 64 * 1024 * 1024))[stableSessionKey];
  const plan = { stableSessionKey, previousSessionId, currentSessionId, currentFile, archivedFile,
    epoch: currentHeader.epoch, storeFile, ledgerFile, ledgerBytes, entry, alreadyCommitted,
    proof: JSON.stringify({ pins, currentHeader, previousHeader, ledger: digest(ledgerBytes) }) };
  requireCurrent(entry, plan);
  return plan;
}

// Explicit maintenance only. The SDK queue is process-local, not an interprocess
// lock: the caller must prove the Gateway stopped before every write boundary.
// This is not loaded by the plugin and never runs as an automatic fallback.
export async function recoverResetEpoch(options, dependencies = {}) {
  const plan = await inspectResetEpochRecovery(options);
  if (options.apply !== true) return { status: "dry-run", epoch: plan.epoch, alreadyCommitted: plan.alreadyCommitted };
  const { assertOffline, updateSessionStore } = dependencies;
  if (typeof assertOffline !== "function" || typeof updateSessionStore !== "function") {
    fail("offline maintenance proof and the OpenClaw store writer are required");
  }
  await assertOffline();
  let backupDirectory, epochRestored = false;
  await updateSessionStore(plan.storeFile, async (store) => {
    await assertOffline();
    const confirmed = await inspectResetEpochRecovery(options);
    if (confirmed.proof !== plan.proof) fail("reset proof changed before commit");
    const entry = store[options.stableSessionKey];
    requireCurrent(entry, plan);
    if (!plan.alreadyCommitted) {
      backupDirectory = await fs.mkdtemp(path.join(options.vimicateDir, "reset-epoch-recovery-"));
      await fs.chmod(backupDirectory, 0o700);
      await fs.writeFile(path.join(backupDirectory, "session-entry.json"), JSON.stringify({
        stableSessionKey: options.stableSessionKey, entry
      }) + "\n", { mode: 0o600, flag: "wx" });
      await fs.writeFile(path.join(backupDirectory, "history-families.json"), plan.ledgerBytes, { mode: 0o600, flag: "wx" });
    }
    if (Object.hasOwn(entry, "sessionStartedAt")) return "unchanged";
    entry.sessionStartedAt = plan.epoch;
    epochRestored = true;
    return "restored";
  }, { skipMaintenance: true, requireWriteSuccess: true,
    skipSaveWhenResult: (result) => result === "unchanged" });
  await assertOffline();
  // A failure after restoring the epoch is resumable: the existing ledger writer
  // validates/copies the exact predecessor and handles a repeated append itself.
  const result = await createOpenClawHistoryFamilyLedgerWriter(options).record({
    sessionKey: options.stableSessionKey,
    sessionId: options.previousSessionId,
    nextSessionId: options.currentSessionId,
    nextSessionKey: options.stableSessionKey,
    reason: "reset",
    transcriptArchived: true,
    sessionFile: plan.archivedFile
  });
  return { ...result, epoch: plan.epoch, epochRestored, backupDirectory };
}
