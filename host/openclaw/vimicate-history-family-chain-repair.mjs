import fs from "node:fs/promises";
import path from "node:path";
import { proveHistoryChain } from "./vimicate-history-chain-witness.mjs";

const fail = message => { throw new Error(`vimicate history-chain repair: ${message}`); };

// Invoked only explicitly by offline maintenance, never by a lifecycle/read
// fallback. All ledger publication and retained-file writes use the existing
// serialized writer's services; this module owns multi-generation validation.
export async function repairWitnessedChain(request, assertOffline, owner) {
  if (request.apply !== true && request.apply !== false) fail("explicit dry-run or apply is required");
  if (await fs.realpath(owner.vimicateDir) !== path.resolve(owner.vimicateDir)) fail("host directory is not canonical");
  if (request.apply && typeof assertOffline !== "function") fail("offline maintenance proof is required");
  if (request.apply) await assertOffline();
  const snapshot = await owner.snapshot(request);
  const { read, ledger, family, current, sessionKey, agentId } = snapshot;
  const proof = await proveHistoryChain({ directory: current.directory, sessionKey,
    family, sessionIds: request.sessionIds, current });
  let aggregateBytes = 0;
  for (const segment of proof.prefix) {
    const retained = await owner.hashOwned(segment.sessionId);
    aggregateBytes += retained.byteLength;
    if (retained.sourceRevision !== segment.sourceRevision) fail("existing archived revision changed");
  }
  const suffix = [];
  for (const [index, segment] of proof.chain.entries()) {
    const source = await owner.hashSource(segment.file);
    aggregateBytes += source.byteLength;
    const next = proof.chain[index + 1];
    suffix.push(next ? { sessionId: segment.sessionId, startedAtMs: segment.startedAtMs,
      endedAtMs: next.startedAtMs, endReason: "replacement", sourceRevision: source.sourceRevision,
      transcriptFilename: `${segment.sessionId}.jsonl.reset.${new Date(next.startedAtMs).toISOString().replaceAll(":", "-")}` }
      : { sessionId: segment.sessionId, startedAtMs: segment.startedAtMs,
        transcriptFilename: current.transcriptFilename });
  }
  if (aggregateBytes > 256 * 1024 * 1024) fail("complete family exceeds 256 MiB");
  const proposed = { ...family, agentId, segments: [...proof.prefix, ...suffix] };
  if (proof.committed && JSON.stringify(proposed) !== JSON.stringify(family)) fail("committed chain disagrees with proof");
  if (!proof.committed && (family.segments.at(-1).endedAtMs != null
      || family.segments.at(-1).sourceRevision != null
      || family.segments.at(-1).transcriptFilename !== `${request.sessionIds[0]}.jsonl`)) {
    fail("audited predecessor is already closed or noncanonical");
  }
  const revalidate = async () => {
    if (await fs.realpath(owner.vimicateDir) !== path.resolve(owner.vimicateDir)) fail("host directory changed");
    await proof.assertUnchanged();
    const confirmed = await owner.snapshot(request);
    if (confirmed.read.identity !== read.identity || JSON.stringify(confirmed.current) !== JSON.stringify(current)) {
      fail("ledger or current authority changed before commit");
    }
    for (const segment of proof.prefix) {
      if ((await owner.hashOwned(segment.sessionId)).sourceRevision !== segment.sourceRevision) {
        fail("existing archived revision changed before commit");
      }
    }
  };
  await revalidate();
  const summary = { sessionKey, segments: proposed.segments.length, witnessed: proof.witnessed,
    trajectoryFiles: proof.files, currentSessionId: current.sessionId };
  if (!request.apply) return { status: "dry-run", ...summary, alreadyCommitted: proof.committed };
  await assertOffline();
  if (proof.committed) {
    for (const segment of suffix.slice(0, -1)) {
      if ((await owner.hashOwned(segment.sessionId)).sourceRevision !== segment.sourceRevision) {
        fail("committed retained transcript changed");
      }
    }
    return { status: "unchanged", ...summary };
  }
  const backupDirectory = await fs.mkdtemp(path.join(owner.vimicateDir, "history-chain-recovery-"));
  await fs.chmod(backupDirectory, 0o700);
  await fs.writeFile(path.join(backupDirectory, "history-families.json"), JSON.stringify(ledger) + "\n",
    { mode: 0o600, flag: "wx" });
  for (const [index, segment] of proof.chain.slice(0, -1).entries()) {
    await assertOffline();
    const retained = await owner.retain(segment.file, segment.sessionId);
    if (retained !== suffix[index].sourceRevision) fail("closed transcript changed while retaining");
  }
  await assertOffline();
  await revalidate();
  const updated = structuredClone(ledger);
  updated.families[sessionKey] = proposed;
  await owner.commit(updated, read.identity, async () => { await assertOffline(); await revalidate(); });
  return { status: "appended", ...summary, backupDirectory };
}
