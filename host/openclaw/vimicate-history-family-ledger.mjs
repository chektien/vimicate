import crypto from "node:crypto";
import fsNative from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";

import { VIMICATE_ARCHIVED_FAMILY_PROOF } from
  "./vimicate-history-family-contract.mjs";
import { openClawHistoryFamilyHostFiles } from
  "./vimicate-history-family-openclaw.mjs";
import { repairWitnessedChain } from "./vimicate-history-family-chain-repair.mjs";

const MAX_LEDGER_BYTES = 1024 * 1024;
const MAX_TRANSCRIPT_BYTES = 256 * 1024 * 1024;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SESSION_KEY_PATTERN = /^agent:([A-Za-z0-9_-]+):[^\r\n]+$/;
const ARCHIVE_TIMESTAMP_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}(?:\.\d{3})?Z$/;
const ACCEPTED_END_REASONS = new Set([
  "new",
  "reset",
  "idle",
  "daily",
  "compaction",
  "replacement"
]);

function fail(message) {
  throw new Error(`vimicate archived-family writer: ${message}`);
}

function requireUUID(value, label) {
  if (typeof value !== "string" || !UUID_PATTERN.test(value.trim())) {
    fail(`${label} is not a UUID`);
  }
  return value.trim().toLowerCase();
}

function requireSessionKey(value) {
  if (typeof value !== "string") fail("sessionKey is required");
  const sessionKey = value.trim();
  const match = SESSION_KEY_PATTERN.exec(sessionKey);
  if (!match) fail("sessionKey is invalid");
  return { sessionKey, agentId: match[1] };
}

function requireInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 1) fail(`${label} is invalid`);
  return value;
}

function transcriptFilename(sessionId, rawPath, state, endReason) {
  if (typeof rawPath !== "string" || rawPath.length === 0) {
    fail(`${state} transcript path is required`);
  }
  const filename = path.basename(rawPath);
  const plainCurrent = `${sessionId}.jsonl`;
  const topicPrefix = `${sessionId}-topic-`;
  const resetMarker = ".jsonl.reset.";
  const resetIndex = filename.indexOf(resetMarker);
  const current = resetIndex >= 0
    ? filename.slice(0, resetIndex + ".jsonl".length)
    : filename;
  const topicSlug = current.startsWith(topicPrefix) && current.endsWith(".jsonl")
    ? current.slice(topicPrefix.length, -".jsonl".length)
    : "";
  if (current !== plainCurrent
      && !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(topicSlug)) {
    fail(`${state} transcript filename is not canonical`);
  }
  const archivedPrefix = `${current}.reset.`;
  if (state === "current" && filename !== current) {
    fail(`${state} transcript filename is not canonical`);
  }
  if (state === "archived" && filename === current) {
    if (endReason !== "compaction") {
      fail("only compaction may retain an unrenamed closed transcript");
    }
    return filename;
  }
  if (state === "archived" && !filename.startsWith(archivedPrefix)) {
    fail(`${state} transcript filename is not canonical`);
  }
  if (state === "archived") {
    const timestamp = filename.slice(archivedPrefix.length);
    const [datePart, timePart] = timestamp.split("T");
    const restored = datePart && timePart
      ? `${datePart}T${timePart.replace(/-/g, ":")}`
      : "";
    if (!ARCHIVE_TIMESTAMP_PATTERN.test(timestamp)
        || Number.isNaN(Date.parse(restored))) {
      fail("archived transcript timestamp is not canonical");
    }
  }
  return filename;
}

function isCanonicalCurrentTranscript(sessionId, filename) {
  try {
    return transcriptFilename(sessionId, filename, "current") === filename;
  } catch {
    return false;
  }
}

function fixedChild(directory, filename) {
  const candidate = path.resolve(directory, filename);
  if (path.dirname(candidate) !== path.resolve(directory)) {
    fail("transcript escaped its fixed sessions directory");
  }
  return candidate;
}

function fileIdentity(stat) {
  return [stat.dev, stat.ino, stat.size, stat.mtimeNs, stat.ctimeNs].join(":");
}

