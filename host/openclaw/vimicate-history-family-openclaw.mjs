import crypto from "node:crypto";
import fsNative from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";

import { createVimicateHistoryFamilyContract } from
  "./vimicate-history-family-contract.mjs";

const LEDGER_FILENAME = "openclaw-history-families.json";
const SECRET_FILENAME = "openclaw-history-family-hmac.key";
const OWNED_TRANSCRIPTS_DIRECTORY = "openclaw-history-family-owned";
const MAX_LEDGER_BYTES = 1024 * 1024;
const MAX_TRANSCRIPT_BYTES = 512 * 1024 * 1024;
const MAX_REVISION_CACHE_ENTRIES = 2048;
const MAX_CONCURRENT_TRANSCRIPT_HASHES = 2;
const MAX_PENDING_TRANSCRIPT_HASHES = 64;

function hostError(message, failureKind = "integrity") {
  const error = new Error(`vimicate archived-family host: ${message}`);
  error.vimicateHistoryFamilyFailureKind = failureKind;
  return error;
}

function fail(message, failureKind = "integrity") {
  throw hostError(message, failureKind);
}

async function openReadOnlyNoFollow(file) {
  try {
    return await fs.open(
      file,
      fsNative.constants.O_RDONLY | fsNative.constants.O_NOFOLLOW
    );
  } catch {
    fail(`${path.basename(file)} could not be opened as a non-symlink file`);
  }
}

function statIdentity(stat) {
  return [stat.dev, stat.ino, stat.size, stat.mtimeNs, stat.ctimeNs].join(":");
}

function directoryIdentity(stat) {
  return [stat.dev, stat.ino].join(":");
}

async function openedFileIdentity(file, maximumBytes, minimumBytes = 0) {
  const handle = await openReadOnlyNoFollow(file);
  try {
    const stat = await handle.stat({ bigint: true });
    if (!stat.isFile()
        || stat.size < BigInt(minimumBytes)
        || stat.size > BigInt(maximumBytes)) {
      fail(`${path.basename(file)} is not a bounded regular file`);
    }
    return { identity: statIdentity(stat), byteLength: Number(stat.size), stat };
  } finally {
    await handle.close();
  }
}

async function assertPathIdentity(
  file,
  expectedIdentity,
  maximumBytes,
  identityFailureKind = "integrity"
) {
  const current = await openedFileIdentity(file, maximumBytes);
  if (current.identity !== expectedIdentity) {
    fail(`${path.basename(file)} changed its fixed-path identity`, identityFailureKind);
  }
}

async function pinDirectory(directory, label) {
  let stat;
  try {
    stat = await fs.lstat(directory, { bigint: true });
  } catch {
    fail(`${label} is not an available directory`);
  }
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    fail(`${label} must be a non-symlink directory`);
  }
  return {
    directory: path.resolve(directory),
    identity: directoryIdentity(stat),
    label
  };
}

async function assertPinnedDirectory(pin) {
  const current = await pinDirectory(pin.directory, pin.label);
  if (current.identity !== pin.identity) fail(`${pin.label} identity changed`);
}

async function readBoundedFile(
  file,
  maximumBytes,
  minimumBytes = 1,
  { allowAtomicReplacement = false } = {}
) {
  const attempts = allowAtomicReplacement ? 3 : 1;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const handle = await openReadOnlyNoFollow(file);
    let result;
    let identity;
    let descriptorStable;
    try {
      const before = await handle.stat({ bigint: true });
      if (!before.isFile()
          || before.size < BigInt(minimumBytes)
          || before.size > BigInt(maximumBytes)) {
        fail(`${path.basename(file)} is not a bounded regular file`);
      }
      const bytes = await handle.readFile();
      const after = await handle.stat({ bigint: true });
      descriptorStable = statIdentity(before) === statIdentity(after);
      if (bytes.byteLength < minimumBytes
          || bytes.byteLength > maximumBytes) {
        fail(`${path.basename(file)} changed outside its accepted bounds while reading`);
      }
      identity = statIdentity(after);
      result = { bytes, stat: after };
    } finally {
      await handle.close();
    }
    const fixed = await openedFileIdentity(file, maximumBytes, minimumBytes);
    if (!descriptorStable) {
      if (allowAtomicReplacement
          && directoryIdentity(fixed.stat) !== directoryIdentity(result.stat)) {
        continue;
      }
      fail(`${path.basename(file)} changed outside its accepted bounds while reading`);
    }
    if (fixed.identity === identity) return result;
    if (!allowAtomicReplacement) {
      fail(`${path.basename(file)} changed its fixed-path identity`);
    }
  }
  fail(
    `${path.basename(file)} kept changing during its bounded snapshot`,
    "transient"
  );
}

