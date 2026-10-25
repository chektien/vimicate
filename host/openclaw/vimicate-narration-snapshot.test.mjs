import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  createVimicateNarrationStateStore,
  registerVimicateNarrationPlugin
} from "./vimicate-narration-plugin-runtime.mjs";
import { createVimicateNarrationRecordContract } from "./vimicate-narration-record-contract.mjs";

async function fixture(t, state = { revision: 1 }, options = {}) {
  const directory = await fs.realpath(await fs.mkdtemp(
    path.join(os.tmpdir(), "vimicate-narration-snapshot-")
  ));
  await fs.chmod(directory, 0o700);
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const store = createVimicateNarrationStateStore({ ...options, vimicateDir: directory });
  await store.commitState(state);
  return { directory, store };
}

async function replaceState(file, text, mode = 0o600) {
  const replacement = `${file}.replacement`;
  await fs.writeFile(replacement, text, { mode });
  await fs.chmod(replacement, mode);
  await fs.rename(replacement, file);
}

function interruptReads(t, file, phase, operation, count = 1) {
  const originalOpen = fs.open;
  let remaining = count;
  const handles = new Set();
  t.mock.method(fs, "open", async (...args) => {
    const handle = await originalOpen(...args);
    if (args[0] !== file) return handle;
    handles.add(handle);
    const close = handle.close.bind(handle);
    handle.close = async () => {
      try { return await close(); } finally { handles.delete(handle); }
    };
    if (remaining-- <= 0) return handle;
    if (phase === "before-stat") await operation();
    else {
      const read = handle.readFile.bind(handle);
      handle.readFile = async (...readArgs) => {
        const bytes = await read(...readArgs);
        await operation();
        return bytes;
      };
    }
    return handle;
  });
  return () => assert.equal(handles.size, 0, "snapshot descriptors must close");
}

for (const phase of ["before-stat", "after-read"]) {
  test(`an atomic replacement ${phase} preserves a validated opened snapshot`, async (t) => {
    const { store } = await fixture(t);
    const closed = interruptReads(t, store.file, phase, () =>
      replaceState(store.file, '{"revision":2}\n')
    );
    assert.deepEqual(await store.readState(), { revision: 1 });
    assert.deepEqual(await store.readState(), { revision: 2 });
    closed();
  });
}

test("repeated atomic saves need no retries, stale cache or leaked descriptors", async (t) => {
  const { store } = await fixture(t);
  let revision = 1;
  const closed = interruptReads(t, store.file, "after-read", () =>
    replaceState(store.file, `${JSON.stringify({ revision: ++revision })}\n`), 40
  );
  for (let expected = 1; expected <= 40; expected += 1) {
    assert.deepEqual(await store.readState(), { revision: expected });
    closed();
  }
  assert.equal(revision, 41, "one physical read per requested snapshot");
  assert.deepEqual(await store.readState(), { revision: 41 });
  closed();
});

test("publication preserves the private temporary mode without chmod on the visible inode", async (t) => {
  const { store } = await fixture(t);
  const originalChmod = fs.chmod;
  const visibleChanges = [];
  t.mock.method(fs, "chmod", async (...args) => {
    if (args[0] === store.file) visibleChanges.push(args[0]);
    return originalChmod(...args);
  });
  await store.commitState({ revision: 2 });
  assert.deepEqual(visibleChanges, [], "post-publication chmod changes ctime during valid reads");
  assert.equal((await fs.lstat(store.file)).mode & 0o777, 0o600);
  assert.deepEqual(await store.readState(), { revision: 2 });
});

test("retirement does not hide in-place content changes", async (t) => {
  const { store } = await fixture(t);
  const closed = interruptReads(t, store.file, "after-read", async () => {
    await fs.writeFile(store.file, '{"revision":9999}\n');
    await replaceState(store.file, '{"revision":2}\n');
  });
  await assert.rejects(store.readState(), /state changed during read/);
  closed();
});

test("same-length in-place rewrites cannot masquerade as immutable snapshots", async (t) => {
  const { store } = await fixture(t);
  const closed = interruptReads(t, store.file, "after-read", () =>
    fs.writeFile(store.file, '{"revision":2}\n')
  );
  await assert.rejects(store.readState(), /state changed during read/);
  closed();
});

