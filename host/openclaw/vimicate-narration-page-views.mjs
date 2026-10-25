import crypto from 'node:crypto';

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const DEFAULTS = Object.freeze({ maximumViews: 16, maximumBytes: 32 * 1024 * 1024, lifetimeMs: 60_000 });

/** Instance-local, immutable page views. Serialized record strings avoid
 * retaining mutable state objects and decode only the requested page. UTF-8
 * bytes are bounded; UTF-16 storage is at most twice that plus bounded array
 * overhead (16 views, each at most the contract's 2,048 validated records).
 * Expiry is absolute, not renewed by reads. Idle expired storage remains
 * within the same hard bounds and is released at the next request/clear. */
export function createVimicateNarrationPageViews({ fail, limits = {}, now = () => performance.now() }) {
  const bounds = {};
  for (const [name, maximum] of Object.entries(DEFAULTS)) {
    const value = limits[name] ?? maximum;
    if (!Number.isSafeInteger(value) || value < 1 || value > maximum) fail(`snapshot ${name} is outside its accepted bound`);
    bounds[name] = value;
  }
  const views = new Map();
  let retainedBytes = 0;

  function remove(token) {
    const view = views.get(token);
    if (!view) return;
    retainedBytes -= view.bytes;
    views.delete(token);
  }

  function clear() { views.clear(); retainedBytes = 0; }

  function page({ stableSessionKey, sessionId, records, snapshotToken, cursor, limit }) {
    const time = now();
    if (!Number.isFinite(time) || time < 0) { clear(); fail('snapshot clock is invalid'); }
    for (const [token, view] of views) if (view.expiresAt <= time) remove(token);
    if (!records) for (const [token, view] of views) {
      if (view.stableSessionKey === stableSessionKey && view.sessionId === sessionId) remove(token);
    }
    let view;
    if (snapshotToken != null) {
      if (typeof snapshotToken !== 'string' || !TOKEN_PATTERN.test(snapshotToken)) fail('snapshotToken is invalid');
      view = views.get(snapshotToken);
      if (!view || view.stableSessionKey !== stableSessionKey || view.sessionId !== sessionId || !records) fail('snapshot changed');
    } else {
      // Continuations must carry their original view, never switch snapshots.
      if (cursor !== 0) fail('snapshot changed');
      const encoded = (records ?? []).map(record => JSON.stringify(record));
      const bytes = Buffer.byteLength(JSON.stringify({ stableSessionKey, sessionId }), 'utf8')
        + encoded.reduce((size, record) => size + Buffer.byteLength(record, 'utf8') + 1, 2);
      if (bytes > bounds.maximumBytes) fail('snapshot exceeds its byte bound');
      while (views.size >= bounds.maximumViews || retainedBytes + bytes > bounds.maximumBytes) remove(views.keys().next().value);
      snapshotToken = crypto.randomBytes(32).toString('base64url');
      view = { stableSessionKey, sessionId, encoded, bytes, expiresAt: time + bounds.lifetimeMs };
      views.set(snapshotToken, view);
      retainedBytes += bytes;
    }
    if (cursor > view.encoded.length) fail('cursor exceeds the snapshot');
    const recordsPage = view.encoded.slice(cursor, cursor + limit).map(record => JSON.parse(record));
    const nextCursor = cursor + recordsPage.length;
    const hasMore = nextCursor < view.encoded.length;
    return { snapshotToken, cursor, ...(hasMore ? { nextCursor } : {}), hasMore,
      totalRecords: view.encoded.length, records: recordsPage };
  }

  return { page, clear };
}
