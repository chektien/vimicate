import assert from "node:assert/strict";
import crypto from "node:crypto";
import fsNative from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { VIMICATE_ARCHIVED_FAMILY_PROOF } from
  "./vimicate-history-family-contract.mjs";
import {
  registerVimicateHistoryFamilyPlugin,
  VIMICATE_HISTORY_FAMILY_HEALTH_FILENAME,
  VIMICATE_HISTORY_FAMILY_PROJECTOR_CONTRACT
} from "./vimicate-history-family-plugin-runtime.mjs";
import { openClawHistoryFamilyHostFiles } from
  "./vimicate-history-family-openclaw.mjs";

const key = "agent:main:dashboard:plugin-fixture";
const archivedId = "11111111-1111-4111-8111-111111111111";
const currentId = "22222222-2222-4222-8222-222222222222";

async function fixture({ secret = true } = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "vimicate-plugin-"));
  const stateDir = path.join(root, "openclaw");
  const vimicateDir = path.join(root, "vimicate");
  const sessionsDir = path.join(stateDir, "agents", "main", "sessions");
  const ownedTranscriptsDir = path.join(
    vimicateDir,
    openClawHistoryFamilyHostFiles.ownedTranscripts
  );
  await fs.mkdir(sessionsDir, { recursive: true });
  await fs.mkdir(vimicateDir);
  await fs.mkdir(ownedTranscriptsDir, { mode: 0o700 });
  const archivedFilename = `${archivedId}.jsonl.reset.2026-07-19T00-00-00.200Z`;
  const currentFilename = `${currentId}.jsonl`;
  await fs.writeFile(path.join(sessionsDir, archivedFilename), "archived\n");
  await fs.writeFile(
    path.join(ownedTranscriptsDir, `${archivedId}.jsonl`),
    "archived\n",
    { mode: 0o600 }
  );
  await fs.writeFile(path.join(sessionsDir, currentFilename), "current\n");
  await fs.writeFile(path.join(sessionsDir, "sessions.json"), JSON.stringify({
    [key]: {
      sessionId: currentId,
      sessionStartedAt: 300,
      sessionFile: path.join(sessionsDir, currentFilename)
    }
  }));
  if (secret) {
    await fs.writeFile(
      path.join(vimicateDir, openClawHistoryFamilyHostFiles.secret),
      `${"ab".repeat(32)}\n`,
      { mode: 0o600 }
    );
  }
  await fs.writeFile(
    path.join(vimicateDir, openClawHistoryFamilyHostFiles.ledger),
    JSON.stringify({
      schemaVersion: 1,
      proof: VIMICATE_ARCHIVED_FAMILY_PROOF,
      families: {
        [key]: {
          agentId: "main",
          segments: [
            {
              sessionId: archivedId,
              startedAtMs: 100,
              endedAtMs: 200,
              endReason: "reset",
              sourceRevision: crypto.createHash("sha256")
                .update("archived\n")
                .digest("hex"),
              transcriptFilename: archivedFilename
            },
            {
              sessionId: currentId,
              startedAtMs: 300,
              transcriptFilename: currentFilename
            }
          ]
        }
      }
    }),
    { mode: 0o600 }
  );
  return { root, stateDir, vimicateDir, sessionsDir, archivedFilename };
}

function fakeAPI(stateDir) {
  const methods = new Map();
  const hooks = new Map();
  const services = new Map();
  const logs = [];
  return {
    api: {
      runtime: { state: { resolveStateDir: () => stateDir } },
      logger: {
        error: (message) => logs.push(["error", message]),
        info: (message) => logs.push(["info", message])
      },
      on: (name, handler) => hooks.set(name, handler),
      registerGatewayMethod: (name, handler, options) => {
        methods.set(name, { handler, options });
      },
      registerService: (service) => services.set(service.id, service)
    },
    methods,
    hooks,
    services,
    logs
  };
}

