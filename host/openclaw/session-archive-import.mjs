// Offline migration coordinator. The platform port owns the exclusive
// stopped-writer boundary, durable private journal and official OpenClaw import.
// This module is not loaded by the Gateway or the mobile runtime.
const MAX_ITEMS = 4096;
const DEFAULT_BATCH_BYTES = 32 * 1024 * 1024;
function requireCondition(value, message) {
  if (!value) throw new Error(`archive import: ${message}`);
}

export function selectArchiveBatch(items, completed, budget = DEFAULT_BATCH_BYTES) {
  requireCondition(Number.isSafeInteger(budget) && budget > 0, "invalid byte budget");
  const done = new Set(completed), keys = new Set(), selected = [];
  let bytes = 0;
  for (const item of items) {
    if (done.has(item.id)) continue;
    requireCondition(Number.isSafeInteger(item.bytes) && item.bytes > 0 && item.bytes <= budget,
      "source exceeds batch byte budget");
    if (keys.has(item.key)) continue;
    keys.add(item.key);
    if (bytes + item.bytes > budget) continue;
    selected.push(item); bytes += item.bytes;
    if (selected.length === 64) break;
  }
  return selected;
}

function validateJournal(journal, items, planDigest) {
  const known = new Set(items.map(item => item.id));
  requireCondition(journal.version === 1 && journal.planDigest === planDigest,
    "journal plan does not match; recover with the original plan");
  requireCondition(journal.originals && typeof journal.originals === "object"
    && !Array.isArray(journal.originals), "invalid saved current rows");
  for (const ids of [journal.completed, journal.active ?? []]) {
    requireCondition(Array.isArray(ids) && ids.length <= items.length
      && new Set(ids).size === ids.length && ids.every(id => known.has(id)), "invalid receipt IDs");
  }
  requireCondition(journal.active === null || Array.isArray(journal.active), "invalid active batch");
  const active = items.filter(item => journal.active?.includes(item.id));
  requireCondition(new Set(active.map(item => item.key)).size === active.length,
    "pending import repeats a route");
}

export async function runArchiveImport({ port, items, planDigest, maxBatches = 1,
  batchBytes = DEFAULT_BATCH_BYTES, signal }) {
  requireCondition(Array.isArray(items) && items.length <= MAX_ITEMS
    && new Set(items.map(item => item.id)).size === items.length, "invalid plan items");
  requireCondition(typeof planDigest === "string" && planDigest.length > 0, "missing plan digest");
  requireCondition(Number.isSafeInteger(maxBatches) && maxBatches >= 0 && maxBatches <= 128,
    "batch count outside bounds");
  return port.exclusively(async () => {
    let journal = await port.readJournal();
    if (!journal) {
      signal?.throwIfAborted();
      journal = { version: 1, planDigest, originals: await port.captureCurrent(),
        completed: [], active: null };
      await port.saveJournal(journal);
    }
    validateJournal(journal, items, planDigest);
    const restore = async batch => {
      await port.restoreCurrent(journal.originals, batch);
      await port.retireInputs(batch);
      await port.assertCurrent(journal.originals);
    };
    if (journal.active) {
      const pending = items.filter(item => journal.active.includes(item.id));
      // Restore before checking cancellation or changed sources. A killed
      // process may have committed SQLite but never restored current pointers.
      await restore(pending);
      await port.assertSources(pending);
      for (const item of pending) {
        if (await port.verifyArchive(item) && !journal.completed.includes(item.id)) {
          journal.completed.push(item.id);
        }
      }
      journal.active = null;
      await port.saveJournal(journal);
    }
    await port.assertCurrent(journal.originals);
    await port.assertSources(items);
    for (let index = 0; index < maxBatches; index++) {
      signal?.throwIfAborted();
      const batch = selectArchiveBatch(items, journal.completed, batchBytes);
      if (!batch.length) break;
      await port.assertCurrent(journal.originals);
      journal.active = batch.map(item => item.id);
      await port.saveJournal(journal);
      try {
        await port.prepare(batch);
        signal?.throwIfAborted();
        await port.importBatch(batch, signal);
        for (const item of batch) {
          requireCondition(await port.verifyArchive(item), "imported transcript is missing");
        }
      } finally {
        // Includes preparation, import and verification failures. If restoration
        // itself fails, keep the pending journal; never continue to another batch.
        await restore(batch);
      }
      journal.completed.push(...batch.map(item => item.id));
      journal.active = null;
      await port.saveJournal(journal);
    }
    return journal;
  });
}
