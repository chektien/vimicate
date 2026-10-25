#!/usr/bin/env node

import crypto from "node:crypto";
import fsNative from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";

const MAX_FAMILY_BYTES = 256 * 1024 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const PROOF = "audited-baseline+contiguous-ledger-v1";

function fail(message) {
  throw new Error(`vimicate history-family bootstrap: ${message}`);
}

function parseArguments(argv) {
  const result = { agentId: "main", segmentFiles: [], dryRun: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--state-dir") result.stateDir = argv[++index];
    else if (argument === "--vimicate-dir") result.vimicateDir = argv[++index];
    else if (argument === "--stable-session-key") result.stableSessionKey = argv[++index];
    else if (argument === "--agent-id") result.agentId = argv[++index];
    else if (argument === "--segment-file") result.segmentFiles.push(argv[++index]);
    else if (argument === "--dry-run") result.dryRun = true;
    else fail(`unknown argument ${JSON.stringify(argument)}`);
  }
  if (!result.stateDir || !result.vimicateDir || !result.stableSessionKey) {
    fail("--state-dir, --vimicate-dir, and --stable-session-key are required");
  }
  if (result.segmentFiles.length < 1) {
    fail("at least one current segment is required");
  }
  const prefix = `agent:${result.agentId}:`;
  if (!result.stableSessionKey.startsWith(prefix)) {
    fail("stable session key disagrees with agent id");
  }
  return result;
}

async function requireFixedDirectory(directory, label, mode) {
  const stat = await fs.lstat(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink()) fail(`${label} is not a fixed directory`);
  if (mode != null && (stat.mode & 0o777) !== mode) fail(`${label} must use mode ${mode.toString(8)}`);
  return path.resolve(directory);
}

async function readNoFollow(file, label, maximumBytes = MAX_FAMILY_BYTES) {
  let handle;
  try {
    handle = await fs.open(file, fsNative.constants.O_RDONLY | fsNative.constants.O_NOFOLLOW);
    const before = await handle.stat();
    if (!before.isFile() || before.size < 1 || before.size > maximumBytes) {
      fail(`${label} is not a bounded regular file`);
    }
    const bytes = await handle.readFile();
    const after = await handle.stat();
    if (before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size
        || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs) {
      fail(`${label} changed while it was read`);
    }
    return bytes;
  } finally {
    await handle?.close();
  }
}

