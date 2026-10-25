import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  VIMICATE_NARRATION_HEALTH_FILENAME,
  VIMICATE_NARRATION_STATE_FILENAME,
  createVimicateNarrationStateStore,
  registerVimicateNarrationPlugin
} from "./vimicate-narration-plugin-runtime.mjs";

const stableSessionKey = "agent:main:direct:vimicate-runtime";
const sessionId = "11111111-1111-4111-8111-111111111111";

async function fixture() {
  const temporaryRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "vimicate-narration-")
  );
  // macOS commonly exposes TMPDIR through `/var`, while its canonical path is
  // `/private/var`. The runtime intentionally rejects non-canonical authority
  // roots, so exercise it with the descriptor's real path instead of weakening
  // that production invariant for a test-only pathname alias.
  const root = await fs.realpath(temporaryRoot);
  const vimicateDir = path.join(root, "vimicate");
  await fs.mkdir(vimicateDir, { mode: 0o700 });
  return { root, vimicateDir };
}

function fakeAPI() {
  const methods = new Map();
  const services = new Map();
  const subscriptions = new Map();
  const logs = [];
  return {
    api: {
      agent: {
        events: {
          registerAgentEventSubscription: (subscription) => {
            subscriptions.set(subscription.id, subscription);
          }
        }
      },
      logger: {
        error: (message) => logs.push(["error", message]),
        info: (message) => logs.push(["info", message])
      },
      registerGatewayMethod: (name, handler, options) => {
        methods.set(name, { handler, options });
      },
      registerService: (service) => services.set(service.id, service)
    },
    logs,
    methods,
    services,
    subscriptions
  };
}

function runContext() {
  const values = new Map();
  return {
    clearRunContext: (namespace) => values.delete(namespace),
    getRunContext: (namespace) => values.get(namespace),
    setRunContext: (namespace, value) => values.set(
      namespace,
      structuredClone(value)
    )
  };
}

function preamble({
  seq = 7,
  ts = 1_000,
  text = "Checking the shared transcript.",
  stream = "item",
  kind = "preamble"
} = {}) {
  return {
    runId: "run-a",
    seq,
    ts,
    stream,
    sessionKey: stableSessionKey,
    sessionId,
    data: {
      itemId: "item-a",
      kind,
      source: "codex-app-server",
      phase: "update",
      progressText: text
    }
  };
}

function pageParams() {
  return {
    contract: "shared-narration-v1",
    stableSessionKey,
    sessionId,
    cursor: 0,
    limit: 128
  };
}

function lifecycle() {
  return {
    runId: "run-a",
    seq: 1,
    ts: 900,
    stream: "lifecycle",
    sessionKey: stableSessionKey,
    sessionId,
    data: { phase: "start" }
  };
}

async function request(method, params = pageParams()) {
  return new Promise((resolve) => {
    method.handler({
      params,
      respond: (ok, payload, error) => resolve({ ok, payload, error })
    });
  });
}

test("state store atomically round-trips a private fixed file", async (t) => {
  const files = await fixture();
  t.after(() => fs.rm(files.root, { recursive: true, force: true }));
  const store = createVimicateNarrationStateStore({
    vimicateDir: files.vimicateDir
  });
  assert.equal(await store.readState(), undefined);
  await store.commitState({
    schemaVersion: 1,
    contract: "shared-narration-v1",
    segments: []
  });
  assert.deepEqual(await store.readState(), {
    schemaVersion: 1,
    contract: "shared-narration-v1",
    segments: []
  });
  const stat = await fs.lstat(path.join(
    files.vimicateDir,
    VIMICATE_NARRATION_STATE_FILENAME
  ));
  assert.equal(stat.isFile(), true);
  assert.equal(stat.isSymbolicLink(), false);
  assert.equal(stat.mode & 0o777, 0o600);
  assert.equal(stat.nlink, 1);
  assert.deepEqual((await fs.readdir(files.vimicateDir)).sort(), [
    VIMICATE_NARRATION_STATE_FILENAME
  ]);
});