function directoryIdentity(stat) {
  return [stat.dev, stat.ino].join(":");
}

async function openNoFollow(file, flags = fsNative.constants.O_RDONLY, mode) {
  try {
    return await fs.open(file, flags | fsNative.constants.O_NOFOLLOW, mode);
  } catch {
    fail(`${path.basename(file)} could not be opened without following links`);
  }
}

async function readBoundedJSON(file, maximumBytes) {
  const handle = await openNoFollow(file);
  try {
    const before = await handle.stat({ bigint: true });
    if (!before.isFile() || before.size < 1n || before.size > BigInt(maximumBytes)) {
      fail(`${path.basename(file)} is not a bounded regular file`);
    }
    const bytes = await handle.readFile();
    const after = await handle.stat({ bigint: true });
    if (fileIdentity(before) !== fileIdentity(after)) {
      fail(`${path.basename(file)} changed while reading`);
    }
    const pathStat = await fs.lstat(file, { bigint: true });
    if (pathStat.isSymbolicLink() || fileIdentity(pathStat) !== fileIdentity(after)) {
      fail(`${path.basename(file)} changed fixed-path identity`);
    }
    return {
      identity: fileIdentity(after),
      value: JSON.parse(bytes.toString("utf8"))
    };
  } catch (error) {
    if (error instanceof SyntaxError) fail(`${path.basename(file)} is not valid JSON`);
    throw error;
  } finally {
    await handle.close();
  }
}

async function hashTranscript(file, label, requiredMode) {
  const handle = await openNoFollow(file);
  try {
    const before = await handle.stat({ bigint: true });
    if (!before.isFile() || before.size > BigInt(MAX_TRANSCRIPT_BYTES)) {
      fail(`${label} transcript is not a bounded regular file`);
    }
    if (requiredMode != null
        && (Number(before.mode) & 0o777) !== requiredMode) {
      fail(`${label} transcript does not have its required private mode`);
    }
    const hash = crypto.createHash("sha256");
    let byteLength = 0;
    await new Promise((resolve, reject) => {
      const stream = handle.createReadStream({ autoClose: false });
      stream.on("data", (chunk) => {
        byteLength += chunk.byteLength;
        if (byteLength > MAX_TRANSCRIPT_BYTES) {
          stream.destroy(new Error(`${label} transcript exceeded its bound`));
          return;
        }
        hash.update(chunk);
      });
      stream.on("error", reject);
      stream.on("end", resolve);
    });
    const after = await handle.stat({ bigint: true });
    if (fileIdentity(before) !== fileIdentity(after)
        || BigInt(byteLength) !== after.size) {
      fail(`${label} transcript changed while hashing`);
    }
    const pathStat = await fs.lstat(file, { bigint: true });
    if (pathStat.isSymbolicLink() || fileIdentity(pathStat) !== fileIdentity(after)) {
      fail(`${label} transcript changed fixed-path identity`);
    }
    return { sourceRevision: hash.digest("hex"), byteLength };
  } finally {
    await handle.close();
  }
}

