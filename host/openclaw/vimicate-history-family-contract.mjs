import crypto from "node:crypto";
import path from "node:path";

export const VIMICATE_ARCHIVED_FAMILY_CONTRACT = "archived-family-v1";
export const VIMICATE_ARCHIVED_FAMILY_AUDIT_CONTRACT =
  "archived-family-audit-v1";
export const VIMICATE_ARCHIVED_FAMILY_PROOF =
  "audited-baseline+contiguous-ledger-v1";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const STABLE_SESSION_KEY_PATTERN = /^agent:([A-Za-z0-9_-]+):[^\r\n]+$/;
const END_REASON_PATTERN = /^[A-Za-z0-9_.:-]{1,64}$/;
const ARCHIVE_TIMESTAMP_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}(?:\.\d{3})?Z$/;
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]{43,128}$/;
const MAX_FAMILY_TRANSCRIPT_BYTES = 256 * 1024 * 1024;
const MAX_AUDIT_FAMILIES = 1024;
const MAX_AUDIT_SEGMENTS = 4096;
const MAX_AUDIT_TRANSCRIPT_BYTES = 512 * 1024 * 1024;

export class VimicateHistoryFamilyError extends Error {
  constructor(message, failureKind = "client") {
    super(`vimicate archived-family: ${message}`);
    this.name = "VimicateHistoryFamilyError";
    this.vimicateHistoryFamilyFailureKind = failureKind;
  }
}

function fail(message, failureKind = "client") {
  throw new VimicateHistoryFamilyError(message, failureKind);
}

function requireInteger(value, label, minimum, maximum, failureKind = "client") {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    fail(`${label} is outside its accepted bounds`, failureKind);
  }
  return value;
}

function requireStableSessionKey(value, failureKind = "client") {
  if (typeof value !== "string") fail("stableSessionKey is required", failureKind);
  const trimmed = value.trim();
  const match = STABLE_SESSION_KEY_PATTERN.exec(trimmed);
  if (!match) fail("stableSessionKey is invalid", failureKind);
  return { stableSessionKey: trimmed, agentId: match[1] };
}

function requireUUID(value, label, failureKind = "client") {
  if (typeof value !== "string" || !UUID_PATTERN.test(value.trim())) {
    fail(`${label} is not a UUID`, failureKind);
  }
  return value.trim().toLowerCase();
}

function requireBase64URL(value, label) {
  if (typeof value !== "string" || !BASE64URL_PATTERN.test(value)) {
    fail(`${label} is not an ASCII base64url value`);
  }
  return value;
}

function requireSHA256Hex(value, label, failureKind = "client") {
  if (typeof value !== "string" || !/^[0-9a-f]{64}$/.test(value)) {
    fail(`${label} is not a lowercase SHA-256 digest`, failureKind);
  }
  return value;
}

function requireFamilySecret(value) {
  if (!Buffer.isBuffer(value) || value.byteLength < 32) {
    fail("family secret must contain at least 32 bytes", "integrity");
  }
  return value;
}

function throwIfCancelled(signal) {
  if (signal?.aborted) fail("request was cancelled");
}

function transcriptFilenameForSegment(
  sessionId,
  rawFilename,
  state,
  endReason,
  failureKind = "client"
) {
  if (typeof rawFilename !== "string" || path.basename(rawFilename) !== rawFilename) {
    fail("segment transcript filename must be a basename", failureKind);
  }
  const plainCurrent = `${sessionId}.jsonl`;
  const topicPrefix = `${sessionId}-topic-`;
  const resetMarker = ".jsonl.reset.";
  const resetIndex = rawFilename.indexOf(resetMarker);
  const currentFilename = resetIndex >= 0
    ? rawFilename.slice(0, resetIndex + ".jsonl".length)
    : rawFilename;
  const topicSlug = currentFilename.startsWith(topicPrefix)
    && currentFilename.endsWith(".jsonl")
    ? currentFilename.slice(topicPrefix.length, -".jsonl".length)
    : "";
  if (currentFilename !== plainCurrent
      && !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(topicSlug)) {
    fail("segment transcript filename is not canonical", failureKind);
  }
  const archivedPrefix = `${currentFilename}.reset.`;
  if (state === "current" && rawFilename !== currentFilename) {
    fail("current segment transcript filename is not canonical", failureKind);
  }
  if (state === "archived" && rawFilename === currentFilename) {
    if (endReason !== "compaction") {
      fail("only compaction may retain an unrenamed archived transcript", failureKind);
    }
    return rawFilename;
  }
  if (state === "archived" && !rawFilename.startsWith(archivedPrefix)) {
    fail("archived segment transcript filename is not canonical", failureKind);
  }
  if (state === "archived") {
    const timestamp = rawFilename.slice(archivedPrefix.length);
    const [datePart, timePart] = timestamp.split("T");
    const restored = datePart && timePart
      ? `${datePart}T${timePart.replace(/-/g, ":")}`
      : "";
    if (!ARCHIVE_TIMESTAMP_PATTERN.test(timestamp)
        || Number.isNaN(Date.parse(restored))) {
      fail("archived segment transcript timestamp is not canonical", failureKind);
    }
  }
  return rawFilename;
}