function fixedChild(root, filename) {
  if (typeof filename !== "string" || path.basename(filename) !== filename) {
    fail("transcript filename escaped its fixed sessions directory");
  }
  const candidate = path.resolve(root, filename);
  if (path.dirname(candidate) !== path.resolve(root)) {
    fail("transcript filename escaped its fixed sessions directory");
  }
  return candidate;
}

async function readFamilySecret(vimicatePin) {
  await assertPinnedDirectory(vimicatePin);
  const vimicateDir = vimicatePin.directory;
  const file = path.join(vimicateDir, SECRET_FILENAME);
  const result = await readBoundedFile(file, 256);
  if ((Number(result.stat.mode) & 0o777) !== 0o600) {
    fail("family HMAC key must be a mode-0600 regular file");
  }
  const text = result.bytes.toString("utf8").trim();
  if (!/^[0-9a-f]{64}$/i.test(text)) {
    fail("family HMAC key must contain exactly 32 hex-encoded bytes");
  }
  return Buffer.from(text, "hex");
}

async function readLedger(vimicatePin) {
  await assertPinnedDirectory(vimicatePin);
  const vimicateDir = vimicatePin.directory;
  const { bytes } = await readBoundedFile(
    path.join(vimicateDir, LEDGER_FILENAME),
    MAX_LEDGER_BYTES,
    1,
    { allowAtomicReplacement: true }
  );
  try {
    return JSON.parse(bytes.toString("utf8"));
  } catch {
    fail("family ledger is not valid JSON");
  }
}

async function resolveSessionsDirectory(statePin, agentId, sessionPins) {
  await assertPinnedDirectory(statePin);
  const directories = [
    [path.join(statePin.directory, "agents"), "OpenClaw agents directory"],
    [path.join(statePin.directory, "agents", agentId), "OpenClaw agent directory"],
    [path.join(statePin.directory, "agents", agentId, "sessions"),
      "OpenClaw sessions directory"]
  ];
  const pins = [];
  for (const [directory, label] of directories) pins.push(await pinDirectory(directory, label));
  const prior = sessionPins.get(agentId);
  if (prior && pins.some((pin, index) => pin.identity !== prior[index].identity)) {
    fail("OpenClaw sessions directory chain identity changed");
  }
  if (!prior) sessionPins.set(agentId, pins);
  return pins.at(-1).directory;
}

async function resolveCurrentSession(
  statePin,
  stableSessionKey,
  agentId,
  sessionPins
) {
  const sessionsDir = await resolveSessionsDirectory(statePin, agentId, sessionPins);
  const { bytes: storeBytes } = await readBoundedFile(
    path.join(sessionsDir, "sessions.json"),
    64 * 1024 * 1024,
    1,
    { allowAtomicReplacement: true }
  );
  let store;
  try {
    store = JSON.parse(storeBytes.toString("utf8"));
  } catch {
    fail("OpenClaw sessions store is not valid JSON");
  }
  const entry = store?.[stableSessionKey];
  if (!entry || typeof entry.sessionId !== "string"
      || !Number.isSafeInteger(entry.sessionStartedAt)
      || entry.sessionStartedAt < 1
      || typeof entry.sessionFile !== "string") {
    // A project may be deleted or its successor may be published before the
    // lifecycle ledger observes that transition. That makes this one family
    // unavailable, but it is not evidence that another family's immutable
    // archive was altered. Keep the affected family fail-closed without
    // suppressing the global transport capability for every healthy project.
    fail("OpenClaw current session lacks immutable id/epoch authority", "unavailable");
  }
  const sessionFile = path.resolve(entry.sessionFile);
  if (path.dirname(sessionFile) !== path.resolve(sessionsDir)) {
    fail("OpenClaw current transcript target escaped its sessions directory");
  }
  return {
    sessionId: entry.sessionId,
    startedAtMs: entry.sessionStartedAt,
    transcriptFilename: path.basename(sessionFile)
  };
}

function transcriptEvidenceCancellationError() {
  return hostError("transcript evidence wait was cancelled", "transient");
}