async function syncDirectory(directory) {
  const handle = await fs.open(directory, fsNative.constants.O_RDONLY);
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function copyClosedTranscript(source, destination, assertOwnedDirectory) {
  await assertOwnedDirectory();
  const directory = path.dirname(destination);
  const temporary = path.join(
    directory,
    `.${path.basename(destination)}.${process.pid}.`
      + `${crypto.randomBytes(8).toString("hex")}.tmp`
  );
  const sourceHandle = await openNoFollow(source);
  let targetHandle;
  let published = false;
  let sourceRevision;
  let byteLength = 0;
  try {
    const before = await sourceHandle.stat({ bigint: true });
    if (!before.isFile() || before.size > BigInt(MAX_TRANSCRIPT_BYTES)) {
      fail("closed transcript is not a bounded regular file");
    }
    targetHandle = await openNoFollow(
      temporary,
      fsNative.constants.O_WRONLY | fsNative.constants.O_CREAT | fsNative.constants.O_EXCL,
      0o600
    );
    const hash = crypto.createHash("sha256");
    for await (const chunk of sourceHandle.createReadStream({ autoClose: false })) {
      byteLength += chunk.byteLength;
      if (byteLength > MAX_TRANSCRIPT_BYTES) {
        fail("closed transcript exceeded its bound while being retained");
      }
      hash.update(chunk);
      let offset = 0;
      while (offset < chunk.byteLength) {
        const { bytesWritten } = await targetHandle.write(
          chunk,
          offset,
          chunk.byteLength - offset
        );
        if (bytesWritten < 1) fail("owned transcript copy stopped making progress");
        offset += bytesWritten;
      }
    }
    const after = await sourceHandle.stat({ bigint: true });
    if (fileIdentity(before) !== fileIdentity(after)
        || BigInt(byteLength) !== after.size) {
      fail("closed transcript changed while being retained");
    }
    const pathStat = await fs.lstat(source, { bigint: true });
    if (pathStat.isSymbolicLink() || fileIdentity(pathStat) !== fileIdentity(after)) {
      fail("closed transcript changed fixed-path identity");
    }
    sourceRevision = hash.digest("hex");
    await targetHandle.sync();
    await targetHandle.close();
    targetHandle = undefined;
    await assertOwnedDirectory();
    try {
      await fs.link(temporary, destination);
      published = true;
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
    }
  } finally {
    if (targetHandle) await targetHandle.close().catch(() => {});
    await sourceHandle.close().catch(() => {});
    await fs.rm(temporary, { force: true }).catch(() => {});
  }

  await assertOwnedDirectory();
  const retained = await hashTranscript(destination, "owned", 0o600);
  if (retained.sourceRevision !== sourceRevision
      || retained.byteLength !== byteLength) {
    fail("owned transcript disagrees with the closed source");
  }
  if (published) await syncDirectory(directory);
  return retained.sourceRevision;
}

function validateLedgerEnvelope(ledger) {
  if (ledger?.schemaVersion !== 1
      || ledger?.proof !== VIMICATE_ARCHIVED_FAMILY_PROOF
      || ledger?.families == null
      || typeof ledger.families !== "object"
      || Array.isArray(ledger.families)) {
    fail("ledger schema or proof is invalid");
  }
  return ledger;
}

function validatedFamily(ledger, sessionKey, agentId) {
  const family = ledger.families[sessionKey];
  if (family == null) return null;
  if (family.agentId !== agentId || !Array.isArray(family.segments)
      || family.segments.length < 1 || family.segments.length > 1024) {
    fail("tracked family is malformed");
  }
  return family;
}

function normalizeEndReason(reason) {
  const normalized = reason === "unknown" ? "replacement" : reason;
  if (!ACCEPTED_END_REASONS.has(normalized)) {
    fail(`session_end reason ${JSON.stringify(reason)} is not a lineage transition`);
  }
  return normalized;
}

function archiveTimestamp(startedAtMs) {
  return new Date(startedAtMs).toISOString().replace(/:/g, "-");
}

async function sessionsDirectory(stateDir, agentId, pins) {
  const chain = [
    stateDir,
    path.join(stateDir, "agents"),
    path.join(stateDir, "agents", agentId),
    path.join(stateDir, "agents", agentId, "sessions")
  ];
  const identities = [];
  for (const directory of chain) {
    const stat = await fs.lstat(directory, { bigint: true });
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      fail("OpenClaw sessions directory chain is not fixed");
    }
    identities.push(directoryIdentity(stat));
  }
  const prior = pins.get(agentId);
  if (prior && identities.some((identity, index) => identity !== prior[index])) {
    fail("OpenClaw sessions directory chain identity changed");
  }
  if (!prior) pins.set(agentId, identities);
  return chain.at(-1);
}