test("state store rejects symlink targets, loose modes, and oversized writes", async (t) => {
  const files = await fixture();
  t.after(() => fs.rm(files.root, { recursive: true, force: true }));
  const outside = path.join(files.root, "outside.json");
  const stateFile = path.join(
    files.vimicateDir,
    VIMICATE_NARRATION_STATE_FILENAME
  );
  await fs.writeFile(outside, "{}");
  await fs.symlink(outside, stateFile);
  const symlinkStore = createVimicateNarrationStateStore({
    vimicateDir: files.vimicateDir
  });
  await assert.rejects(symlinkStore.readState(), /fixed regular file/);
  await fs.unlink(stateFile);
  await fs.writeFile(stateFile, "{}\n", { mode: 0o644 });
  await fs.chmod(stateFile, 0o644);
  const looseStore = createVimicateNarrationStateStore({
    vimicateDir: files.vimicateDir
  });
  await assert.rejects(looseStore.readState(), /mode 0600/);
  await fs.unlink(stateFile);
  const boundedStore = createVimicateNarrationStateStore({
    vimicateDir: files.vimicateDir,
    maximumStateBytes: 32
  });
  await assert.rejects(
    boundedStore.commitState({ value: "x".repeat(64) }),
    /byte bound/
  );
});

test("state store detects replacement of its pinned authority directory", async (t) => {
  const files = await fixture();
  t.after(() => fs.rm(files.root, { recursive: true, force: true }));
  const store = createVimicateNarrationStateStore({
    vimicateDir: files.vimicateDir
  });
  await store.probe();
  const moved = `${files.vimicateDir}-moved`;
  await fs.rename(files.vimicateDir, moved);
  await fs.mkdir(files.vimicateDir, { mode: 0o700 });
  await assert.rejects(store.readState(), /authority directory changed/);
});

test("plugin records exact sanitized item events and serves operator-read pages", async (t) => {
  const files = await fixture();
  t.after(() => fs.rm(files.root, { recursive: true, force: true }));
  const fake = fakeAPI();
  const runtime = registerVimicateNarrationPlugin(fake.api, {
    vimicateDir: files.vimicateDir,
    formatError: (message) => ({ code: "INVALID_REQUEST", message })
  });
  const subscription = fake.subscriptions.get("vimicate-shared-narration");
  assert.deepEqual(subscription.streams, ["lifecycle", "item"]);
  assert.equal(
    fake.methods.get("vimicate.narration.page").options.scope,
    "operator.read"
  );
  await fake.services.get("vimicate-shared-narration").start();
  assert.equal(runtime.isReady(), true);
  const health = JSON.parse(await fs.readFile(path.join(
    files.vimicateDir,
    VIMICATE_NARRATION_HEALTH_FILENAME
  ), "utf8"));
  assert.deepEqual(health, {
    schemaVersion: 1,
    contract: "shared-narration-v1",
    pid: process.pid,
    store: "shared-narration-state-v1",
    subscription: "sanitized-agent-lifecycle-item-v2",
    handler: "operator-read-rpc-v1",
    ready: true
  });
  await subscription.handle(preamble());
  await subscription.handle(preamble({
    seq: 8,
    ts: 1_100,
    text: "Checking the shared transcript. Now."
  }));
  const response = await request(fake.methods.get("vimicate.narration.page"));
  assert.equal(response.ok, true);
  assert.equal(response.payload.totalRecords, 1);
  assert.equal(response.payload.records[0].text, "Checking the shared transcript. Now.");
  assert.equal(response.payload.records[0].revision, 2);
  await fake.services.get("vimicate-shared-narration").stop();
  await assert.rejects(fs.stat(path.join(
    files.vimicateDir,
    VIMICATE_NARRATION_HEALTH_FILENAME
  )), /ENOENT/);
});

test("plugin binds item narration to lifecycle-owned session authority", async (t) => {
  const files = await fixture();
  t.after(() => fs.rm(files.root, { recursive: true, force: true }));
  const fake = fakeAPI();
  registerVimicateNarrationPlugin(fake.api, {
    vimicateDir: files.vimicateDir,
    formatError: (message) => ({ code: "INVALID_REQUEST", message })
  });
  await fake.services.get("vimicate-shared-narration").start();
  const subscription = fake.subscriptions.get("vimicate-shared-narration");
  const context = runContext();
  await subscription.handle(lifecycle(), context);
  const itemWithoutSessionId = preamble();
  delete itemWithoutSessionId.sessionId;
  await subscription.handle(itemWithoutSessionId, context);
  const response = await request(fake.methods.get("vimicate.narration.page"));
  assert.equal(response.ok, true);
  assert.equal(response.payload.totalRecords, 1);
  assert.equal(response.payload.records[0].itemId, "item-a");
});

