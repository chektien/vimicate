import crypto from 'node:crypto';

export const SQLITE_FAMILY_CONTRACT = 'sqlite-family-v1';
export const SQLITE_FAMILY_PROOF = 'verified-import+sqlite-ownership-v1';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SHA = /^[0-9a-f]{64}$/;
const hash = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const integer = (value, min, max) => Number.isSafeInteger(value) && value >= min && value <= max;
function requireValue(value, message) {
  if (!value) throw new Error(`vimicate archived-family: ${message}`);
}
function sameToken(supplied, expected) {
  return typeof supplied === 'string' && /^[A-Za-z0-9_-]{43}$/.test(supplied)
    && crypto.timingSafeEqual(Buffer.from(supplied), Buffer.from(expected));
}
function validateManifest(input) {
  requireValue(input?.contract === 'sqlite-import-manifest-v1' && SHA.test(input.sourceLedgerDigest)
    && input.families && typeof input.families === 'object' && !Array.isArray(input.families), 'invalid import manifest');
  const entries = Object.entries(input.families), ids = new Set(), anchors = new Set();
  let totalBytes = 0;
  // A fresh stock host has no imported legacy families. Native database
  // ownership must still prove every requested route and concrete generation.
  requireValue(integer(entries.length, 0, 1024), 'invalid import family count');
  for (const [key, family] of entries) {
    requireValue(key.length <= 1024 && /^agent:[A-Za-z0-9_-]+:[^\r\n]+$/.test(key)
      && typeof family?.anchorSessionId === 'string' && UUID.test(family.anchorSessionId)
      && Array.isArray(family.archives) && family.archives.length < 1024, 'invalid import family');
    requireValue(!anchors.has(family.anchorSessionId), 'repeated current anchor');
    anchors.add(family.anchorSessionId);
    let familyBytes = 0;
    for (const archive of family.archives) {
      requireValue(typeof archive?.sessionId === 'string' && UUID.test(archive.sessionId)
        && archive.sessionId !== family.anchorSessionId && !ids.has(archive.sessionId)
        && SHA.test(archive.sourceRevision) && SHA.test(archive.importedDigest)
        && integer(archive.records, 1, 32_768) && integer(archive.importedBytes, 1, 32 * 1024 * 1024), 'invalid import archive');
      ids.add(archive.sessionId);
      totalBytes += archive.importedBytes; familyBytes += archive.importedBytes;
    }
    requireValue(ids.size <= 4096, 'import archive bound exceeded');
    requireValue(familyBytes <= 256 * 1024 * 1024 && totalBytes <= 512 * 1024 * 1024, 'import verification byte bound exceeded');
  }
  requireValue([...anchors].every(id => !ids.has(id)), 'current anchor is an imported archive');
  // Copy only domain facts: never retain mutable caller metadata or credentials.
  return new Map(entries.map(([key, f]) => [key, { anchorSessionId: f.anchorSessionId,
    archives: f.archives.map(a => ({ sessionId: a.sessionId, sourceRevision: a.sourceRevision,
      importedDigest: a.importedDigest, importedBytes: a.importedBytes, records: a.records })) }]));
}

/** Imported membership plus explicit native ancestry. Same-ID resets need no
 * archive writer; native copied branches must never concatenate predecessors. */