function createWorkScheduler(maximumConcurrent, maximumPending) {
  let active = 0;
  const queued = [];

  function drain() {
    while (active < maximumConcurrent && queued.length > 0) {
      const job = queued.shift();
      if (job.state !== "queued") continue;
      job.state = "active";
      active += 1;
      void (async () => {
        try {
          const value = await job.operation(job.controller.signal);
          job.state = "fulfilled";
          job.resolve(value);
        } catch (error) {
          job.state = "rejected";
          job.reject(error);
        } finally {
          active -= 1;
          drain();
        }
      })();
    }
  }

  function submit(operation) {
    if (active + queued.length >= maximumPending) {
      fail("pending transcript revision work exceeds its bound", "transient");
    }
    let resolve;
    let reject;
    const promise = new Promise((resolvePromise, rejectPromise) => {
      resolve = resolvePromise;
      reject = rejectPromise;
    });
    const job = {
      controller: new AbortController(),
      operation,
      promise,
      reject,
      resolve,
      state: "queued",
      waiters: 0
    };
    queued.push(job);
    drain();
    return job;
  }

  function cancelWhenUnobserved(job) {
    if (job.waiters !== 0) return;
    if (job.state === "queued") {
      job.onUnobserved?.();
      const index = queued.indexOf(job);
      if (index >= 0) queued.splice(index, 1);
      job.state = "rejected";
      job.reject(transcriptEvidenceCancellationError());
      drain();
    } else if (job.state === "active") {
      job.onUnobserved?.();
      job.controller.abort(transcriptEvidenceCancellationError());
    }
  }

  return { cancelWhenUnobserved, submit };
}

function awaitWithCancellation(job, signal, cancelWhenUnobserved) {
  job.waiters += 1;
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (action) => {
      if (settled) return;
      settled = true;
      if (signal) signal.removeEventListener("abort", cancel);
      job.waiters -= 1;
      cancelWhenUnobserved(job);
      action();
    };
    const cancel = () => finish(() => reject(transcriptEvidenceCancellationError()));
    if (signal?.aborted) {
      cancel();
      return;
    }
    if (signal) signal.addEventListener("abort", cancel, { once: true });
    job.promise.then(
      (value) => {
        finish(() => resolve(value));
      },
      (error) => {
        finish(() => reject(error));
      }
    );
  });
}

function throwIfWaitCancelled(signal) {
  if (signal?.aborted) {
    throw transcriptEvidenceCancellationError();
  }
}

function createTranscriptEvidenceReader() {
  const revisionCache = new Map();
  const inFlight = new Map();
  const scheduler = createWorkScheduler(
    MAX_CONCURRENT_TRANSCRIPT_HASHES,
    MAX_PENDING_TRANSCRIPT_HASHES
  );

  async function hashTranscript(
    file,
    expectedIdentity,
    maximumBytes,
    signal,
    volatilityFailureKind
  ) {
    throwIfWaitCancelled(signal);
    const handle = await openReadOnlyNoFollow(file);
    let evidence;
    try {
      throwIfWaitCancelled(signal);
      const before = await handle.stat({ bigint: true });
      const identity = statIdentity(before);
      if (!before.isFile()
          || before.size > BigInt(maximumBytes)
          || identity !== expectedIdentity) {
        fail(
          `${path.basename(file)} changed before its revision was read`,
          volatilityFailureKind
        );
      }
      const hash = crypto.createHash("sha256");
      let bytesRead = 0;
      await new Promise((resolve, reject) => {
        const stream = handle.createReadStream({ autoClose: false });
        const cancel = () => stream.destroy(transcriptEvidenceCancellationError());
        signal.addEventListener("abort", cancel, { once: true });
        stream.on("data", (chunk) => {
          bytesRead += chunk.byteLength;
          if (bytesRead > maximumBytes) {
            stream.destroy(hostError(
              "transcript grew outside its accepted bound",
              volatilityFailureKind
            ));
            return;
          }
          hash.update(chunk);
        });
        stream.on("error", (error) => {
          signal.removeEventListener("abort", cancel);
          reject(error);
        });
        stream.on("end", () => {
          signal.removeEventListener("abort", cancel);
          resolve();
        });
        if (signal.aborted) cancel();
      });
      throwIfWaitCancelled(signal);
      const after = await handle.stat({ bigint: true });
      if (statIdentity(after) !== expectedIdentity || BigInt(bytesRead) !== after.size) {
        fail(
          `${path.basename(file)} changed while its revision was read`,
          volatilityFailureKind
        );
      }
      evidence = {
        identity: expectedIdentity,
        sourceRevision: hash.digest("hex"),
        byteLength: bytesRead
      };
    } finally {
      await handle.close();
    }
    throwIfWaitCancelled(signal);
    await assertPathIdentity(
      file,
      expectedIdentity,
      maximumBytes,
      volatilityFailureKind
    );
    throwIfWaitCancelled(signal);
    revisionCache.set(file, evidence);
    if (revisionCache.size > MAX_REVISION_CACHE_ENTRIES) {
      revisionCache.delete(revisionCache.keys().next().value);
    }
    return evidence;
  }

  return async function transcriptEvidence(
    file,
    maximumBytes,
    signal,
    requiredMode,
    volatilityFailureKind = "integrity"
  ) {
    if (!Number.isSafeInteger(maximumBytes)
        || maximumBytes < 0
        || maximumBytes > MAX_TRANSCRIPT_BYTES) {
      fail("remaining family transcript budget is invalid");
    }
    const inspected = await openedFileIdentity(file, maximumBytes);
    if (requiredMode != null
        && (Number(inspected.stat.mode) & 0o777) !== requiredMode) {
      fail(`${path.basename(file)} does not have its required private mode`);
    }
    throwIfWaitCancelled(signal);
    const cached = revisionCache.get(file);
    if (cached?.identity === inspected.identity) {
      await assertPathIdentity(
        file,
        inspected.identity,
        maximumBytes,
        volatilityFailureKind
      );
      throwIfWaitCancelled(signal);
      return {
        sourceRevision: cached.sourceRevision,
        byteLength: cached.byteLength
      };
    }

    const flightKey = `${file}\u0000${inspected.identity}`;
    let job = inFlight.get(flightKey);
    if (job?.controller.signal.aborted
        || (job?.state === "rejected" && job.waiters === 0)) {
      inFlight.delete(flightKey);
      job = undefined;
    }
    if (!job) {
      job = scheduler.submit((hashSignal) => hashTranscript(
        file,
        inspected.identity,
        maximumBytes,
        hashSignal,
        volatilityFailureKind
      ));
      job.onUnobserved = () => {
        if (inFlight.get(flightKey) === job) inFlight.delete(flightKey);
      };
      inFlight.set(flightKey, job);
      job.promise.finally(() => {
        if (inFlight.get(flightKey) === job) inFlight.delete(flightKey);
      }).catch(() => {});
    }
    const evidence = await awaitWithCancellation(
      job,
      signal,
      scheduler.cancelWhenUnobserved
    );
    await assertPathIdentity(
      file,
      inspected.identity,
      maximumBytes,
      volatilityFailureKind
    );
    throwIfWaitCancelled(signal);
    return {
      sourceRevision: evidence.sourceRevision,
      byteLength: evidence.byteLength
    };
  };
}