function projector() {
  return {
    probe: async () => ({ contract: VIMICATE_HISTORY_FAMILY_PROJECTOR_CONTRACT }),
    readPage: async (request) => ({
      sessionId: request.sessionId,
      sessionKey: request.stableSessionKey,
      transcriptFilename: request.transcriptFilename,
      offset: request.offset,
      hasMore: false,
      totalMessages: 1,
      messages: [{ role: "assistant", content: "canonical" }]
    })
  };
}

function censusParams() {
  return {
    contract: "archived-family-v1",
    mode: "segments",
    stableSessionKey: key,
    expectedCurrentSessionId: currentId,
    expectedCurrentSessionStartedAtMs: 300,
    cursor: 0,
    limit: 8
  };
}

async function request(method, params) {
  return new Promise((resolve) => {
    method.handler({
      params,
      respond: (ok, payload, error) => resolve({ ok, payload, error })
    });
  });
}

async function waitFor(predicate, label, timeoutMs = 2_000) {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${label}`);
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

test("plugin advertises health only after writer, projector, secret and handler probe", async (t) => {
  const files = await fixture();
  t.after(() => fs.rm(files.root, { recursive: true, force: true }));
  const fake = fakeAPI(files.stateDir);
  const runtime = registerVimicateHistoryFamilyPlugin(fake.api, {
    stateDir: files.stateDir,
    vimicateDir: files.vimicateDir,
    projector: projector(),
    formatError: (message) => ({ code: "INVALID_REQUEST", message })
  });
  assert.equal(fake.methods.get("vimicate.history.family").options.scope, "operator.read");
  assert.equal(typeof fake.hooks.get("model_call_started"), "function");
  await fake.services.get("vimicate-history-family").start();
  assert.equal(runtime.isReady(), true);
  const healthFile = path.join(
    files.vimicateDir,
    VIMICATE_HISTORY_FAMILY_HEALTH_FILENAME
  );
  const health = JSON.parse(await fs.readFile(healthFile, "utf8"));
  assert.deepEqual(health, {
    schemaVersion: 1,
    contract: "archived-family-v1",
    pid: process.pid,
    writer: "session-end-ledger-v1",
    projector: "canonical-chat-history-page-v1",
    handler: "operator-read-rpc-v1",
    audit: "archived-family-audit-v1",
    ready: true
  });
  assert.equal((await fs.stat(healthFile)).mode & 0o777, 0o600);
  const response = await request(
    fake.methods.get("vimicate.history.family"),
    censusParams()
  );
  assert.equal(response.ok, true);
  assert.equal(response.payload.totalSegments, 2);
  await fake.services.get("vimicate-history-family").stop();
  await assert.rejects(fs.stat(healthFile), /ENOENT/);
});

test("missing secret keeps capability absent and returns Gateway-shaped error", async (t) => {
  const files = await fixture({ secret: false });
  t.after(() => fs.rm(files.root, { recursive: true, force: true }));
  const fake = fakeAPI(files.stateDir);
  const runtime = registerVimicateHistoryFamilyPlugin(fake.api, {
    stateDir: files.stateDir,
    vimicateDir: files.vimicateDir,
    projector: projector(),
    formatError: (message) => ({ code: "INVALID_REQUEST", message })
  });
  await fake.services.get("vimicate-history-family").start();
  assert.equal(runtime.isReady(), false);
  await assert.rejects(fs.stat(path.join(
    files.vimicateDir,
    VIMICATE_HISTORY_FAMILY_HEALTH_FILENAME
  )), /ENOENT/);
  const response = await request(
    fake.methods.get("vimicate.history.family"),
    censusParams()
  );
  assert.equal(response.ok, false);
  assert.equal(response.error.code, "INVALID_REQUEST");
  assert.match(response.error.message, /history-family-hmac\.key/);
});

test("tracked lineage conflict removes capability marker for this process", async (t) => {
  const files = await fixture();
  t.after(() => fs.rm(files.root, { recursive: true, force: true }));
  const fake = fakeAPI(files.stateDir);
  const runtime = registerVimicateHistoryFamilyPlugin(fake.api, {
    stateDir: files.stateDir,
    vimicateDir: files.vimicateDir,
    projector: projector(),
    formatError: (message) => ({ code: "INVALID_REQUEST", message })
  });
  await fake.services.get("vimicate-history-family").start();
  await fake.hooks.get("session_end")({
    sessionId: "33333333-3333-4333-8333-333333333333",
    sessionKey: key,
    reason: "reset",
    sessionFile: path.join(
      files.sessionsDir,
      "33333333-3333-4333-8333-333333333333.jsonl.reset.2026-07-19T00-00-00.300Z"
    ),
    nextSessionId: currentId
  }, { agentId: "main", sessionKey: key });
  assert.equal(runtime.isReady(), false);
  assert.ok(runtime.failure());
  await assert.rejects(fs.stat(path.join(
    files.vimicateDir,
    VIMICATE_HISTORY_FAMILY_HEALTH_FILENAME
  )), /ENOENT/);
});

test("unhealthy projector never publishes capability", async (t) => {
  const files = await fixture();
  t.after(() => fs.rm(files.root, { recursive: true, force: true }));
  const fake = fakeAPI(files.stateDir);
  const runtime = registerVimicateHistoryFamilyPlugin(fake.api, {
    stateDir: files.stateDir,
    vimicateDir: files.vimicateDir,
    projector: {
      ...projector(),
      probe: async () => ({ contract: "other" })
    },
    formatError: (message) => ({ code: "INVALID_REQUEST", message })
  });
  await fake.services.get("vimicate-history-family").start();
  assert.equal(runtime.isReady(), false);
  assert.match(runtime.failure().message, /projector probe/);
});

test("sticky lineage failure defeats an in-flight activation", async (t) => {
  const files = await fixture();
  t.after(() => fs.rm(files.root, { recursive: true, force: true }));
  const fake = fakeAPI(files.stateDir);
  let enterProbe;
  let releaseProbe;
  const entered = new Promise((resolve) => { enterProbe = resolve; });
  const released = new Promise((resolve) => { releaseProbe = resolve; });
  const delayedProjector = projector();
  delayedProjector.probe = async () => {
    enterProbe();
    await released;
    return { contract: VIMICATE_HISTORY_FAMILY_PROJECTOR_CONTRACT };
  };
  const runtime = registerVimicateHistoryFamilyPlugin(fake.api, {
    stateDir: files.stateDir,
    vimicateDir: files.vimicateDir,
    projector: delayedProjector,
    formatError: (message) => ({ code: "INVALID_REQUEST", message })
  });
  const startup = fake.services.get("vimicate-history-family").start();
  await entered;
  await fake.hooks.get("session_end")({
    sessionId: "33333333-3333-4333-8333-333333333333",
    sessionKey: key,
    reason: "reset",
    sessionFile: path.join(
      files.sessionsDir,
      "33333333-3333-4333-8333-333333333333.jsonl.reset.2026-07-19T00-00-00.300Z"
    ),
    nextSessionId: currentId
  }, { agentId: "main", sessionKey: key });
  releaseProbe();
  await startup;
  assert.equal(runtime.isReady(), false);
  assert.ok(runtime.failure());
  await assert.rejects(fs.stat(path.join(
    files.vimicateDir,
    VIMICATE_HISTORY_FAMILY_HEALTH_FILENAME
  )), /ENOENT/);
  const response = await request(
    fake.methods.get("vimicate.history.family"),
    censusParams()
  );
  assert.equal(response.ok, false);
});

test("RPC deadline cancellation reaches the family contract", async (t) => {
  const files = await fixture();
  t.after(() => fs.rm(files.root, { recursive: true, force: true }));
  const fake = fakeAPI(files.stateDir);
  const controller = new AbortController();
  controller.abort();
  registerVimicateHistoryFamilyPlugin(fake.api, {
    stateDir: files.stateDir,
    vimicateDir: files.vimicateDir,
    projector: projector(),
    createRequestSignal: () => controller.signal,
    formatError: (message) => ({ code: "INVALID_REQUEST", message })
  });
  const response = await request(
    fake.methods.get("vimicate.history.family"),
    censusParams()
  );
  assert.equal(response.ok, false);
  assert.match(response.error.message, /request was cancelled/);
});

test("RPC deadline covers a first-call activation without poisoning shared startup", async (t) => {
  const files = await fixture();
  t.after(() => fs.rm(files.root, { recursive: true, force: true }));
  const fake = fakeAPI(files.stateDir);
  const controller = new AbortController();
  let enterProbe;
  let releaseProbe;
  const entered = new Promise((resolve) => { enterProbe = resolve; });
  const released = new Promise((resolve) => { releaseProbe = resolve; });
  const delayedProjector = projector();
  delayedProjector.probe = async () => {
    enterProbe();
    await released;
    return { contract: VIMICATE_HISTORY_FAMILY_PROJECTOR_CONTRACT };
  };
  const runtime = registerVimicateHistoryFamilyPlugin(fake.api, {
    stateDir: files.stateDir,
    vimicateDir: files.vimicateDir,
    projector: delayedProjector,
    createRequestSignal: () => controller.signal,
    formatError: (message) => ({ code: "INVALID_REQUEST", message })
  });
  const pending = request(
    fake.methods.get("vimicate.history.family"),
    censusParams()
  );
  await entered;
  controller.abort();
  const response = await pending;
  assert.equal(response.ok, false);
  assert.match(response.error.message, /request was cancelled/);
  assert.equal(runtime.failure(), undefined);
  releaseProbe();
  await waitFor(() => runtime.isReady(), "shared activation completion");
});

test("an invalid client request does not disable a healthy audited host", async (t) => {
  const files = await fixture();
  t.after(() => fs.rm(files.root, { recursive: true, force: true }));
  const fake = fakeAPI(files.stateDir);
  const runtime = registerVimicateHistoryFamilyPlugin(fake.api, {
    stateDir: files.stateDir,
    vimicateDir: files.vimicateDir,
    projector: projector(),
    formatError: (message) => ({ code: "INVALID_REQUEST", message })
  });
  await fake.services.get("vimicate-history-family").start();
  const ownedTranscript = path.join(
    files.vimicateDir,
    openClawHistoryFamilyHostFiles.ownedTranscripts,
    `${archivedId}.jsonl`
  );
  await fs.rm(ownedTranscript);
  const response = await request(fake.methods.get("vimicate.history.family"), {
    ...censusParams(),
    stableSessionKey: "agent:main:dashboard:not-a-family"
  });
  assert.equal(response.ok, false);
  await new Promise((resolve) => setTimeout(resolve, 25));
  assert.equal(runtime.isReady(), true);
  await fs.stat(path.join(
    files.vimicateDir,
    VIMICATE_HISTORY_FAMILY_HEALTH_FILENAME
  ));
  await fs.writeFile(ownedTranscript, "archived\n", { mode: 0o600 });
});

test("live current append is transient and preserves advertised health", async (t) => {
  const files = await fixture();
  t.after(() => fs.rm(files.root, { recursive: true, force: true }));
  const fake = fakeAPI(files.stateDir);
  const runtime = registerVimicateHistoryFamilyPlugin(fake.api, {
    stateDir: files.stateDir,
    vimicateDir: files.vimicateDir,
    projector: projector(),
    formatError: (message) => ({ code: "INVALID_REQUEST", message })
  });
  await fake.services.get("vimicate-history-family").start();

  const current = path.join(files.sessionsDir, `${currentId}.jsonl`);
  await fs.appendFile(current, "before-runtime-rehash\n");
  const probe = await fs.open(current);
  const prototype = Object.getPrototypeOf(probe);
  await probe.close();
  const original = prototype.createReadStream;
  let mutated = false;
  prototype.createReadStream = function (...args) {
    const stream = original.apply(this, args);
    if (!mutated) {
      mutated = true;
      fsNative.appendFileSync(current, "during-runtime-rehash\n");
    }
    return stream;
  };
  t.after(() => { prototype.createReadStream = original; });

  const response = await request(
    fake.methods.get("vimicate.history.family"),
    censusParams()
  );
  prototype.createReadStream = original;
  assert.equal(response.ok, false);
  assert.equal(mutated, true);
  await new Promise((resolve) => setTimeout(resolve, 25));
  assert.equal(runtime.isReady(), true);
  await fs.stat(path.join(
    files.vimicateDir,
    VIMICATE_HISTORY_FAMILY_HEALTH_FILENAME
  ));
});

test("runtime directory-authority replacement disables advertised health", async (t) => {
  const files = await fixture();
  t.after(() => fs.rm(files.root, { recursive: true, force: true }));
  const fake = fakeAPI(files.stateDir);
  const runtime = registerVimicateHistoryFamilyPlugin(fake.api, {
    stateDir: files.stateDir,
    vimicateDir: files.vimicateDir,
    projector: projector(),
    formatError: (message) => ({ code: "INVALID_REQUEST", message })
  });
  await fake.services.get("vimicate-history-family").start();
  const displaced = `${files.sessionsDir}-displaced`;
  await fs.rename(files.sessionsDir, displaced);
  await fs.symlink(displaced, files.sessionsDir);

  const response = await request(
    fake.methods.get("vimicate.history.family"),
    censusParams()
  );
  assert.equal(response.ok, false);
  await waitFor(() => !runtime.isReady(), "runtime authority disable");
  assert.equal(runtime.failure()?.vimicateHistoryFamilyFailureKind, "integrity");
});

test("a runtime retained-transcript integrity failure removes capability", async (t) => {
  const files = await fixture();
  t.after(() => fs.rm(files.root, { recursive: true, force: true }));
  const fake = fakeAPI(files.stateDir);
  const runtime = registerVimicateHistoryFamilyPlugin(fake.api, {
    stateDir: files.stateDir,
    vimicateDir: files.vimicateDir,
    projector: projector(),
    formatError: (message) => ({ code: "INVALID_REQUEST", message })
  });
  await fake.services.get("vimicate-history-family").start();
  await fs.rm(path.join(
    files.vimicateDir,
    openClawHistoryFamilyHostFiles.ownedTranscripts,
    `${archivedId}.jsonl`
  ));
  const response = await request(
    fake.methods.get("vimicate.history.family"),
    censusParams()
  );
  assert.equal(response.ok, false);
  await waitFor(() => !runtime.isReady(), "runtime integrity disable");
  assert.equal(runtime.isReady(), false);
  assert.ok(runtime.failure());
  const healthFile = path.join(
    files.vimicateDir,
    VIMICATE_HISTORY_FAMILY_HEALTH_FILENAME
  );
  await waitFor(
    () => fs.stat(healthFile).then(() => false, (error) => error?.code === "ENOENT"),
    "runtime health removal"
  );
});

test("service stop invalidates delayed activation and rejects later lifecycle work", async (t) => {
  const files = await fixture();
  t.after(() => fs.rm(files.root, { recursive: true, force: true }));
  const fake = fakeAPI(files.stateDir);
  let enterProbe;
  let releaseProbe;
  const entered = new Promise((resolve) => { enterProbe = resolve; });
  const released = new Promise((resolve) => { releaseProbe = resolve; });
  const delayedProjector = projector();
  delayedProjector.probe = async () => {
    enterProbe();
    await released;
    return { contract: VIMICATE_HISTORY_FAMILY_PROJECTOR_CONTRACT };
  };
  const runtime = registerVimicateHistoryFamilyPlugin(fake.api, {
    stateDir: files.stateDir,
    vimicateDir: files.vimicateDir,
    projector: delayedProjector,
    formatError: (message) => ({ code: "INVALID_REQUEST", message })
  });
  const startup = fake.services.get("vimicate-history-family").start();
  await entered;
  const stopped = fake.services.get("vimicate-history-family").stop();
  releaseProbe();
  await Promise.all([startup, stopped]);
  await fake.hooks.get("session_end")({
    sessionId: currentId,
    sessionKey: key,
    reason: "reset"
  }, { agentId: "main", sessionKey: key });
  assert.equal(runtime.isReady(), false);
  assert.equal(runtime.failure(), undefined);
  await assert.rejects(fs.stat(path.join(
    files.vimicateDir,
    VIMICATE_HISTORY_FAMILY_HEALTH_FILENAME
  )), /ENOENT/);
});