export function createSqliteHistoryFamily({ manifest, secret, authority, reader }) {
  const families = validateManifest(manifest), manifestDigest = hash([manifest.sourceLedgerDigest, [...families]]);
  requireValue(Buffer.isBuffer(secret) && secret.length >= 32, 'family secret is required');
  const ownedSecret = Buffer.from(secret);
  for (const method of ['readCurrent', 'verifyArchive', 'readArchiveRevision']) {
    requireValue(typeof authority?.[method] === 'function', `missing authority ${method}`);
  }
  requireValue(typeof reader?.readPage === 'function', 'missing native page reader');
  const verified = new Map();
  let ready = false, disposed = false, starting, pending = 0;
  function active(signal) {
    requireValue(!disposed, 'service is disposed'); signal?.throwIfAborted();
  }
  function currentFor(key, family) {
    const current = authority.readCurrent(key);
    requireValue(current && UUID.test(current.sessionId)
      && integer(current.sessionStartedAtMs, 1, Number.MAX_SAFE_INTEGER)
      && (current.lifecycleRevision === null || (typeof current.lifecycleRevision === 'string'
        && current.lifecycleRevision.length > 0 && current.lifecycleRevision.length <= 256)), 'current session generation changed or is unavailable');
    if (family?.anchorSessionId !== current.sessionId) {
      requireValue(typeof authority.readNativeSegments === 'function', 'import anchor changed; native continuity must be verified');
      requireValue(!family?.archives.some(a => a.sessionId === current.sessionId), 'import anchor changed to a closed import');
    }
    return { sessionId: current.sessionId, sessionStartedAtMs: current.sessionStartedAtMs,
      lifecycleRevision: current.lifecycleRevision };
  }
  function snapshot(params) {
    const key = params.stableSessionKey, family = families.get(key);
    requireValue(family || typeof authority.readNativeSegments === 'function', 'stable session family is not in the verified import');
    const current = currentFor(key, family);
    requireValue(current.sessionId === params.expectedCurrentSessionId
      && current.sessionStartedAtMs === params.expectedCurrentSessionStartedAtMs,
    'current session generation changed or is not ledger-complete');
    const segments = (family?.archives ?? []).map((archive, order) => {
      try {
        const revision = authority.readArchiveRevision({ stableSessionKey: key, sessionId: archive.sessionId });
        requireValue(revision === verified.get(archive.sessionId), 'verified archive changed or became unavailable');
        return { sessionId: archive.sessionId, order, state: 'archived', sourceRevision: revision };
      } catch (error) { ready = false; throw error; }
    });
    if (current.sessionId !== family?.anchorSessionId) {
      const ancestors = authority.readNativeSegments({ stableSessionKey: key, sessionId: current.sessionId, anchorSessionId: family?.anchorSessionId });
      requireValue(Array.isArray(ancestors) && ancestors.length < 128, 'invalid native ancestry');
      const ids = new Set([...segments.map(s => s.sessionId), current.sessionId]);
      for (const sessionId of ancestors) {
        requireValue(UUID.test(sessionId) && !ids.has(sessionId), 'invalid or repeated native ancestor'); ids.add(sessionId);
        segments.push({ sessionId, order: segments.length, state: 'archived',
          sourceRevision: authority.readArchiveRevision({ stableSessionKey: key, sessionId }) });
      }
    }
    requireValue(hash(currentFor(key, family)) === hash(current), 'current session generation changed during census');
    segments.push({ sessionId: current.sessionId, order: segments.length, state: 'current', sourceRevision: hash(current) });
    const token = crypto.createHmac('sha256', ownedSecret).update(JSON.stringify([
      SQLITE_FAMILY_CONTRACT, manifestDigest, key, current, segments,
    ])).digest('base64url');
    return { current, segments, token };
  }
  function envelope(params, snap) {
    return { contract: SQLITE_FAMILY_CONTRACT, proof: SQLITE_FAMILY_PROOF,
      stableSessionKey: params.stableSessionKey, currentSessionId: snap.current.sessionId,
      currentSessionStartedAtMs: snap.current.sessionStartedAtMs, familyToken: snap.token };
  }
  async function start({ signal } = {}) {
    active(signal);
    if (ready) return;
    if (!starting) starting = (async () => {
      try {
        for (const [stableSessionKey, family] of families) {
          active(signal); currentFor(stableSessionKey, family);
          for (const archive of family.archives) {
            active(signal);
            const revision = await authority.verifyArchive({ stableSessionKey, archive, signal });
            active(signal); requireValue(SHA.test(revision), 'invalid verified archive revision');
            verified.set(archive.sessionId, revision);
            // Verification is bounded, but must also yield to service disposal,
            // request handling and the startup timeout between archive reads.
            await new Promise(resolve => setImmediate(resolve));
          }
          currentFor(stableSessionKey, family);
        }
        active(signal); ready = true;
      } catch (error) { verified.clear(); throw error; }
    })().finally(() => { starting = undefined; });
    return starting;
  }
  async function request(params, { signal } = {}) {
    active(signal); requireValue(ready, 'service is not ready');
    requireValue(params?.contract === SQLITE_FAMILY_CONTRACT && ['segments', 'page'].includes(params.mode)
      && integer(params.limit, 1, 128), 'invalid request contract or bounds');
    requireValue(pending < 2, 'service is busy'); pending++;
    try {
      const snap = snapshot(params);
      if (params.familyToken !== undefined || params.mode === 'page') {
        requireValue(sameToken(params.familyToken, snap.token), 'family token is stale');
      }
      if (params.mode === 'segments') {
        requireValue(integer(params.cursor, 0, snap.segments.length - 1), 'invalid census cursor');
        const segments = snap.segments.slice(params.cursor, params.cursor + params.limit);
        const next = params.cursor + segments.length, hasMore = next < snap.segments.length;
        return { ...envelope(params, snap), cursor: params.cursor, totalSegments: snap.segments.length,
          segments, hasMore, ...(hasMore ? { nextCursor: next } : {}) };
      }
      requireValue(integer(params.segmentOrder, 0, snap.segments.length - 2)
        && integer(params.offset, 0, 32_768), 'invalid archive selector or page offset');
      const segment = snap.segments[params.segmentOrder];
      requireValue(segment.sessionId === params.sessionId && segment.sourceRevision === params.sourceRevision,
        'archive selector does not match verified segment');
      const page = await reader.readPage({ agentId: params.stableSessionKey.split(':')[1],
        stableSessionKey: params.stableSessionKey, sessionId: segment.sessionId,
        offset: params.offset, limit: params.limit, signal });
      active(signal);
      requireValue(snapshot(params).token === snap.token, 'family token is stale after projection');
      requireValue(page?.sessionKey === params.stableSessionKey && page.sessionId === segment.sessionId
        && page.offset === params.offset && integer(page.totalMessages, params.offset, 32_768)
        && Array.isArray(page.messages) && page.messages.length <= 512
        && Buffer.byteLength(JSON.stringify(page.messages)) <= 524288 && typeof page.hasMore === 'boolean'
        && (page.hasMore ? integer(page.nextOffset, params.offset + 1, page.totalMessages - 1) : page.nextOffset === undefined),
      'invalid native page');
      return { ...envelope(params, snap), segment, sessionId: segment.sessionId, offset: page.offset,
        totalMessages: page.totalMessages, messages: page.messages, hasMore: page.hasMore,
        ...(page.hasMore ? { nextOffset: page.nextOffset } : {}) };
    } finally { pending--; }
  }
  return { start, request, isReady: () => ready && !disposed,
    dispose() { disposed = true; ready = false; verified.clear(); ownedSecret.fill(0); } };
}
