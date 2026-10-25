import assert from "node:assert/strict";
import test from "node:test";
import { runArchiveImport, selectArchiveBatch } from "./session-archive-import.mjs";

const items = [
  { id: "a1", key: "a", bytes: 10 }, { id: "a2", key: "a", bytes: 10 },
  { id: "b1", key: "b", bytes: 10 },
];
function fixture() {
  let durable = null;
  const events = [], imported = new Set(), original = { a: "current-a", b: "current-b" };
  let current = { ...original }, busy = false;
  const port = {
    async exclusively(run) {
      assert.equal(busy, false); busy = true;
      try { return await run(); } finally { busy = false; }
    },
    async readJournal() { return structuredClone(durable); },
    async saveJournal(value) { durable = structuredClone(value); events.push("journal"); },
    async captureCurrent() { return { ...original }; },
    async assertCurrent(saved) { assert.deepEqual(current, saved); },
    async assertSources() { events.push("sources"); },
    async prepare(batch) {
      assert.ok(durable.active); events.push("prepare");
      assert.deepEqual(current, original);
    },
    async importBatch(batch) {
      events.push("import");
      for (const item of batch) { imported.add(item.id); current[item.key] = item.id; }
    },
    async restoreCurrent(saved) { events.push("restore"); current = { ...saved }; },
    async retireInputs() { events.push("retire"); },
    async verifyArchive(item) { return imported.has(item.id); },
  };
  return { port, events, imported, read: () => durable, current: () => current,
    seed(value, next) { durable = value; current = next; } };
}
const request = (f, options = {}) => ({ port: f.port, items, planDigest: "plan-one", ...options });

test("batches retain order and include only one original identity per route", () => {
  assert.deepEqual(selectArchiveBatch(items, [], 30).map(i => i.id), ["a1", "b1"]);
  assert.deepEqual(selectArchiveBatch(items, ["a1"], 10).map(i => i.id), ["a2"]);
  assert.throws(() => selectArchiveBatch([{ ...items[0], bytes: 31 }], [], 30), /budget/);
});

test("a route's smaller later archive cannot overtake its oldest pending archive", () => {
  const plan = [{ id: "a1", key: "a", bytes: 20 },
    { id: "b1", key: "b", bytes: 20 }, { id: "b2", key: "b", bytes: 10 }];
  assert.deepEqual(selectArchiveBatch(plan, [], 30).map(i => i.id), ["a1"]);
  assert.deepEqual(selectArchiveBatch(plan, ["a1"], 30).map(i => i.id), ["b1"]);
});

test("journal precedes writes; one bounded batch restores current rows before receipt", async () => {
  const f = fixture();
  const result = await runArchiveImport(request(f));
  assert.deepEqual(result.completed, ["a1", "b1"]);
  assert.equal(result.active, null);
  assert.deepEqual(f.current(), { a: "current-a", b: "current-b" });
  assert.ok(f.events.indexOf("journal") < f.events.indexOf("prepare"));
  assert.ok(f.events.indexOf("restore") < f.events.lastIndexOf("journal"));
  const next = await runArchiveImport(request(f));
  assert.deepEqual(next.completed.sort(), ["a1", "a2", "b1"]);
  const imports = f.events.filter(e => e === "import").length;
  await runArchiveImport(request(f));
  assert.equal(f.events.filter(e => e === "import").length, imports);
});

test("import failure restores current rows and retains a recoverable pending batch", async () => {
  const f = fixture(), original = f.port.importBatch;
  f.port.importBatch = async batch => { await original(batch); throw new Error("import interrupted"); };
  await assert.rejects(runArchiveImport(request(f)), /import interrupted/);
  assert.deepEqual(f.current(), { a: "current-a", b: "current-b" });
  assert.ok(f.read().active);
  f.port.importBatch = original;
  const result = await runArchiveImport(request(f, { maxBatches: 0 }));
  assert.deepEqual(result.completed, ["a1", "b1"]);
  assert.equal(result.active, null);
});

test("new process recovers a committed import before current-row restoration", async () => {
  const f = fixture();
  f.seed({ version: 1, planDigest: "plan-one", originals: { a: "current-a", b: "current-b" },
    completed: [], active: ["a1", "b1"] }, { a: "a1", b: "b1" });
  f.imported.add("a1"); f.imported.add("b1");
  const result = await runArchiveImport(request(f, { maxBatches: 0 }));
  assert.equal(result.active, null);
  assert.deepEqual(result.completed, ["a1", "b1"]);
  assert.equal(f.events.includes("import"), false);
});

test("partial import recovery does not mark missing history complete", async () => {
  const f = fixture();
  f.seed({ version: 1, planDigest: "plan-one", originals: { a: "current-a", b: "current-b" },
    completed: [], active: ["a1", "b1"] }, { a: "a1", b: "current-b" });
  f.imported.add("a1");
  assert.deepEqual((await runArchiveImport(request(f, { maxBatches: 0 }))).completed, ["a1"]);
});

test("wrong imported contents stop recovery without erasing the journal", async () => {
  const f = fixture();
  f.port.verifyArchive = async () => { throw new Error("event digest differs"); };
  await assert.rejects(runArchiveImport(request(f)), /event digest/);
  assert.ok(f.read().active);
  assert.deepEqual(f.current(), { a: "current-a", b: "current-b" });
});

test("changed plan, sources or current authority prevents import", async () => {
  const f = fixture();
  await runArchiveImport(request(f));
  await assert.rejects(runArchiveImport(request(f, { planDigest: "different" })), /plan/);
  const g = fixture();
  g.port.assertSources = async () => { throw new Error("source changed"); };
  await assert.rejects(runArchiveImport(request(g)), /source changed/);
  assert.equal(g.events.includes("import"), false);
  const h = fixture();
  h.port.assertCurrent = async () => { throw new Error("current changed"); };
  await assert.rejects(runArchiveImport(request(h)), /current changed/);
  assert.equal(h.events.includes("import"), false);
});

test("restoration failure remains pending and never starts another batch", async () => {
  const f = fixture();
  f.port.restoreCurrent = async () => { throw new Error("restore unavailable"); };
  await assert.rejects(runArchiveImport(request(f, { maxBatches: 2 })), /restore unavailable/);
  assert.ok(f.read().active);
  assert.equal(f.events.filter(e => e === "import").length, 1);
});

test("cancelled run does not stage a new import", async () => {
  const f = fixture(), controller = new AbortController(); controller.abort();
  await assert.rejects(runArchiveImport(request(f, { signal: controller.signal })), /abort/i);
  assert.equal(f.events.includes("prepare"), false);
});