test("irrelevant item events never create narration state", async (t) => {
  const files = await fixture();
  t.after(() => fs.rm(files.root, { recursive: true, force: true }));
  const fake = fakeAPI();
  registerVimicateNarrationPlugin(fake.api, {
    vimicateDir: files.vimicateDir,
    formatError: (message) => ({ code: "INVALID_REQUEST", message })
  });
  await fake.services.get("vimicate-shared-narration").start();
  const subscription = fake.subscriptions.get("vimicate-shared-narration");
  await subscription.handle(preamble({ stream: "tool" }));
  await subscription.handle(preamble({ kind: "function_call" }));
  await assert.rejects(fs.stat(path.join(
    files.vimicateDir,
    VIMICATE_NARRATION_STATE_FILENAME
  )), /ENOENT/);
});

test("malformed persisted state keeps health absent and RPC fails closed", async (t) => {
  const files = await fixture();
  t.after(() => fs.rm(files.root, { recursive: true, force: true }));
  await fs.writeFile(path.join(
    files.vimicateDir,
    VIMICATE_NARRATION_STATE_FILENAME
  ), "{\"schemaVersion\":999}\n", { mode: 0o600 });
  const fake = fakeAPI();
  const runtime = registerVimicateNarrationPlugin(fake.api, {
    vimicateDir: files.vimicateDir,
    formatError: (message) => ({ code: "INVALID_REQUEST", message })
  });
  await fake.services.get("vimicate-shared-narration").start();
  assert.equal(runtime.isReady(), false);
  assert.ok(runtime.failure());
  await assert.rejects(fs.stat(path.join(
    files.vimicateDir,
    VIMICATE_NARRATION_HEALTH_FILENAME
  )), /ENOENT/);
  const response = await request(fake.methods.get("vimicate.narration.page"));
  assert.equal(response.ok, false);
  assert.equal(response.error.code, "INVALID_REQUEST");
  assert.match(response.error.message, /state schema is invalid/);
});

test("runtime persistence failure is sticky and removes capability health", async (t) => {
  const files = await fixture();
  t.after(() => fs.rm(files.root, { recursive: true, force: true }));
  let state;
  let failWrites = false;
  const store = {
    file: path.join(files.vimicateDir, VIMICATE_NARRATION_STATE_FILENAME),
    probe: async () => ({
      contract: "shared-narration-state-v1",
      present: state != null,
      bytes: 0
    }),
    readState: async () => structuredClone(state),
    commitState: async (next) => {
      if (failWrites) throw new Error("simulated persistence failure");
      state = structuredClone(next);
    }
  };
  const fake = fakeAPI();
  const runtime = registerVimicateNarrationPlugin(fake.api, {
    vimicateDir: files.vimicateDir,
    store,
    formatError: (message) => ({ code: "INVALID_REQUEST", message })
  });
  await fake.services.get("vimicate-shared-narration").start();
  assert.equal(runtime.isReady(), true);
  failWrites = true;
  await fake.subscriptions.get("vimicate-shared-narration").handle(preamble());
  assert.equal(runtime.isReady(), false);
  assert.match(runtime.failure().message, /simulated persistence failure/);
  await assert.rejects(fs.stat(path.join(
    files.vimicateDir,
    VIMICATE_NARRATION_HEALTH_FILENAME
  )), /ENOENT/);
});

test("runtime state corruption discovered by RPC removes capability health", async (t) => {
  const files = await fixture();
  t.after(() => fs.rm(files.root, { recursive: true, force: true }));
  const fake = fakeAPI();
  const runtime = registerVimicateNarrationPlugin(fake.api, {
    vimicateDir: files.vimicateDir,
    formatError: (message) => ({ code: "INVALID_REQUEST", message })
  });
  await fake.services.get("vimicate-shared-narration").start();
  await fake.subscriptions.get("vimicate-shared-narration").handle(preamble());
  await fs.writeFile(path.join(
    files.vimicateDir,
    VIMICATE_NARRATION_STATE_FILENAME
  ), "{\"schemaVersion\":999}\n", { mode: 0o600 });
  const response = await request(fake.methods.get("vimicate.narration.page"));
  assert.equal(response.ok, false);
  assert.match(response.error.message, /state schema is invalid/);
  assert.equal(runtime.isReady(), false);
  assert.match(runtime.failure().message, /state schema is invalid/);
  await assert.rejects(fs.stat(path.join(
    files.vimicateDir,
    VIMICATE_NARRATION_HEALTH_FILENAME
  )), /ENOENT/);
});

test("unsupported plugin API fails before registering a partial runtime", () => {
  assert.throws(
    () => registerVimicateNarrationPlugin({
      registerGatewayMethod() {},
      registerService() {}
    }, {
      vimicateDir: "/tmp",
      formatError: (message) => ({ message })
    }),
    /agent event subscription API is required/
  );
});