function validateLedgerEnvelope(rawLedger) {
  if (rawLedger?.schemaVersion !== 1
      || rawLedger?.proof !== VIMICATE_ARCHIVED_FAMILY_PROOF
      || rawLedger?.families == null
      || typeof rawLedger.families !== "object"
      || Array.isArray(rawLedger.families)) {
    fail("ledger schema or proof is invalid", "integrity");
  }
  return rawLedger;
}

function validateLedgerFamily(rawLedger, stableSessionKey, expectedAgentId) {
  validateLedgerEnvelope(rawLedger);
  const family = rawLedger?.families?.[stableSessionKey];
  if (!family || family.agentId !== expectedAgentId || !Array.isArray(family.segments)) {
    if (!family) fail("stable session family is not audited in the ledger");
    fail("stable session family ledger entry is malformed", "integrity");
  }
  if (family.segments.length < 1 || family.segments.length > 1024) {
    fail("ledger segment count is outside its accepted bounds", "integrity");
  }

  const seen = new Set();
  let priorStartedAtMs = 0;
  return family.segments.map((rawSegment, order) => {
    const sessionId = requireUUID(rawSegment?.sessionId, "segment sessionId", "integrity");
    if (seen.has(sessionId)) fail("ledger repeats a segment sessionId", "integrity");
    seen.add(sessionId);
    const startedAtMs = requireInteger(
      rawSegment?.startedAtMs,
      "segment startedAtMs",
      1,
      Number.MAX_SAFE_INTEGER,
      "integrity"
    );
    if (startedAtMs <= priorStartedAtMs) {
      fail("ledger segment epochs are not increasing", "integrity");
    }
    priorStartedAtMs = startedAtMs;
    const state = order === family.segments.length - 1 ? "current" : "archived";
    let endedAtMs;
    let endReason;
    if (state === "archived") {
      endedAtMs = requireInteger(
        rawSegment?.endedAtMs,
        "archived endedAtMs",
        startedAtMs + 1,
        Number.MAX_SAFE_INTEGER,
        "integrity"
      );
      if (typeof rawSegment?.endReason !== "string"
          || !END_REASON_PATTERN.test(rawSegment.endReason)) {
        fail("archived endReason is invalid", "integrity");
      }
      endReason = rawSegment.endReason;
      const successorStartedAtMs = family.segments[order + 1]?.startedAtMs;
      if (Number.isSafeInteger(successorStartedAtMs) && endedAtMs > successorStartedAtMs) {
        fail("archived segment overlaps its successor epoch", "integrity");
      }
    } else if (rawSegment?.endedAtMs != null || rawSegment?.endReason != null) {
      fail("current ledger segment carries archive metadata", "integrity");
    }
    return {
      sessionId,
      order,
      state,
      startedAtMs,
      ...(endedAtMs == null ? {} : { endedAtMs }),
      ...(endReason == null ? {} : { endReason }),
      ...(state === "archived" ? {
        sourceRevision: requireSHA256Hex(
          rawSegment?.sourceRevision,
          "archived sourceRevision",
          "integrity"
        )
      } : {}),
      transcriptFilename: transcriptFilenameForSegment(
        sessionId,
        rawSegment?.transcriptFilename,
        state,
        endReason,
        "integrity"
      )
    };
  });
}

function validateExpectedGeneration(params) {
  const expectedCurrentSessionId = requireUUID(
    params?.expectedCurrentSessionId,
    "expectedCurrentSessionId"
  );
  const expectedCurrentSessionStartedAtMs = requireInteger(
    params?.expectedCurrentSessionStartedAtMs,
    "expectedCurrentSessionStartedAtMs",
    1,
    Number.MAX_SAFE_INTEGER
  );
  return { expectedCurrentSessionId, expectedCurrentSessionStartedAtMs };
}

