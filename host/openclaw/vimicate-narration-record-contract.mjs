import { createVimicateNarrationPageViews } from "./vimicate-narration-page-views.mjs";

export const VIMICATE_SHARED_NARRATION_CONTRACT = "shared-narration-v1";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const STABLE_SESSION_KEY_PATTERN = /^agent:[A-Za-z0-9_-]+:[^\r\n]+$/;
const OPAQUE_ID_PATTERN = /^[\x21-\x7e]{1,256}$/;
const DEFAULT_LIMITS = Object.freeze({
  maximumSegments: 160,
  maximumRecordsPerSegment: 2_048,
  maximumPageRecords: 128,
  maximumTextBytes: 64 * 1024,
  maximumStateBytes: 16 * 1024 * 1024
});

export class VimicateNarrationRecordError extends Error {
  constructor(message) {
    super(`vimicate shared narration: ${message}`);
    this.name = "VimicateNarrationRecordError";
  }
}

function fail(message) {
  throw new VimicateNarrationRecordError(message);
}

function requireInteger(value, label, minimum, maximum) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    fail(`${label} is outside its accepted bounds`);
  }
  return value;
}

function requireTimestamp(value, label) {
  if (typeof value !== "number"
      || !Number.isFinite(value)
      || value < 0
      || value > Number.MAX_SAFE_INTEGER) {
    fail(`${label} is outside its accepted bounds`);
  }
  return value;
}

function requireStableSessionKey(value) {
  if (typeof value !== "string") fail("stableSessionKey is required");
  const trimmed = value.trim();
  if (!STABLE_SESSION_KEY_PATTERN.test(trimmed)) {
    fail("stableSessionKey is invalid");
  }
  return trimmed;
}

function requireSessionId(value) {
  if (typeof value !== "string" || !UUID_PATTERN.test(value.trim())) {
    fail("sessionId is not a UUID");
  }
  return value.trim().toLowerCase();
}

function requireOpaqueId(value, label) {
  if (typeof value !== "string" || !OPAQUE_ID_PATTERN.test(value.trim())) {
    fail(`${label} is invalid`);
  }
  return value.trim();
}

function requireText(value, maximumBytes) {
  if (typeof value !== "string") fail("progressText is required");
  const trimmed = value.trim();
  if (!trimmed) fail("progressText is empty");
  if (Buffer.byteLength(trimmed, "utf8") > maximumBytes) {
    fail("progressText exceeds its byte bound");
  }
  return trimmed;
}

function resolvedLimits(overrides = {}) {
  const result = {};
  for (const [name, defaultValue] of Object.entries(DEFAULT_LIMITS)) {
    result[name] = requireInteger(
      overrides[name] ?? defaultValue,
      name,
      1,
      defaultValue
    );
  }
  return Object.freeze(result);
}

function emptyState() {
  return {
    schemaVersion: 1,
    contract: VIMICATE_SHARED_NARRATION_CONTRACT,
    segments: []
  };
}

function recordIdentity(record) {
  return `${record.runId.length}:${record.runId}${record.itemId.length}:${record.itemId}`;
}

function compareRecords(lhs, rhs) {
  if (lhs.runId === rhs.runId && lhs.firstSequence !== rhs.firstSequence) {
    return lhs.firstSequence - rhs.firstSequence;
  }
  if (lhs.firstTimestampMs !== rhs.firstTimestampMs) {
    return lhs.firstTimestampMs - rhs.firstTimestampMs;
  }
  if (lhs.firstSequence !== rhs.firstSequence) {
    return lhs.firstSequence - rhs.firstSequence;
  }
  return recordIdentity(lhs).localeCompare(recordIdentity(rhs));
}

