import fs from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const identity = s => [s.dev, s.ino, s.size, s.mtimeNs, s.ctimeNs, s.mode, s.nlink].join(":");
const fail = message => { throw new Error(`vimicate history-chain witness: ${message}`); };
const names = async dir => (await fs.readdir(dir)).filter(n => n.endsWith(".trajectory.jsonl")).sort();
function epoch(value) {
  const result = typeof value === "string" ? Date.parse(value) : NaN;
  if (!Number.isSafeInteger(result) || result <= 0 || new Date(result).toISOString() !== value) {
    fail("invalid source timestamp");
  }
  return result;
}

async function opened(file, maximumBytes, consume) {
  const handle = await fs.open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const before = await handle.stat({ bigint: true });
    if (!before.isFile() || before.size > BigInt(maximumBytes) || before.nlink !== 1n || (before.mode & 0o022n) !== 0n
        || before.uid !== BigInt(process.getuid())) fail("source is not a bounded owned regular file");
    await consume(handle);
    const after = await handle.stat({ bigint: true });
    const fixed = await fs.lstat(file, { bigint: true });
    if (fixed.isSymbolicLink() || identity(before) !== identity(after)
        || identity(after) !== identity(fixed)) fail("source changed during proof");
    return { file, identity: identity(after), size: Number(after.size) };
  } finally { await handle.close(); }
}

export async function proveHistoryChain({ directory, sessionKey, family, sessionIds, current }) {
  if (!Array.isArray(sessionIds) || sessionIds.length < 2 || sessionIds.length > 1024
      || sessionIds.some(id => typeof id !== "string" || !UUID.test(id))
      || new Set(sessionIds).size !== sessionIds.length) fail("explicit distinct ordered session IDs are required");
  const start = family.segments.findIndex(s => s.sessionId === sessionIds[0]);
  const committed = family.segments.at(-1)?.sessionId === sessionIds.at(-1);
  if (start < 0 || (!committed && start !== family.segments.length - 1)
      || (committed && family.segments.slice(start).map(s => s.sessionId).join() !== sessionIds.join())) {
    fail("requested chain is not the exact audited tail");
  }
  const prefix = family.segments.slice(0, start);
  const expected = [...prefix.map(s => s.sessionId), ...sessionIds];
  if (expected.length > 1024 || new Set(expected).size !== expected.length) fail("family repeats IDs or exceeds its bound");
  if (current.sessionId !== sessionIds.at(-1)) fail("current session does not own requested successor");
  const directoryStat = await fs.lstat(directory);
  if (!directoryStat.isDirectory() || directoryStat.isSymbolicLink()
      || await fs.realpath(directory) !== directory) fail("sessions directory is not canonical");
  const directoryIdentity = `${directoryStat.dev}:${directoryStat.ino}`;
  const files = await names(directory);
  if (files.length === 0 || files.length > 10000) fail("trajectory census is empty or unbounded");
  const witnessed = new Map(), pins = [];
  let aggregateBytes = 0, records = 0;
  for (const name of files) {
    const pin = await opened(path.join(directory, name), 64 * 1024 * 1024, async handle => {
      let pending = Buffer.alloc(0);
      for await (const chunk of handle.createReadStream({ autoClose: false })) {
        aggregateBytes += chunk.length;
        if (aggregateBytes > 4 * 1024 * 1024 * 1024) fail("trajectory census exceeds 4 GiB");
        pending = Buffer.concat([pending, chunk]);
        let end;
        while ((end = pending.indexOf(10)) >= 0) {
          if (end > 16 * 1024 * 1024) fail("trajectory record exceeds 16 MiB");
          const line = pending.subarray(0, end); pending = pending.subarray(end + 1);
          if (!line.length) continue;
          if (++records > 10_000_000) fail("trajectory record census exceeds its bound");
          const record = JSON.parse(line);
          if (record.sessionKey !== sessionKey) {
            if (sessionIds.includes(record.sessionId) && record.type === "session.started") {
              fail("concrete session has conflicting route ownership");
            }
            continue;
          }
          if (record.traceSchema !== "openclaw-trajectory" || record.schemaVersion !== 1
              || !UUID.test(record.sessionId ?? "")) fail("exact route has invalid trajectory authority");
          const time = epoch(record.ts);
          const row = witnessed.get(record.sessionId) ?? { first: time, last: time, firstStart: Infinity };
          row.first = Math.min(row.first, time); row.last = Math.max(row.last, time);
          if (record.type === "session.started") row.firstStart = Math.min(row.firstStart, time);
          witnessed.set(record.sessionId, row);
          if (witnessed.size > 1024) fail("witnessed family exceeds its bound");
        }
        if (pending.length > 16 * 1024 * 1024) fail("trajectory record exceeds 16 MiB");
      }
      if (pending.length) fail("trajectory contains an incomplete final record");
    });
    pins.push(pin);
  }
  // The closed prefix already has audited hashes, reverified by the repair
  // owner. Its older trajectory may have expired. Every new suffix generation
  // must still be witnessed, and no unaccounted generation may be skipped.
  if (sessionIds.some(id => !witnessed.has(id)) || [...witnessed.keys()].some(id => !expected.includes(id))) {
    fail("witness census is not complete for the declared family; missing generation");
  }
  const chain = [];
  for (const [index, sessionId] of sessionIds.entries()) {
    let header;
    const file = path.join(directory, `${sessionId}.jsonl`);
    const pin = await opened(file, 256 * 1024 * 1024, async handle => {
      const bytes = Buffer.alloc(256 * 1024 + 1);
      const { bytesRead } = await handle.read(bytes, 0, bytes.length, 0);
      const end = bytes.subarray(0, bytesRead).indexOf(10);
      if (end < 1 || end > 256 * 1024) fail("session header is not bounded");
      header = JSON.parse(bytes.subarray(0, end));
    });
    if (header.type !== "session" || header.id !== sessionId) fail("session header identity disagrees");
    const headerEpoch = epoch(header.timestamp);
    const startedAtMs = index === 0 ? family.segments[start].startedAtMs
      : index === sessionIds.length - 1 ? current.startedAtMs : headerEpoch;
    if (!Number.isSafeInteger(startedAtMs) || Math.abs(headerEpoch - startedAtMs) > 60_000) {
      fail("session header epoch disagrees with immutable authority");
    }
    const witness = witnessed.get(sessionId);
    if (!Number.isFinite(witness.firstStart)
        || (index > 0 && Math.abs(witness.firstStart - startedAtMs) > 60_000)
        || (index > 0 && (chain[index - 1].startedAtMs >= startedAtMs
          || witnessed.get(sessionIds[index - 1]).last >= witness.first))) {
      fail("replacement chain is not strictly ordered and witnessed");
    }
    chain.push({ sessionId, startedAtMs, file });
    pins.push(pin);
  }
  const assertUnchanged = async () => {
    const stat = await fs.lstat(directory);
    if (stat.isSymbolicLink() || `${stat.dev}:${stat.ino}` !== directoryIdentity
        || await fs.realpath(directory) !== directory || (await names(directory)).join() !== files.join()) {
      fail("trajectory directory or census changed before commit");
    }
    for (const pin of pins) {
      const stat = await fs.lstat(pin.file, { bigint: true });
      if (stat.isSymbolicLink() || identity(stat) !== pin.identity) fail("witness source changed before commit");
    }
  };
  await assertUnchanged();
  return { chain, prefix, committed, assertUnchanged, witnessed: witnessed.size, files: files.length };
}