function assertCurrentAuthority(current, expected, terminalSegment) {
  const sessionId = requireUUID(
    current?.sessionId,
    "host current sessionId",
    "transient"
  );
  const startedAtMs = requireInteger(
    current?.startedAtMs,
    "host current startedAtMs",
    1,
    Number.MAX_SAFE_INTEGER,
    "transient"
  );
  if (sessionId !== expected.expectedCurrentSessionId
      || startedAtMs !== expected.expectedCurrentSessionStartedAtMs
      || terminalSegment.sessionId !== sessionId
      || terminalSegment.startedAtMs !== startedAtMs
      || current?.transcriptFilename !== terminalSegment.transcriptFilename) {
    fail("current session generation changed or is not ledger-complete", "transient");
  }
}

function familyToken(secret, stableSessionKey, segments) {
  const evidence = JSON.stringify({
    stableSessionKey,
    segments: segments.map(({ transcriptFilename: _ignored, ...segment }) => segment)
  });
  return crypto.createHmac("sha256", secret).update(evidence).digest("base64url");
}

function publicSegment(segment) {
  const { transcriptFilename: _ignored, ...result } = segment;
  return result;
}

async function resolvedLedgerFamilyEvidence(
  dependencies,
  stableSessionKey,
  agentId,
  expected,
  ledgerSegments,
  signal,
  maximumTranscriptBytes = MAX_FAMILY_TRANSCRIPT_BYTES
) {
  throwIfCancelled(signal);
  const currentBefore = await dependencies.resolveCurrentSession(stableSessionKey, agentId);
  assertCurrentAuthority(currentBefore, expected, ledgerSegments.at(-1));

  const segments = [];
  let familyBytes = 0;
  for (const ledgerSegment of ledgerSegments) {
    throwIfCancelled(signal);
    const remainingBytes = Math.min(
      MAX_FAMILY_TRANSCRIPT_BYTES - familyBytes,
      maximumTranscriptBytes - familyBytes
    );
    if (remainingBytes < 0) {
      fail("family transcript audit exceeds its byte budget", "integrity");
    }
    const evidence = await dependencies.readTranscriptEvidence(
      agentId,
      ledgerSegment.transcriptFilename,
      remainingBytes,
      signal,
      {
        sessionId: ledgerSegment.sessionId,
        state: ledgerSegment.state
      }
    );
    const revision = requireSHA256Hex(
      evidence?.sourceRevision,
      "computed sourceRevision",
      "integrity"
    );
    const byteLength = requireInteger(
      evidence?.byteLength,
      "transcript byteLength",
      0,
      remainingBytes,
      "integrity"
    );
    familyBytes += byteLength;
    if (ledgerSegment.state === "archived"
        && revision !== ledgerSegment.sourceRevision) {
      fail("archived segment no longer matches its ledger revision", "integrity");
    }
    segments.push({ ...ledgerSegment, sourceRevision: revision });
  }
  const currentAfter = await dependencies.resolveCurrentSession(stableSessionKey, agentId);
  assertCurrentAuthority(currentAfter, expected, ledgerSegments.at(-1));
  throwIfCancelled(signal);
  const token = familyToken(
    requireFamilySecret(dependencies.familySecret),
    stableSessionKey,
    segments
  );
  return { stableSessionKey, agentId, expected, segments, token, familyBytes };
}

async function resolvedFamilyEvidence(dependencies, params, signal) {
  throwIfCancelled(signal);
  const { stableSessionKey, agentId } = requireStableSessionKey(params?.stableSessionKey);
  const expected = validateExpectedGeneration(params);
  const ledger = await dependencies.readLedger();
  const ledgerSegments = validateLedgerFamily(ledger, stableSessionKey, agentId);
  return resolvedLedgerFamilyEvidence(
    dependencies,
    stableSessionKey,
    agentId,
    expected,
    ledgerSegments,
    signal
  );
}