function validateRecord(raw, limits) {
  const record = {
    runId: requireOpaqueId(raw?.runId, "runId"),
    itemId: requireOpaqueId(raw?.itemId, "itemId"),
    text: requireText(raw?.text, limits.maximumTextBytes),
    firstSequence: requireInteger(
      raw?.firstSequence,
      "firstSequence",
      1,
      Number.MAX_SAFE_INTEGER
    ),
    lastSequence: requireInteger(
      raw?.lastSequence,
      "lastSequence",
      1,
      Number.MAX_SAFE_INTEGER
    ),
    firstTimestampMs: requireTimestamp(
      raw?.firstTimestampMs,
      "firstTimestampMs"
    ),
    lastTimestampMs: requireTimestamp(
      raw?.lastTimestampMs,
      "lastTimestampMs"
    ),
    revision: requireInteger(
      raw?.revision,
      "revision",
      1,
      Number.MAX_SAFE_INTEGER
    )
  };
  if (record.lastSequence < record.firstSequence
      || record.lastTimestampMs < record.firstTimestampMs) {
    fail("record order regressed");
  }
  return record;
}

function validateState(raw, limits) {
  if (raw == null) return emptyState();
  if (raw?.schemaVersion !== 1
      || raw?.contract !== VIMICATE_SHARED_NARRATION_CONTRACT
      || !Array.isArray(raw?.segments)) {
    fail("state schema is invalid");
  }
  if (raw.segments.length > limits.maximumSegments) {
    fail("state segment count exceeds its bound");
  }
  const seenSegments = new Set();
  const segments = raw.segments.map((candidate) => {
    const stableSessionKey = requireStableSessionKey(
      candidate?.stableSessionKey
    );
    const sessionId = requireSessionId(candidate?.sessionId);
    const segmentIdentity = `${stableSessionKey}\n${sessionId}`;
    if (seenSegments.has(segmentIdentity)) {
      fail("state repeats a session segment");
    }
    seenSegments.add(segmentIdentity);
    if (!Array.isArray(candidate?.records)
        || candidate.records.length > limits.maximumRecordsPerSegment) {
      fail("state record count exceeds its bound");
    }
    const records = candidate.records.map((record) =>
      validateRecord(record, limits)
    );
    const seenRecords = new Set();
    for (const record of records) {
      const identity = recordIdentity(record);
      if (seenRecords.has(identity)) fail("state repeats a narration identity");
      seenRecords.add(identity);
    }
    records.sort(compareRecords);
    return {
      stableSessionKey,
      sessionId,
      lastTimestampMs: requireTimestamp(
        candidate?.lastTimestampMs,
        "segment lastTimestampMs"
      ),
      records
    };
  });
  const state = {
    schemaVersion: 1,
    contract: VIMICATE_SHARED_NARRATION_CONTRACT,
    segments
  };
  if (Buffer.byteLength(JSON.stringify(state), "utf8") > limits.maximumStateBytes) {
    fail("state exceeds its byte bound");
  }
  return state;
}

function narrationCandidate(event, limits) {
  if (event?.stream !== "item"
      || event?.data?.kind !== "preamble"
      || event?.data?.source !== "codex-app-server"
      || event?.data?.phase !== "update") {
    return undefined;
  }
  try {
    return {
      stableSessionKey: requireStableSessionKey(event.sessionKey),
      sessionId: requireSessionId(event.sessionId),
      runId: requireOpaqueId(event.runId, "runId"),
      itemId: requireOpaqueId(event.data.itemId, "itemId"),
      sequence: requireInteger(
        event.seq,
        "event sequence",
        1,
        Number.MAX_SAFE_INTEGER
      ),
      timestampMs: requireTimestamp(event.ts, "event timestamp"),
      text: requireText(event.data.progressText, limits.maximumTextBytes)
    };
  } catch {
    return undefined;
  }
}