async function readCurrentAuthority(
  stateDir,
  sessionKey,
  agentId,
  pins,
  allowMissing = false
) {
  const directory = await sessionsDirectory(stateDir, agentId, pins);
  const { value: store } = await readBoundedJSON(
    path.join(directory, "sessions.json"),
    64 * 1024 * 1024
  );
  const entry = store?.[sessionKey];
  if (!entry) {
    if (allowMissing) return null;
    fail("session store does not own the stable session key");
  }
  const sessionId = requireUUID(entry.sessionId, "current sessionId");
  const startedAtMs = requireInteger(entry.sessionStartedAt, "current start epoch");
  const filename = transcriptFilename(sessionId, entry.sessionFile, "current");
  const resolved = path.resolve(entry.sessionFile);
  if (resolved !== fixedChild(directory, filename)) {
    fail("current transcript escaped its sessions directory");
  }
  await sessionsDirectory(stateDir, agentId, pins);
  return { directory, sessionId, startedAtMs, transcriptFilename: filename };
}

async function readSuccessor(stateDir, sessionKey, agentId, nextSessionId, pins) {
  const current = await readCurrentAuthority(
    stateDir,
    sessionKey,
    agentId,
    pins
  );
  if (!current) fail("session store does not own the stable session key");
  if (current.sessionId !== nextSessionId) {
    fail("session store does not own the declared successor");
  }
  return current;
}

async function assertLedgerUnchanged(file, expectedIdentity) {
  const stat = await fs.lstat(file, { bigint: true });
  if (stat.isSymbolicLink() || fileIdentity(stat) !== expectedIdentity) {
    fail("ledger changed before atomic commit");
  }
}

async function atomicWriteLedger(file, ledger, expectedIdentity, assertDirectory, beforeCommit = async () => {}) {
  const bytes = Buffer.from(`${JSON.stringify(ledger, null, 2)}\n`, "utf8");
  if (bytes.byteLength > MAX_LEDGER_BYTES) fail("updated ledger exceeds its bound");
  await assertDirectory();
  await assertLedgerUnchanged(file, expectedIdentity);
  const directory = path.dirname(file);
  const temporary = path.join(
    directory,
    `.${path.basename(file)}.${process.pid}.${crypto.randomBytes(8).toString("hex")}.tmp`
  );
  let handle;
  try {
    handle = await openNoFollow(
      temporary,
      fsNative.constants.O_WRONLY | fsNative.constants.O_CREAT | fsNative.constants.O_EXCL,
      0o600
    );
    await handle.writeFile(bytes);
    await handle.sync();
    await handle.close();
    handle = null;
    await assertDirectory();
    await beforeCommit();
    await assertLedgerUnchanged(file, expectedIdentity);
    await fs.rename(temporary, file);
    await fs.chmod(file, 0o600);
    await assertDirectory();
    const directoryHandle = await fs.open(directory, fsNative.constants.O_RDONLY);
    try {
      await directoryHandle.sync();
    } finally {
      await directoryHandle.close();
    }
  } finally {
    if (handle) await handle.close().catch(() => {});
    await fs.rm(temporary, { force: true }).catch(() => {});
  }
}

function cloneJSON(value) {
  return JSON.parse(JSON.stringify(value));
}