async function pinnedHostRoots(stateDir, vimicateDir) {
  const vimicatePin = await pinDirectory(vimicateDir, "Vimicate host directory");
  return {
    statePin: await pinDirectory(stateDir, "OpenClaw state directory"),
    vimicatePin,
    ownedPin: await pinDirectory(
      path.join(vimicatePin.directory, OWNED_TRANSCRIPTS_DIRECTORY),
      "Vimicate owned transcript directory"
    )
  };
}

function ownedTranscriptFilename(sessionId) {
  if (typeof sessionId !== "string" || path.basename(sessionId) !== sessionId) {
    fail("owned transcript session id is invalid");
  }
  return `${sessionId}.jsonl`;
}

async function openArchivedProjectionDescriptor(ownedPin, sessionId, signal) {
  if (signal?.aborted) fail("history projection was cancelled", "client");
  await assertPinnedDirectory(ownedPin);
  const source = fixedChild(
    ownedPin.directory,
    ownedTranscriptFilename(sessionId)
  );
  const sourceHandle = await openReadOnlyNoFollow(source);
  try {
    const descriptorStat = await sourceHandle.stat({ bigint: true });
    if (!descriptorStat.isFile()
        || descriptorStat.size < 0n
        || descriptorStat.size > BigInt(MAX_TRANSCRIPT_BYTES)
        || (Number(descriptorStat.mode) & 0o777) !== 0o600) {
      fail("owned transcript is not a private bounded regular file");
    }
    const fixed = await openedFileIdentity(source, MAX_TRANSCRIPT_BYTES);
    if (fixed.identity !== statIdentity(descriptorStat)) {
      fail("owned transcript changed before projection", "transient");
    }
    if (signal?.aborted) fail("history projection was cancelled", "client");

    // Keep the audited descriptor alive for the complete canonical projection.
    // The exact-file patch bypasses OpenClaw's ordinary candidate discovery, so
    // /dev/fd/<n> is opened directly and cannot be redirected by replacing the
    // owned pathname between validation and the canonical reader's open.
    const descriptorPath = `/dev/fd/${sourceHandle.fd}`;
    return {
      storePath: "/dev/fd/sessions.json",
      sessionFile: descriptorPath,
      cleanup: () => sourceHandle.close()
    };
  } catch (error) {
    await sourceHandle.close().catch(() => {});
    throw error;
  }
}