test("a pathname move with a still-linked old file is not atomic retirement", async (t) => {
  const { store } = await fixture(t);
  const closed = interruptReads(t, store.file, "before-stat", async () => {
    await fs.rename(store.file, `${store.file}.moved`);
    await replaceState(store.file, '{"revision":2}\n');
  });
  await assert.rejects(store.readState(), /moved instead of atomically replaced/);
  closed();
});

test("a retired snapshot does not bypass the successor pathname size bound", async (t) => {
  const { store } = await fixture(t, { revision: 1 }, { maximumStateBytes: 32 });
  const closed = interruptReads(t, store.file, "after-read", () =>
    replaceState(store.file, JSON.stringify({ value: "x".repeat(64) }))
  );
  await assert.rejects(store.readState(), /byte bound/);
  closed();
});

for (const defect of ["symlink", "hardlink", "mode", "missing", "directory"]) {
  test(`a retired snapshot still rejects a ${defect} replacement path`, async (t) => {
    const { directory, store } = await fixture(t);
    const closed = interruptReads(t, store.file, "after-read", async () => {
      await replaceState(store.file, '{"revision":2}\n');
      if (defect === "symlink") {
        const target = path.join(directory, "target.json");
        await fs.rename(store.file, target);
        await fs.symlink(target, store.file);
      } else if (defect === "hardlink") {
        await fs.link(store.file, path.join(directory, "alias.json"));
      } else if (defect === "mode") await fs.chmod(store.file, 0o644);
      else {
        await fs.unlink(store.file);
        if (defect === "directory") await fs.mkdir(store.file, { mode: 0o700 });
      }
    });
    await assert.rejects(store.readState());
    closed();
  });
}

test("in-place hardlink or mode changes fail even if content is unchanged", async (t) => {
  for (const defect of ["hardlink", "mode"]) {
    await t.test(defect, async (child) => {
      const { directory, store } = await fixture(child);
      const closed = interruptReads(child, store.file, "after-read", () =>
        defect === "mode" ? fs.chmod(store.file, 0o644)
          : fs.link(store.file, path.join(directory, "alias.json"))
      );
      await assert.rejects(store.readState());
      closed();
    });
  }
});

test("a malformed successor is not cached away by the preceding valid snapshot", async (t) => {
  const { store } = await fixture(t);
  const closed = interruptReads(t, store.file, "after-read", () =>
    replaceState(store.file, '{"incomplete":\n')
  );
  assert.deepEqual(await store.readState(), { revision: 1 });
  await assert.rejects(store.readState(), /state JSON is invalid/);
  closed();
});

test("replacement cannot move a snapshot outside its pinned authority directory", async (t) => {
  const { directory, store } = await fixture(t);
  const moved = `${directory}-moved`;
  t.after(() => fs.rm(moved, { recursive: true, force: true }));
  const closed = interruptReads(t, store.file, "after-read", async () => {
    await fs.rename(directory, moved);
    await fs.mkdir(directory, { mode: 0o700 });
    await fs.writeFile(store.file, '{"revision":2}\n', { mode: 0o600 });
  });
  await assert.rejects(store.readState(), /authority directory changed/);
  closed();
});