export function createOpenClawHistoryFamilyLedgerWriter({ stateDir, vimicateDir }) {
  if (typeof stateDir !== "string" || !path.isAbsolute(stateDir)
      || typeof vimicateDir !== "string" || !path.isAbsolute(vimicateDir)) {
    fail("stateDir and vimicateDir must be absolute paths");
  }
  const ledgerFile = path.join(vimicateDir, openClawHistoryFamilyHostFiles.ledger);
  const ownedTranscriptsDir = path.join(
    vimicateDir,
    openClawHistoryFamilyHostFiles.ownedTranscripts
  );
  const sessionPins = new Map();
  const observedCurrents = new Map();
  let vimicateDirectoryIdentity;
  let ownedDirectoryIdentity;
  let queue = Promise.resolve();

  async function assertVimicateDirectory() {
    const stat = await fs.lstat(vimicateDir, { bigint: true });
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      fail("Vimicate host directory is not fixed");
    }
    const identity = directoryIdentity(stat);
    if (vimicateDirectoryIdentity && vimicateDirectoryIdentity !== identity) {
      fail("Vimicate host directory identity changed");
    }
    vimicateDirectoryIdentity ??= identity;
  }

  async function assertOwnedDirectory(create = true) {
    await assertVimicateDirectory();
    if (create) {
      try {
        await fs.mkdir(ownedTranscriptsDir, { mode: 0o700 });
      } catch (error) {
        if (error?.code !== "EEXIST") throw error;
      }
    }
    const stat = await fs.lstat(ownedTranscriptsDir, { bigint: true });
    if (!stat.isDirectory() || stat.isSymbolicLink()
        || (Number(stat.mode) & 0o777) !== 0o700) {
      fail("owned transcript directory is not a fixed private directory");
    }
    const identity = directoryIdentity(stat);
    if (ownedDirectoryIdentity && ownedDirectoryIdentity !== identity) {
      fail("owned transcript directory identity changed");
    }
    ownedDirectoryIdentity ??= identity;
  }

  function ownedTranscriptPath(sessionId) {
    return fixedChild(ownedTranscriptsDir, `${sessionId}.jsonl`);
  }

  async function probe() {
    await assertVimicateDirectory();
    await assertOwnedDirectory();
    const { value } = await readBoundedJSON(ledgerFile, MAX_LEDGER_BYTES);
    const ledger = validateLedgerEnvelope(value);
    observedCurrents.clear();
    for (const sessionKey of Object.keys(ledger.families)) {
      const { agentId } = requireSessionKey(sessionKey);
      const family = validatedFamily(ledger, sessionKey, agentId);
      const tail = family?.segments.at(-1);
      let current;
      try {
        current = await readCurrentAuthority(
          stateDir,
          sessionKey,
          agentId,
          sessionPins,
          true
        );
      } catch {
        // Observation is auxiliary to the canonical family audit. An absent
        // or quarantined current row must not disable healthy families.
        continue;
      }
      if (current && tail?.sessionId === current.sessionId
          && tail?.startedAtMs === current.startedAtMs
          && tail?.transcriptFilename === current.transcriptFilename
          && tail?.endedAtMs == null
          && tail?.endReason == null) {
        observedCurrents.set(sessionKey, current.sessionId);
      }
    }
    return { contract: "session-end-ledger-v1", trackedFamilies: Object.keys(value.families).length };
  }

  async function commitTransition({
    read,
    ledger,
    family,
    sessionKey,
    agentId,
    closedSessionId,
    nextSessionId,
    endReason,
    archivedFilename,
    archivedPath,
    successor
  }) {
    const tail = family.segments.at(-1);
    if (tail?.sessionId === nextSessionId) {
      const prior = family.segments.at(-2);
      if (prior?.sessionId !== closedSessionId
          || prior?.transcriptFilename !== archivedFilename
          || prior?.endReason !== endReason
          || tail?.startedAtMs !== successor.startedAtMs
          || tail?.transcriptFilename !== successor.transcriptFilename) {
        fail("duplicate transition disagrees with the committed lineage");
      }
      const retained = await hashTranscript(
        ownedTranscriptPath(closedSessionId),
        "owned",
        0o600
      );
      if (retained.sourceRevision !== prior.sourceRevision) {
        fail("duplicate transition owned transcript revision changed");
      }
      observedCurrents.set(sessionKey, nextSessionId);
      return { status: "unchanged", sessionKey, nextSessionId };
    }
    if (tail?.sessionId !== closedSessionId
        || !isCanonicalCurrentTranscript(closedSessionId, tail?.transcriptFilename)
        || tail?.endedAtMs != null || tail?.endReason != null) {
      fail("tracked family tail does not match the closing session");
    }
    const priorStartedAtMs = requireInteger(tail.startedAtMs, "closed start epoch");
    if (successor.startedAtMs <= priorStartedAtMs) {
      fail("successor epoch does not advance lineage");
    }
    const sourceRevision = await copyClosedTranscript(
      archivedPath,
      ownedTranscriptPath(closedSessionId),
      assertOwnedDirectory
    );
    const confirmed = await readSuccessor(
      stateDir,
      sessionKey,
      agentId,
      nextSessionId,
      sessionPins
    );
    if (confirmed.startedAtMs !== successor.startedAtMs
        || confirmed.transcriptFilename !== successor.transcriptFilename) {
      fail("successor changed while retaining the closed transcript");
    }
    const endedAtMs = Math.max(
      priorStartedAtMs + 1,
      Math.min(Date.now(), successor.startedAtMs)
    );
    const updated = cloneJSON(ledger);
    const updatedFamily = updated.families[sessionKey];
    updatedFamily.segments[updatedFamily.segments.length - 1] = {
      sessionId: closedSessionId,
      startedAtMs: priorStartedAtMs,
      endedAtMs,
      endReason,
      sourceRevision,
      transcriptFilename: archivedFilename
    };
    updatedFamily.segments.push({
      sessionId: nextSessionId,
      startedAtMs: successor.startedAtMs,
      transcriptFilename: successor.transcriptFilename
    });
    if (updatedFamily.segments.length > 1024) fail("tracked family exceeds segment bound");
    await atomicWriteLedger(
      ledgerFile,
      updated,
      read.identity,
      assertVimicateDirectory
    );
    observedCurrents.set(sessionKey, nextSessionId);
    return { status: "appended", sessionKey, closedSessionId, nextSessionId };
  }

  async function record(event, context = {}) {
    const nextSessionIdRaw = event?.nextSessionId;
    const { sessionKey, agentId } = requireSessionKey(
      event?.sessionKey ?? context?.sessionKey
    );
    await assertVimicateDirectory();
    const read = await readBoundedJSON(ledgerFile, MAX_LEDGER_BYTES);
    const ledger = validateLedgerEnvelope(read.value);
    const family = validatedFamily(ledger, sessionKey, agentId);
    if (!family) return { status: "ignored-untracked" };
    await assertOwnedDirectory();

    if (nextSessionIdRaw == null) {
      if (["shutdown", "restart", "deleted"].includes(event?.reason)) {
        return { status: "ignored-terminal" };
      }
      fail("tracked lifecycle transition is missing its successor");
    }

    if (context?.agentId != null && context.agentId !== agentId) {
      fail("session_end agent authority disagrees with sessionKey");
    }
    if (event?.nextSessionKey != null && event.nextSessionKey !== sessionKey) {
      fail("session_end successor changed stable session key");
    }
    const closedSessionId = requireUUID(event?.sessionId, "closed sessionId");
    const nextSessionId = requireUUID(nextSessionIdRaw, "next sessionId");
    const endReason = normalizeEndReason(event?.reason);
    const tail = family.segments.at(-1);
    if (closedSessionId === nextSessionId) {
      if (endReason !== "compaction" || event?.transcriptArchived === true) {
        fail("successor repeats the closed sessionId");
      }
      if (tail?.sessionId !== closedSessionId
          || !isCanonicalCurrentTranscript(closedSessionId, tail?.transcriptFilename)
          || tail?.endedAtMs != null || tail?.endReason != null) {
        fail("same-session compaction disagrees with the tracked family tail");
      }
      return { status: "ignored-same-session-compaction", sessionKey, nextSessionId };
    }
    const successor = await readSuccessor(
      stateDir,
      sessionKey,
      agentId,
      nextSessionId,
      sessionPins
    );
    const archivedFilename = transcriptFilename(
      closedSessionId,
      event?.sessionFile,
      "archived",
      endReason
    );
    const archivedPath = path.resolve(event.sessionFile);
    if (archivedPath !== fixedChild(successor.directory, archivedFilename)) {
      fail("closed transcript escaped its sessions directory");
    }

    return commitTransition({
      read,
      ledger,
      family,
      sessionKey,
      agentId,
      closedSessionId,
      nextSessionId,
      endReason,
      archivedFilename,
      archivedPath,
      successor
    });
  }

  async function repairExactReplacement({
    stableSessionKey,
    previousSessionId,
    currentSessionId
  }) {
    const { sessionKey, agentId } = requireSessionKey(stableSessionKey);
    const closedSessionId = requireUUID(previousSessionId, "previous sessionId");
    const nextSessionId = requireUUID(currentSessionId, "current sessionId");
    if (closedSessionId === nextSessionId) {
      return { status: "unchanged", sessionKey, nextSessionId };
    }
    await assertVimicateDirectory();
    const read = await readBoundedJSON(ledgerFile, MAX_LEDGER_BYTES);
    const ledger = validateLedgerEnvelope(read.value);
    const family = validatedFamily(ledger, sessionKey, agentId);
    if (!family) return { status: "ignored-untracked" };
    await assertOwnedDirectory();
    const successor = await readSuccessor(
      stateDir,
      sessionKey,
      agentId,
      nextSessionId,
      sessionPins
    );
    const tail = family.segments.at(-1);
    const currentFilename = transcriptFilename(
      closedSessionId,
      tail?.transcriptFilename,
      "current"
    );
    const archivedFilename = transcriptFilename(
      closedSessionId,
      `${currentFilename}.reset.${archiveTimestamp(successor.startedAtMs)}`,
      "archived",
      "replacement"
    );
    return commitTransition({
      read,
      ledger,
      family,
      sessionKey,
      agentId,
      closedSessionId,
      nextSessionId,
      endReason: "replacement",
      archivedFilename,
      archivedPath: fixedChild(successor.directory, currentFilename),
      successor
    });
  }

  async function observeCurrent(event, context = {}) {
    const sessionKey = event?.sessionKey ?? context?.sessionKey;
    const observed = typeof sessionKey === "string"
      ? observedCurrents.get(sessionKey)
      : undefined;
    if (!observed) return { status: "ignored-unobserved" };
    const currentSessionId = requireUUID(
      event?.sessionId ?? context?.sessionId,
      "observed sessionId"
    );
    if (observed === currentSessionId) {
      return { status: "unchanged", sessionKey, nextSessionId: currentSessionId };
    }
    if (context?.agentId != null
        && requireSessionKey(sessionKey).agentId !== context.agentId) {
      fail("model observation agent authority disagrees with sessionKey");
    }
    return repairExactReplacement({
      stableSessionKey: sessionKey,
      previousSessionId: observed,
      currentSessionId
    });
  }

  return {
    probe,
    record(event, context) {
      const operation = queue.then(() => record(event, context));
      queue = operation.catch(() => {});
      return operation;
    },
    repairExactReplacement(request) {
      const operation = queue.then(() => repairExactReplacement(request));
      queue = operation.catch(() => {});
      return operation;
    },
    repairWitnessedChain(request, assertOffline) {
      const operation = queue.then(() => repairWitnessedChain(request, assertOffline, {
        vimicateDir,
        async snapshot(request) {
          const { sessionKey, agentId } = requireSessionKey(request.stableSessionKey);
          await assertVimicateDirectory();
          const read = await readBoundedJSON(ledgerFile, MAX_LEDGER_BYTES);
          const ledger = validateLedgerEnvelope(read.value);
          const family = validatedFamily(ledger, sessionKey, agentId);
          if (!family) fail("repair requires an audited family");
          const current = await readSuccessor(stateDir, sessionKey, agentId,
            requireUUID(request.sessionIds?.at(-1), "current sessionId"), sessionPins);
          return { read, ledger, family, current, sessionKey, agentId };
        },
        hashSource: file => hashTranscript(file, "source"),
        hashOwned: async id => {
          await assertOwnedDirectory(false);
          return hashTranscript(ownedTranscriptPath(id), "owned", 0o600);
        },
        retain: (file, id) => copyClosedTranscript(file, ownedTranscriptPath(id), assertOwnedDirectory),
        commit: (updated, identity, revalidate) => atomicWriteLedger(ledgerFile, updated, identity,
          assertVimicateDirectory, revalidate)
      }));
      queue = operation.catch(() => {});
      return operation;
    },
    observeCurrent(event, context) {
      const operation = queue.then(() => observeCurrent(event, context));
      queue = operation.catch(() => {});
      return operation;
    }
  };
}

export const openClawHistoryFamilyLedgerContract = Object.freeze({
  contract: "session-end-ledger-v1",
  acceptedEndReasons: [...ACCEPTED_END_REASONS]
});