export function createVimicateNarrationRecordContract(dependencies) {
  if (typeof dependencies?.readState !== "function"
      || typeof dependencies?.commitState !== "function") {
    fail("readState and commitState dependencies are required");
  }
  const limits = resolvedLimits(dependencies.limits);
  const snapshots = createVimicateNarrationPageViews({
    fail, limits: dependencies.snapshotLimits, now: dependencies.snapshotNow
  });
  let transaction = Promise.resolve();

  function serialize(operation) {
    const result = transaction.then(operation);
    transaction = result.catch(() => {});
    return result;
  }

  async function readValidatedState() {
    return validateState(await dependencies.readState(), limits);
  }

  async function commitValidatedState(state) {
    const validated = validateState(state, limits);
    await dependencies.commitState(validated);
  }

  async function record(event) {
    const candidate = narrationCandidate(event, limits);
    if (!candidate) return "ignored";
    return serialize(async () => {
      const state = await readValidatedState();
      let segment = state.segments.find((entry) =>
        entry.stableSessionKey === candidate.stableSessionKey
          && entry.sessionId === candidate.sessionId
      );
      if (!segment) {
        segment = {
          stableSessionKey: candidate.stableSessionKey,
          sessionId: candidate.sessionId,
          lastTimestampMs: candidate.timestampMs,
          records: []
        };
        state.segments.push(segment);
      }
      const identity = `${candidate.runId.length}:${candidate.runId}`
        + `${candidate.itemId.length}:${candidate.itemId}`;
      const existing = segment.records.find((entry) =>
        recordIdentity(entry) === identity
      );
      if (existing) {
        if (candidate.sequence < existing.lastSequence) return "rejected";
        if (candidate.text === existing.text) return "unchanged";
        if (!candidate.text.startsWith(existing.text)) return "rejected";
        existing.text = candidate.text;
        existing.lastSequence = candidate.sequence;
        existing.lastTimestampMs = candidate.timestampMs;
        existing.revision += 1;
        segment.lastTimestampMs = Math.max(
          segment.lastTimestampMs,
          candidate.timestampMs
        );
        segment.records.sort(compareRecords);
        await commitValidatedState(state);
        return "replaced";
      }
      segment.records.push({
        runId: candidate.runId,
        itemId: candidate.itemId,
        text: candidate.text,
        firstSequence: candidate.sequence,
        lastSequence: candidate.sequence,
        firstTimestampMs: candidate.timestampMs,
        lastTimestampMs: candidate.timestampMs,
        revision: 1
      });
      segment.lastTimestampMs = Math.max(
        segment.lastTimestampMs,
        candidate.timestampMs
      );
      segment.records.sort(compareRecords);
      if (segment.records.length > limits.maximumRecordsPerSegment) {
        segment.records.splice(
          0,
          segment.records.length - limits.maximumRecordsPerSegment
        );
      }
      state.segments.sort((lhs, rhs) =>
        lhs.lastTimestampMs - rhs.lastTimestampMs
      );
      if (state.segments.length > limits.maximumSegments) {
        state.segments.splice(0, state.segments.length - limits.maximumSegments);
      }
      await commitValidatedState(state);
      return "inserted";
    });
  }

  async function request(params) {
    if (params?.contract !== VIMICATE_SHARED_NARRATION_CONTRACT) {
      fail("contract is unsupported");
    }
    const stableSessionKey = requireStableSessionKey(params.stableSessionKey);
    const sessionId = requireSessionId(params.sessionId);
    const cursor = requireInteger(
      params.cursor ?? 0,
      "cursor",
      0,
      Number.MAX_SAFE_INTEGER
    );
    const limit = requireInteger(
      params.limit ?? limits.maximumPageRecords,
      "limit",
      1,
      limits.maximumPageRecords
    );
    // A retained view never substitutes for a current authority/schema read.
    let state;
    try { state = await serialize(readValidatedState); }
    catch (error) { snapshots.clear(); throw error; }
    const records = state.segments.find((entry) =>
      entry.stableSessionKey === stableSessionKey
        && entry.sessionId === sessionId
    )?.records;
    return {
      contract: VIMICATE_SHARED_NARRATION_CONTRACT,
      stableSessionKey,
      sessionId,
      ...snapshots.page({ stableSessionKey, sessionId, records,
        snapshotToken: params.snapshotToken, cursor, limit })
    };
  }

  async function probe() {
    const state = await serialize(readValidatedState);
    return {
      contract: VIMICATE_SHARED_NARRATION_CONTRACT,
      schemaVersion: state.schemaVersion,
      segments: state.segments.length,
      records: state.segments.reduce(
        (total, segment) => total + segment.records.length,
        0
      ),
      bytes: Buffer.byteLength(JSON.stringify(state), "utf8")
    };
  }

  return { record, request, probe };
}
