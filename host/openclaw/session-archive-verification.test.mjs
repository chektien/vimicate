import assert from "node:assert/strict";
import test from "node:test";
import { verifyImportedArchiveRecords } from "./session-archive-verification.mjs";

const before = [{ type: "session", id: "original" }, { type: "message", id: "m1", parentId: null,
  message: { role: "user", content: "unchanged text", MediaPath: "/private/image.png",
    MediaPaths: ["/private/image.png"], MediaType: "image/png", MediaTypes: ["image/png"] } }];
const after = [{ ...before[0] }, { ...before[1], message: { role: "user", content: "unchanged text",
  __openclaw: { media: [{ path: "/private/image.png", contentType: "image/png" }] } } }];
test("accepts exact records and counts only the reviewed media-envelope migration", () => {
  assert.deepEqual(verifyImportedArchiveRecords(before, before),
    { records: 2, exact: 2, mediaMigrated: 0, inboundLabelsMigrated: 0 });
  assert.deepEqual(verifyImportedArchiveRecords(before, after),
    { records: 2, exact: 1, mediaMigrated: 1, inboundLabelsMigrated: 0 });
});
test("accepts only Doctor's reviewed 2026.8.1 inbound-label normalization", () => {
  const old = [{ type: "message", message: { role: "user",
    content: "[Mon 2026-08-31 08:00 SGT] Sender (untrusted metadata):\n```json\n{\"id\":1}\n```\nkeep this" } }];
  const normalized = [{ type: "message", message: { role: "user",
    content: "[Mon 2026-08-31 08:00 SGT] Sender: ⟦openclaw:ctx⟧\n```json\n{\"id\":1}\n```\nkeep this" } }];
  assert.deepEqual(verifyImportedArchiveRecords(old, normalized),
    { records: 1, exact: 0, mediaMigrated: 0, inboundLabelsMigrated: 1 });
  const edited = structuredClone(normalized); edited[0].message.content = edited[0].message.content.replace("keep this", "changed");
  assert.throws(() => verifyImportedArchiveRecords(old, edited), /record 0/);
});
test("composes reviewed media and inbound-label migrations without accepting other edits", () => {
  const old = structuredClone(before), normalized = structuredClone(after);
  old[1].message.content = "Chat history since last reply (untrusted, for context):";
  normalized[1].message.content = "Chat history since last reply: ⟦openclaw:ctx⟧";
  assert.deepEqual(verifyImportedArchiveRecords(old, normalized),
    { records: 2, exact: 1, mediaMigrated: 1, inboundLabelsMigrated: 1 });
});
test("keeps unrelated metadata, MIME, ordering, transcribed and staging facts", () => {
  const old = structuredClone(before), next = structuredClone(after);
  old[1].message.__openclaw = { senderId: "sender" };
  old[1].message.MediaStaged = true; old[1].message.MediaWorkspaceDir = "/private/work";
  old[1].message.MediaTranscribedIndexes = [0];
  next[1].message.__openclaw.senderId = "sender";
  Object.assign(next[1].message.__openclaw.media[0], { staged: true, workspaceDir: "/private/work", transcribed: true });
  assert.equal(verifyImportedArchiveRecords(old, next).mediaMigrated, 1);
});
for (const field of ["path", "contentType"]) test(`rejects changed attachment ${field}`, () => {
  const corrupt = structuredClone(after); corrupt[1].message.__openclaw.media[0][field] = "changed";
  assert.throws(() => verifyImportedArchiveRecords(before, corrupt), /record 1/);
});
test("rejects removed, reordered or edited messages and parent IDs", () => {
  assert.throws(() => verifyImportedArchiveRecords(before, after.slice(1)), /count/);
  assert.throws(() => verifyImportedArchiveRecords(before, after.toReversed()), /record 0/);
  for (const mutate of [r => r.message.content = "changed", r => r.parentId = "changed"]) {
    const corrupt = structuredClone(after); mutate(corrupt[1]);
    assert.throws(() => verifyImportedArchiveRecords(before, corrupt), /record 1/);
  }
});
test("does not silently accept discarded singular/plural conflicts or unknown carriers", () => {
  const conflicting = structuredClone(before); conflicting[1].message.MediaPath = "/other.png";
  assert.throws(() => verifyImportedArchiveRecords(conflicting, after), /ambiguous/);
  const unsupported = structuredClone(before); unsupported[1].message.media = [{ path: "/other.png" }];
  assert.throws(() => verifyImportedArchiveRecords(unsupported, after), /unsupported/);
});