async function auditAllFamilies(dependencies, context = {}) {
  const signal = context?.signal;
  throwIfCancelled(signal);
  const ledgerBefore = validateLedgerEnvelope(await dependencies.readLedger());
  const entries = Object.entries(ledgerBefore.families);
  if (entries.length > MAX_AUDIT_FAMILIES) {
    fail("startup audit exceeds its family bound", "integrity");
  }

  const validated = [];
  let totalSegments = 0;
  for (const [stableSessionKey] of entries) {
    const authority = requireStableSessionKey(stableSessionKey, "integrity");
    const segments = validateLedgerFamily(
      ledgerBefore,
      authority.stableSessionKey,
      authority.agentId
    );
    totalSegments += segments.length;
    if (totalSegments > MAX_AUDIT_SEGMENTS) {
      fail("startup audit exceeds its segment bound", "integrity");
    }
    validated.push({
      stableSessionKey: authority.stableSessionKey,
      agentId: authority.agentId,
      expected: {
        expectedCurrentSessionId: segments.at(-1).sessionId,
        expectedCurrentSessionStartedAtMs: segments.at(-1).startedAtMs
      },
      segments
    });
  }

  let transcriptBytes = 0;
  let unavailableFamilies = 0;
  for (const family of validated) {
    throwIfCancelled(signal);
    const remainingBytes = MAX_AUDIT_TRANSCRIPT_BYTES - transcriptBytes;
    if (remainingBytes < 0) {
      fail("startup audit exceeds its transcript byte bound", "integrity");
    }
    try {
      const evidence = await resolvedLedgerFamilyEvidence(
        dependencies,
        family.stableSessionKey,
        family.agentId,
        family.expected,
        family.segments,
        signal,
        remainingBytes
      );
      transcriptBytes += evidence.familyBytes;
    } catch (error) {
      // Session deletion and a not-yet-ledgered successor are local authority
      // gaps, not proof that another family's audited archive is corrupt.
      // Each request revalidates its own complete family, so quarantine only
      // the unavailable family while retaining the global read transport.
      // Structural, owned-transcript, revision and fixed-path failures remain
      // integrity failures and still abort the complete startup audit.
      const kind = error?.vimicateHistoryFamilyFailureKind;
      if (kind !== "transient" && kind !== "unavailable") throw error;
      unavailableFamilies += 1;
    }
  }

  const ledgerAfter = validateLedgerEnvelope(await dependencies.readLedger());
  if (JSON.stringify(ledgerAfter) !== JSON.stringify(ledgerBefore)) {
    fail("ledger changed during startup audit", "transient");
  }
  throwIfCancelled(signal);
  return {
    contract: VIMICATE_ARCHIVED_FAMILY_AUDIT_CONTRACT,
    proof: VIMICATE_ARCHIVED_FAMILY_PROOF,
    families: validated.length - unavailableFamilies,
    ...(unavailableFamilies ? { unavailableFamilies } : {}),
    segments: totalSegments,
    transcriptBytes
  };
}

function validateCommonRequest(params) {
  if (params?.contract !== VIMICATE_ARCHIVED_FAMILY_CONTRACT) {
    fail("contract is unsupported");
  }
  if (params?.mode !== "segments" && params?.mode !== "page") {
    fail("mode must be segments or page");
  }
}

async function censusResponse(dependencies, params, signal) {
  const cursor = requireInteger(params?.cursor, "cursor", 0, 1024);
  const limit = requireInteger(params?.limit, "limit", 1, 128);
  const family = await resolvedFamilyEvidence(dependencies, params, signal);
  if (cursor > family.segments.length) fail("cursor exceeds the family census");
  if (params?.familyToken != null
      && requireBase64URL(params.familyToken, "familyToken") !== family.token) {
    fail("family token changed during census");
  }
  const pageSegments = family.segments.slice(cursor, cursor + limit);
  const nextCursor = cursor + pageSegments.length;
  const hasMore = nextCursor < family.segments.length;
  return {
    contract: VIMICATE_ARCHIVED_FAMILY_CONTRACT,
    proof: VIMICATE_ARCHIVED_FAMILY_PROOF,
    stableSessionKey: family.stableSessionKey,
    currentSessionId: family.expected.expectedCurrentSessionId,
    currentSessionStartedAtMs: family.expected.expectedCurrentSessionStartedAtMs,
    familyToken: family.token,
    cursor,
    ...(hasMore ? { nextCursor } : {}),
    hasMore,
    totalSegments: family.segments.length,
    segments: pageSegments.map(publicSegment)
  };
}