async function readJSONNoFollow(file, label, maximumBytes) {
  let value;
  try {
    value = JSON.parse((await readNoFollow(file, label, maximumBytes)).toString("utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") throw error;
    if (String(error?.message ?? error).startsWith("vimicate history-family bootstrap:")) throw error;
    fail(`${label} is not valid JSON`);
  }
  return value;
}

function segmentIdentity(file, bytes, isCurrent) {
  const filename = path.basename(file);
  const match = filename.match(
    /^([0-9a-f-]{36})(?:-topic-([A-Za-z0-9][A-Za-z0-9_-]{0,127}))?\.jsonl(?:\.reset\.(.+Z))?$/
  );
  if (!match || !UUID.test(match[1])) fail(`segment filename is invalid: ${filename}`);
  if (isCurrent !== (match[3] == null)) {
    fail(isCurrent ? "current segment must use its live .jsonl" : "archived segment must be a reset transcript");
  }
  const newline = bytes.indexOf(0x0a);
  if (newline < 1 || newline > 256 * 1024) fail(`segment header is missing: ${filename}`);
  let header;
  try {
    header = JSON.parse(bytes.subarray(0, newline).toString("utf8"));
  } catch {
    fail(`segment header is invalid JSON: ${filename}`);
  }
  if (header?.id !== match[1] || header?.type !== "session") {
    fail(`segment header identity disagrees with filename: ${filename}`);
  }
  const startedAtMs = Date.parse(header.timestamp);
  if (!Number.isSafeInteger(startedAtMs) || startedAtMs < 1) {
    fail(`segment start timestamp is invalid: ${filename}`);
  }
  return {
    sessionId: match[1],
    startedAtMs,
    transcriptFilename: filename,
    bytes,
    sourceRevision: crypto.createHash("sha256").update(bytes).digest("hex")
  };
}

async function atomicWrite(file, bytes, mode) {
  const temporary = path.join(
    path.dirname(file),
    `.${path.basename(file)}.${process.pid}.${crypto.randomBytes(8).toString("hex")}.tmp`
  );
  let handle;
  try {
    handle = await fs.open(
      temporary,
      fsNative.constants.O_WRONLY | fsNative.constants.O_CREAT | fsNative.constants.O_EXCL,
      mode
    );
    await handle.writeFile(bytes);
    await handle.sync();
    await handle.close();
    handle = undefined;
    await fs.rename(temporary, file);
    await fs.chmod(file, mode);
  } finally {
    await handle?.close();
    await fs.rm(temporary, { force: true });
  }
}

async function ensureOwnedCopy(ownedDirectory, segment) {
  const destination = path.join(ownedDirectory, `${segment.sessionId}.jsonl`);
  try {
    const existing = await readNoFollow(destination, "existing owned transcript");
    const revision = crypto.createHash("sha256").update(existing).digest("hex");
    if (revision !== segment.sourceRevision) fail("existing owned transcript disagrees with audited source");
    return;
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  await atomicWrite(destination, segment.bytes, 0o600);
}

async function ensureSecret(vimicateDirectory, dryRun) {
  const file = path.join(vimicateDirectory, "openclaw-history-family-hmac.key");
  try {
    const bytes = await readNoFollow(file, "history-family secret", 256);
    const stat = await fs.lstat(file);
    if ((stat.mode & 0o777) !== 0o600 || !/^[0-9a-f]{64}\n?$/.test(bytes.toString("utf8"))) {
      fail("history-family secret is malformed or not mode 600");
    }
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
    if (!dryRun) await atomicWrite(file, `${crypto.randomBytes(32).toString("hex")}\n`, 0o600);
  }
}

function isCurrentLedgerSegment(segment) {
  return segment != null
    && segment.endedAtMs == null
    && segment.endReason == null
    && segment.sourceRevision == null;
}

function auditedFamilyExpandsExisting(existing, audited) {
  if (existing?.agentId !== audited.agentId
      || !Array.isArray(existing?.segments)
      || existing.segments.length < 1
      || !Array.isArray(audited?.segments)) return false;
  const firstSessionId = existing.segments[0]?.sessionId;
  const start = audited.segments.findIndex(
    (segment) => segment?.sessionId === firstSessionId
  );
  if (start < 0 || start + existing.segments.length > audited.segments.length) {
    return false;
  }
  for (let index = 0; index < existing.segments.length; index += 1) {
    const prior = existing.segments[index];
    const next = audited.segments[start + index];
    if (JSON.stringify(prior) === JSON.stringify(next)) continue;
    const isFormerTail = index === existing.segments.length - 1;
    if (!isFormerTail
        || !isCurrentLedgerSegment(prior)
        || next?.sessionId !== prior.sessionId
        || next?.startedAtMs !== prior.startedAtMs
        || next?.endedAtMs == null
        || next?.endReason == null
        || next?.sourceRevision == null) return false;
  }
  return true;
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const stateDirectory = await requireFixedDirectory(options.stateDir, "OpenClaw state directory");
  const vimicateDirectory = await requireFixedDirectory(options.vimicateDir, "Vimicate directory");
  const sessionsDirectory = await requireFixedDirectory(
    path.join(stateDirectory, "agents", options.agentId, "sessions"),
    "OpenClaw sessions directory"
  );
  const ownedDirectory = await requireFixedDirectory(
    path.join(vimicateDirectory, "openclaw-history-family-owned"),
    "owned transcript directory",
    0o700
  );

  const segments = [];
  let aggregateBytes = 0;
  for (const [index, rawFile] of options.segmentFiles.entries()) {
    const file = path.resolve(rawFile);
    if (path.dirname(file) !== sessionsDirectory) fail("segment escaped the fixed sessions directory");
    const bytes = await readNoFollow(file, `segment ${index + 1}`);
    aggregateBytes += bytes.length;
    if (aggregateBytes > MAX_FAMILY_BYTES) fail("audited family exceeds 256 MiB");
    segments.push(segmentIdentity(file, bytes, index === options.segmentFiles.length - 1));
  }
  if (new Set(segments.map((segment) => segment.sessionId)).size !== segments.length) {
    fail("audited family repeats a session id");
  }
  for (let index = 1; index < segments.length; index += 1) {
    if (segments[index].startedAtMs <= segments[index - 1].startedAtMs) {
      fail("audited family start epochs are not increasing");
    }
  }

  const storeFile = path.join(sessionsDirectory, "sessions.json");
  const store = await readJSONNoFollow(storeFile, "OpenClaw session store", 64 * 1024 * 1024);
  const authority = store[options.stableSessionKey];
  const current = segments.at(-1);
  if (authority?.sessionId !== current.sessionId
      || path.resolve(authority?.sessionFile ?? "") !== options.segmentFiles.at(-1)) {
    fail("current OpenClaw session authority disagrees with audited tail");
  }
  const predecessor = segments.at(-2);
  if (!Number.isSafeInteger(authority.sessionStartedAt)
      || (predecessor && authority.sessionStartedAt <= predecessor.startedAtMs)
      || Math.abs(authority.sessionStartedAt - current.startedAtMs) > 60_000) {
    fail("current OpenClaw session epoch disagrees with audited tail header");
  }
  // OpenClaw records the route generation immediately before writing the
  // JSONL session header. Runtime requests carry this store-owned epoch, so it
  // is the exact current-generation authority the ledger must publish.
  current.startedAtMs = authority.sessionStartedAt;

  const ledgerFile = path.join(vimicateDirectory, "openclaw-history-families.json");
  let ledger = { schemaVersion: 1, proof: PROOF, families: {} };
  try {
    ledger = await readJSONNoFollow(ledgerFile, "history-family ledger", 1024 * 1024);
    if (ledger?.schemaVersion !== 1 || ledger?.proof !== PROOF
        || typeof ledger?.families !== "object" || Array.isArray(ledger.families)) {
      fail("existing history-family ledger has the wrong schema");
    }
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  const existingFamily = ledger.families[options.stableSessionKey];
  for (const prior of existingFamily?.segments ?? []) {
    const segment = segments.find((candidate) => candidate.sessionId === prior.sessionId);
    if (!segment) continue;
    if (Math.abs(segment.startedAtMs - prior.startedAtMs) > 60_000) {
      fail("existing audited segment epoch disagrees with the expanded source");
    }
    // The first audit records OpenClaw's store-owned route epoch, while a
    // later trajectory reconstruction begins at the first persisted event.
    // Preserve the already-audited epoch when both identify the same concrete
    // session within the host's accepted 60-second creation window.
    segment.startedAtMs = prior.startedAtMs;
  }
  for (let index = 1; index < segments.length; index += 1) {
    if (segments[index].startedAtMs <= segments[index - 1].startedAtMs) {
      fail("expanded family epochs are not increasing after authority normalization");
    }
  }
  const ledgerSegments = segments.map((segment, index) => index === segments.length - 1 ? {
    sessionId: segment.sessionId,
    startedAtMs: segment.startedAtMs,
    transcriptFilename: segment.transcriptFilename
  } : {
    sessionId: segment.sessionId,
    startedAtMs: segment.startedAtMs,
    endedAtMs: segments[index + 1].startedAtMs,
    endReason: "reset",
    sourceRevision: segment.sourceRevision,
    transcriptFilename: segment.transcriptFilename
  });
  const auditedFamily = { agentId: options.agentId, segments: ledgerSegments };
  if (existingFamily
      && JSON.stringify(existingFamily) !== JSON.stringify(auditedFamily)
      && !auditedFamilyExpandsExisting(existingFamily, auditedFamily)) {
    fail("existing audited family is not a contiguous subset; refusing replacement");
  }

  if (!options.dryRun) {
    for (const segment of segments.slice(0, -1)) await ensureOwnedCopy(ownedDirectory, segment);
    await ensureSecret(vimicateDirectory, false);
    ledger.families[options.stableSessionKey] = auditedFamily;
    await atomicWrite(ledgerFile, `${JSON.stringify(ledger)}\n`, 0o600);
  } else {
    await ensureSecret(vimicateDirectory, true);
  }
  process.stdout.write(`${JSON.stringify({
    dryRun: options.dryRun,
    stableSessionKey: options.stableSessionKey,
    archivedSegments: segments.length - 1,
    currentSessionId: current.sessionId,
    aggregateBytes
  })}\n`);
}

await main();