function projectedPageReader(readProjectedHistoryPage, resolveProjectionPaths) {
  return async (request) => {
    const { signal, ...projectorRequest } = request;
    let projectionPaths;
    let projectionWithCleanup;
    try {
      if (signal?.aborted) fail("history projection was cancelled", "client");
      projectionPaths = await resolveProjectionPaths(projectorRequest, signal);
      if (signal?.aborted) fail("history projection was cancelled", "client");
      const { cleanup: _cleanup, ...paths } = projectionPaths;
      const projection = Promise.resolve().then(() => readProjectedHistoryPage(
        { ...projectorRequest, ...paths },
        { signal }
      ));
      // Once the canonical reader receives /dev/fd/<n>, it owns the lifetime
      // of that authority. Cancellation may reject the outer RPC promptly, but
      // the descriptor must not close (and let n be reused) until the reader
      // itself settles. Observe the detached completion so no rejection leaks.
      projectionWithCleanup = projection.finally(() => projectionPaths.cleanup?.());
      projectionWithCleanup.catch(() => {});
      if (!signal) return await projectionWithCleanup;
      return await new Promise((resolve, reject) => {
        const cancelled = () => reject(
          hostError("history projection was cancelled", "client")
        );
        signal.addEventListener("abort", cancelled, { once: true });
        if (signal.aborted) cancelled();
        projectionWithCleanup.then(resolve, reject).finally(() => {
          signal.removeEventListener("abort", cancelled);
        }).catch(() => {});
      });
    } finally {
      if (!projectionWithCleanup) await projectionPaths?.cleanup?.();
    }
  }
}

export async function loadOpenClawHistoryFamilyContract({
  stateDir,
  vimicateDir,
  readProjectedHistoryPage
}) {
  if (typeof stateDir !== "string" || !path.isAbsolute(stateDir)
      || typeof vimicateDir !== "string" || !path.isAbsolute(vimicateDir)) {
    fail("stateDir and vimicateDir must be absolute paths");
  }
  if (typeof readProjectedHistoryPage !== "function") {
    fail("canonical OpenClaw history projector is required");
  }
  const { statePin, vimicatePin, ownedPin } = await pinnedHostRoots(
    stateDir,
    vimicateDir
  );
  const sessionPins = new Map();
  const readTranscriptEvidence = createTranscriptEvidenceReader();
  const familySecret = await readFamilySecret(vimicatePin);
  return createVimicateHistoryFamilyContract({
    familySecret,
    readLedger: () => readLedger(vimicatePin),
    resolveCurrentSession: (stableSessionKey, agentId) =>
      resolveCurrentSession(statePin, stableSessionKey, agentId, sessionPins),
    readTranscriptEvidence: async (
      agentId,
      filename,
      maximumBytes,
      signal,
      storage
    ) => {
      if (storage?.state === "archived") {
        await assertPinnedDirectory(ownedPin);
        return readTranscriptEvidence(
          fixedChild(
            ownedPin.directory,
            ownedTranscriptFilename(storage.sessionId)
          ),
          maximumBytes,
          signal,
          0o600
        );
      }
      const sessionsDir = await resolveSessionsDirectory(
        statePin,
        agentId,
        sessionPins
      );
      return readTranscriptEvidence(
        fixedChild(sessionsDir, filename),
        maximumBytes,
        signal,
        undefined,
        "transient"
      );
    },
    readProjectedHistoryPage: projectedPageReader(
      readProjectedHistoryPage,
      async (request, signal) => {
        const sessionsDir = await resolveSessionsDirectory(
          statePin,
          request.agentId,
          sessionPins
        );
        if (request.state === "archived") {
          await assertPinnedDirectory(ownedPin);
          return openArchivedProjectionDescriptor(
            ownedPin,
            request.sessionId,
            signal
          );
        }
        return {
          // OpenClaw's canonical transcript reader constrains an explicit
          // sessionFile to the directory containing its storePath. Archived
          // pages are host-owned under the separately pinned Vimicate root,
          // so bind that reader authority to an inert sibling store pathname
          // in the same owned directory. The reader receives the explicit
          // session entry and never loads this synthetic store file.
          storePath: path.join(sessionsDir, "sessions.json"),
          sessionFile: fixedChild(sessionsDir, request.transcriptFilename)
        };
      }
    )
  });
}

export const openClawHistoryFamilyHostFiles = Object.freeze({
  ledger: LEDGER_FILENAME,
  secret: SECRET_FILENAME,
  ownedTranscripts: OWNED_TRANSCRIPTS_DIRECTORY
});