async function historyPageResponse(dependencies, params, signal) {
  const family = await resolvedFamilyEvidence(dependencies, params, signal);
  const suppliedToken = requireBase64URL(params?.familyToken, "familyToken");
  if (suppliedToken !== family.token) fail("family token is stale");
  const sessionId = requireUUID(params?.sessionId, "sessionId");
  const segmentOrder = requireInteger(params?.segmentOrder, "segmentOrder", 0, 1023);
  const suppliedRevision = requireBase64URL(params?.sourceRevision, "sourceRevision");
  const offset = requireInteger(params?.offset, "offset", 0, Number.MAX_SAFE_INTEGER);
  const limit = requireInteger(params?.limit, "limit", 1, 128);
  const segment = family.segments[segmentOrder];
  if (!segment || segment.sessionId !== sessionId
      || segment.sourceRevision !== suppliedRevision) {
    fail("requested segment identity or source revision is stale");
  }

  const page = await dependencies.readProjectedHistoryPage({
    stableSessionKey: family.stableSessionKey,
    agentId: family.agentId,
    sessionId: segment.sessionId,
    state: segment.state,
    startedAtMs: segment.startedAtMs,
    sourceRevision: segment.sourceRevision,
    transcriptFilename: segment.transcriptFilename,
    offset,
    limit,
    ...(signal ? { signal } : {})
  });
  if (page?.sessionId?.toLowerCase() !== segment.sessionId
      || page?.sessionKey !== family.stableSessionKey
      || page?.transcriptFilename !== segment.transcriptFilename
      || page?.offset !== offset
      || !Number.isSafeInteger(page?.totalMessages)
      || page.totalMessages < 0
      || typeof page?.hasMore !== "boolean"
      || !Array.isArray(page?.messages)) {
    fail("canonical history projection returned invalid page metadata", "projection");
  }
  if (page.messages.length > Math.max(limit * 2, 512)) {
    fail("canonical history projection exceeded its display expansion bound", "projection");
  }
  if (page.hasMore) {
    if (!Number.isSafeInteger(page.nextOffset)
        || page.nextOffset <= offset
        || page.nextOffset >= page.totalMessages) {
      fail("canonical history projection returned an invalid nextOffset", "projection");
    }
  } else if (page.nextOffset != null || offset > page.totalMessages) {
    fail("canonical history projection contradicted its terminal cursor", "projection");
  }

  throwIfCancelled(signal);
  const familyAfter = await resolvedFamilyEvidence(dependencies, params, signal);
  if (familyAfter.token !== family.token
      || familyAfter.segments[segmentOrder]?.sourceRevision !== segment.sourceRevision) {
    fail("family evidence changed while its page was projected", "transient");
  }
  return {
    contract: VIMICATE_ARCHIVED_FAMILY_CONTRACT,
    proof: VIMICATE_ARCHIVED_FAMILY_PROOF,
    stableSessionKey: family.stableSessionKey,
    currentSessionId: family.expected.expectedCurrentSessionId,
    currentSessionStartedAtMs: family.expected.expectedCurrentSessionStartedAtMs,
    familyToken: family.token,
    segment: publicSegment(segment),
    sessionId: segment.sessionId,
    sessionKey: family.stableSessionKey,
    offset,
    ...(page.hasMore ? { nextOffset: page.nextOffset } : {}),
    hasMore: page.hasMore,
    totalMessages: page.totalMessages,
    messages: page.messages
  };
}

export function createVimicateHistoryFamilyContract(dependencies) {
  for (const name of [
    "readLedger",
    "resolveCurrentSession",
    "readTranscriptEvidence",
    "readProjectedHistoryPage"
  ]) {
    if (typeof dependencies?.[name] !== "function") {
      fail(`dependency ${name} is required`, "integrity");
    }
  }
  requireFamilySecret(dependencies.familySecret);
  const handler = async function handleVimicateHistoryFamily(params, context = {}) {
    validateCommonRequest(params);
    const signal = context?.signal;
    if (signal != null
        && (typeof signal !== "object"
          || typeof signal.aborted !== "boolean"
          || typeof signal.addEventListener !== "function"
          || typeof signal.removeEventListener !== "function")) {
      fail("cancellation signal is invalid");
    }
    return params.mode === "segments"
      ? censusResponse(dependencies, params, signal)
      : historyPageResponse(dependencies, params, signal);
  };
  handler.probe = (context) => auditAllFamilies(dependencies, context);
  return handler;
}