test("atomic retirement does not disable readiness or drop a one-shot preamble", async (t) => {
  const state = { schemaVersion: 1, contract: "shared-narration-v1", segments: [] };
  const { directory, store } = await fixture(t, state);
  let service, subscription, rpc;
  const errors = [];
  const runtime = registerVimicateNarrationPlugin({
    agent: { events: { registerAgentEventSubscription: (value) => { subscription = value; } } },
    registerService: (value) => { service = value; },
    registerGatewayMethod: (_name, value) => { rpc = value; },
    logger: { error: (value) => errors.push(value) }
  }, { vimicateDir: directory, store, formatError: (message) => ({ message }) });
  await service.start();
  const closed = interruptReads(t, store.file, "after-read", () =>
    replaceState(store.file, `${JSON.stringify(state)}\n`)
  );
  const stableSessionKey = "agent:main:direct:narration-snapshot-test";
  const sessionId = "11111111-1111-4111-8111-111111111111";
  await subscription.handle({
    stream: "item", sessionKey: stableSessionKey, sessionId,
    runId: "run-one", seq: 1, ts: 1000,
    data: { kind: "preamble", source: "codex-app-server", phase: "update",
      itemId: "item-one", progressText: "One-shot preamble survives." }
  });
  assert.equal(runtime.isReady(), true);
  assert.equal(runtime.failure(), undefined);
  assert.deepEqual(errors, []);
  const response = await new Promise((resolve) => rpc({
    params: { contract: "shared-narration-v1", stableSessionKey, sessionId },
    respond: (ok, payload, error) => resolve({ ok, payload, error })
  }));
  assert.equal(response.ok, true);
  assert.equal(response.payload.totalRecords, 1);
  assert.equal(response.payload.records[0].text, "One-shot preamble survives.");
  closed();
  await service.stop();
});

test("a separate page reader converges after the real record writer publishes", async (t) => {
  const state = { schemaVersion: 1, contract: "shared-narration-v1", segments: [] };
  const { directory, store } = await fixture(t, state);
  const writerStore = createVimicateNarrationStateStore({ vimicateDir: directory });
  const writer = createVimicateNarrationRecordContract(writerStore);
  const reader = createVimicateNarrationRecordContract(store);
  const event = {
    stream: "item", sessionKey: "agent:main:direct:narration-writer-test",
    sessionId: "11111111-1111-4111-8111-111111111111",
    runId: "run-one", seq: 1, ts: 1000,
    data: { kind: "preamble", source: "codex-app-server", phase: "update",
      itemId: "item-one", progressText: "First publication." }
  };
  await writer.record(event);
  const closed = interruptReads(t, store.file, "after-read", () => writer.record({
    ...event, seq: 2, ts: 2000,
    data: { ...event.data, itemId: "item-two", progressText: "Second publication." }
  }));
  const params = { contract: "shared-narration-v1", stableSessionKey: event.sessionKey,
    sessionId: event.sessionId };
  const inFlight = await reader.request(params);
  assert.deepEqual(inFlight.records.map((row) => row.text), ["First publication."]);
  const next = await reader.request(params);
  assert.deepEqual(next.records.map((row) => row.text), [
    "First publication.", "Second publication."
  ]);
  assert.notEqual(next.snapshotToken, inFlight.snapshotToken);
  const continued = await reader.request({ ...params, snapshotToken: inFlight.snapshotToken });
  assert.deepEqual(continued.records.map(row => row.text), ["First publication."]);
  closed();
});

for (const defect of ['symlink', 'hardlink', 'mode', 'directory']) {
  test(`a retained page view cannot bypass current filesystem ${defect} authority`, async t => {
    const { directory, store } = await fixture(t, { schemaVersion: 1, contract: 'shared-narration-v1', segments: [] });
    const contract = createVimicateNarrationRecordContract(store);
    const event = { stream: 'item', sessionKey: 'agent:main:direct:synthetic-retained-authority',
      sessionId: '11111111-1111-4111-8111-111111111111', runId: 'r', seq: 1, ts: 1000,
      data: { kind: 'preamble', source: 'codex-app-server', phase: 'update', itemId: 'pre', progressText: 'checking' } };
    await contract.record(event);
    const params = { contract: 'shared-narration-v1', stableSessionKey: event.sessionKey, sessionId: event.sessionId };
    const first = await contract.request(params);
    if (defect === 'mode') await fs.chmod(store.file, 0o644);
    else if (defect === 'hardlink') await fs.link(store.file, `${store.file}.linked`);
    else if (defect === 'symlink') {
      await fs.rename(store.file, `${store.file}.target`);
      await fs.symlink(`${store.file}.target`, store.file);
    } else {
      const moved = `${directory}.moved`;
      await fs.rename(directory, moved);
      t.after(() => fs.rm(moved, { recursive: true, force: true }));
      await fs.mkdir(directory, { mode: 0o700 });
    }
    await assert.rejects(contract.request({ ...params, snapshotToken: first.snapshotToken }),
      /private|0600|fixed regular file|authority directory changed/);
  });
}
