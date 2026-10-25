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
  loadOpenClawHistoryFamilyContract,
  openClawHistoryFamilyHostFiles
} from "./vimicate-history-family-openclaw.mjs";

const key = "agent:main:dashboard:fixture";
const archivedId = "11111111-1111-4111-8111-111111111111";
const currentId = "22222222-2222-4222-8222-222222222222";

function censusParams() {
  return {
    contract: "archived-family-v1",
    mode: "segments",
    stableSessionKey: key,
    expectedCurrentSessionId: currentId,
    expectedCurrentSessionStartedAtMs: 300,
    cursor: 0,
    limit: 2
  };
}

async function loadFixtureContract(files) {
  return loadOpenClawHistoryFamilyContract({
    stateDir: files.stateDir,
    vimicateDir: files.vimicateDir,
    readProjectedHistoryPage: async () => ({})
  });
}

async function waitUntil(predicate, label) {
  for (let attempt = 0; attempt < 1_000; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setImmediate(resolve));
  }
  assert.fail(`timed out waiting for ${label}`);
}

async function readDescriptorAtZero(file) {
  const handle = await fs.open(file, fsNative.constants.O_RDONLY);
  try {
    const stat = await handle.stat();
    const buffer = Buffer.alloc(stat.size);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    return buffer.subarray(0, bytesRead).toString("utf8");
  } finally {
    await handle.close();
  }
}

async function addFamily(files, familyKey, archivedSessionId, currentSessionId) {
  const archivedFilename =
    `${archivedSessionId}.jsonl.reset.2026-07-19T00-00-00.200Z`;
  const currentFilename = `${currentSessionId}.jsonl`;
  const archivedContent = `${familyKey}-archived\n`;
  await fs.writeFile(path.join(files.sessionsDir, archivedFilename), archivedContent);
  await fs.writeFile(
    path.join(
      files.vimicateDir,
      openClawHistoryFamilyHostFiles.ownedTranscripts,
      `${archivedSessionId}.jsonl`
    ),
    archivedContent,
    { mode: 0o600 }
  );
  await fs.writeFile(path.join(files.sessionsDir, currentFilename), `${familyKey}-current\n`);

  const storeFile = path.join(files.sessionsDir, "sessions.json");
  const store = JSON.parse(await fs.readFile(storeFile, "utf8"));
  store[familyKey] = {
    sessionId: currentSessionId,
    sessionStartedAt: 300,
    sessionFile: path.join(files.sessionsDir, currentFilename)
  };
  await fs.writeFile(storeFile, JSON.stringify(store));

  const ledgerFile = path.join(
    files.vimicateDir,
    openClawHistoryFamilyHostFiles.ledger
  );
  const ledger = JSON.parse(await fs.readFile(ledgerFile, "utf8"));
  ledger.families[familyKey] = {
    agentId: "main",
    segments: [
      {
        sessionId: archivedSessionId,
        startedAtMs: 100,
        endedAtMs: 200,
        endReason: "reset",
        sourceRevision: crypto.createHash("sha256")
          .update(archivedContent)
          .digest("hex"),
        transcriptFilename: archivedFilename
      },
      {
        sessionId: currentSessionId,
        startedAtMs: 300,
        transcriptFilename: currentFilename
      }
    ]
  };
  await fs.writeFile(ledgerFile, JSON.stringify(ledger));
}

function censusParamsFor(familyKey, currentSessionId) {
  return {
    ...censusParams(),
    stableSessionKey: familyKey,
    expectedCurrentSessionId: currentSessionId
  };
}

function indexedSessionId(index, current) {
  const ordinal = index * 2 + (current ? 1 : 0);
  return `${(0x70000000 + ordinal).toString(16)}-7777-4777-8777-`
    + ordinal.toString(16).padStart(12, "0");
}

async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "vimicate-family-host-"));
  const stateDir = path.join(root, "openclaw");
  const vimicateDir = path.join(root, "vimicate");
  const sessionsDir = path.join(stateDir, "agents", "main", "sessions");
  await fs.mkdir(sessionsDir, { recursive: true });
  await fs.mkdir(vimicateDir, { recursive: true });
  await fs.mkdir(
    path.join(vimicateDir, openClawHistoryFamilyHostFiles.ownedTranscripts),
    { mode: 0o700 }
  );
  await fs.writeFile(path.join(sessionsDir, "sessions.json"), JSON.stringify({
    [key]: {
      sessionId: currentId,
      sessionStartedAt: 300,
      sessionFile: path.join(sessionsDir, `${currentId}.jsonl`)
    }
  }));
  const archivedFilename = `${archivedId}.jsonl.reset.2026-07-19T00-00-00.200Z`;
  const currentFilename = `${currentId}.jsonl`;
  await fs.writeFile(path.join(sessionsDir, archivedFilename), "archived\n");
  await fs.writeFile(
    path.join(
      vimicateDir,
      openClawHistoryFamilyHostFiles.ownedTranscripts,
      `${archivedId}.jsonl`
    ),
    "archived\n",
    { mode: 0o600 }
  );
  await fs.writeFile(path.join(sessionsDir, currentFilename), "current\n");
  await fs.writeFile(
    path.join(vimicateDir, openClawHistoryFamilyHostFiles.secret),
    `${"ab".repeat(32)}\n`,
    { mode: 0o600 }
  );
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
              sourceRevision: crypto
                .createHash("sha256")
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
    })
  );
  return { root, stateDir, vimicateDir, sessionsDir };
}

test("filesystem adapter reads only fixed audited host files", async (t) => {
  const files = await fixture();
  t.after(() => fs.rm(files.root, { recursive: true, force: true }));
  const requests = [];
  let archivedDescriptorPath;
  const contract = await loadOpenClawHistoryFamilyContract({
    stateDir: files.stateDir,
    vimicateDir: files.vimicateDir,
    readProjectedHistoryPage: async (request) => {
      requests.push(request);
      archivedDescriptorPath = request.sessionFile;
      assert.match(request.sessionFile, /^\/dev\/fd\/\d+$/);
      assert.equal(await readDescriptorAtZero(request.sessionFile), "archived\n");
      return {
        sessionId: request.sessionId,
        sessionKey: request.stableSessionKey,
        transcriptFilename: request.transcriptFilename,
        offset: request.offset,
        hasMore: false,
        totalMessages: 1,
        messages: [{ role: "user", content: "fixture" }]
      };
    }
  });
  assert.deepEqual(await contract.probe(), {
    contract: "archived-family-audit-v1",
    proof: VIMICATE_ARCHIVED_FAMILY_PROOF,
    families: 1,
    segments: 2,
    transcriptBytes: Buffer.byteLength("archived\ncurrent\n")
  });
  const census = await contract({
    contract: "archived-family-v1",
    mode: "segments",
    stableSessionKey: key,
    expectedCurrentSessionId: currentId,
    expectedCurrentSessionStartedAtMs: 300,
    cursor: 0,
    limit: 2
  });
  const page = await contract({
    contract: "archived-family-v1",
    mode: "page",
    stableSessionKey: key,
    expectedCurrentSessionId: currentId,
    expectedCurrentSessionStartedAtMs: 300,
    familyToken: census.familyToken,
    sessionId: archivedId,
    segmentOrder: 0,
    sourceRevision: census.segments[0].sourceRevision,
    offset: 0,
    limit: 2
  });
  assert.deepEqual(page.messages, [{ role: "user", content: "fixture" }]);
  assert.equal(requests[0].transcriptFilename, census.segments[0].sessionId
    + ".jsonl.reset.2026-07-19T00-00-00.200Z");
  assert.equal(
    requests[0].storePath,
    "/dev/fd/sessions.json"
  );
  assert.equal(path.dirname(requests[0].sessionFile), "/dev/fd");
  await assert.rejects(fs.readFile(archivedDescriptorPath));
  assert.ok(!JSON.stringify(page).includes(files.root));
});

test("archived projection remains on its pinned descriptor if owned authority is replaced", async (t) => {
  const files = await fixture();
  t.after(() => fs.rm(files.root, { recursive: true, force: true }));
  const owned = path.join(
    files.vimicateDir,
    openClawHistoryFamilyHostFiles.ownedTranscripts,
    `${archivedId}.jsonl`
  );
  const outside = path.join(files.root, "outside-same-session.jsonl");
  await fs.writeFile(outside, "outside\n");
  let descriptorPath;
  const contract = await loadOpenClawHistoryFamilyContract({
    stateDir: files.stateDir,
    vimicateDir: files.vimicateDir,
    readProjectedHistoryPage: async (request) => {
      descriptorPath = request.sessionFile;
      assert.equal(await readDescriptorAtZero(descriptorPath), "archived\n");
      await fs.rm(owned);
      await fs.symlink(outside, owned);
      assert.equal(await readDescriptorAtZero(descriptorPath), "archived\n");
      return {
        sessionId: request.sessionId,
        sessionKey: request.stableSessionKey,
        transcriptFilename: request.transcriptFilename,
        offset: request.offset,
        hasMore: false,
        totalMessages: 1,
        messages: [{ role: "user", content: "pinned descriptor" }]
      };
    }
  });
  const census = await contract(censusParams());
  await assert.rejects(contract({
    contract: "archived-family-v1",
    mode: "page",
    stableSessionKey: key,
    expectedCurrentSessionId: currentId,
    expectedCurrentSessionStartedAtMs: 300,
    familyToken: census.familyToken,
    sessionId: archivedId,
    segmentOrder: 0,
    sourceRevision: census.segments[0].sourceRevision,
    offset: 0,
    limit: 2
  }), /non-symlink|could not be opened/);
  await assert.rejects(fs.readFile(descriptorPath));
});

test("archived projection closes its pinned descriptor when cancellation wins", async (t) => {
  const files = await fixture();
  t.after(() => fs.rm(files.root, { recursive: true, force: true }));
  const controller = new AbortController();
  let descriptorPath;
  const contract = await loadOpenClawHistoryFamilyContract({
    stateDir: files.stateDir,
    vimicateDir: files.vimicateDir,
    readProjectedHistoryPage: async (request) => {
      descriptorPath = request.sessionFile;
      assert.equal(await readDescriptorAtZero(descriptorPath), "archived\n");
      controller.abort();
      return {
        sessionId: request.sessionId,
        sessionKey: request.stableSessionKey,
        transcriptFilename: request.transcriptFilename,
        offset: request.offset,
        hasMore: false,
        totalMessages: 1,
        messages: [{ role: "user", content: "cancelled" }]
      };
    }
  });
  const census = await contract(censusParams());
  await assert.rejects(contract({
    contract: "archived-family-v1",
    mode: "page",
    stableSessionKey: key,
    expectedCurrentSessionId: currentId,
    expectedCurrentSessionStartedAtMs: 300,
    familyToken: census.familyToken,
    sessionId: archivedId,
    segmentOrder: 0,
    sourceRevision: census.segments[0].sourceRevision,
    offset: 0,
    limit: 2
  }, { signal: controller.signal }), /cancelled/);
  await assert.rejects(fs.readFile(descriptorPath));
});

test("archived projection cancellation settles while the canonical reader is pending", async (t) => {
  const files = await fixture();
  t.after(() => fs.rm(files.root, { recursive: true, force: true }));
  const controller = new AbortController();
  let descriptorPath;
  let enteredResolve;
  const entered = new Promise((resolve) => { enteredResolve = resolve; });
  let releaseResolve;
  const release = new Promise((resolve) => { releaseResolve = resolve; });
  const contract = await loadOpenClawHistoryFamilyContract({
    stateDir: files.stateDir,
    vimicateDir: files.vimicateDir,
    readProjectedHistoryPage: async (request) => {
      descriptorPath = request.sessionFile;
      enteredResolve();
      await release;
      assert.equal(await readDescriptorAtZero(descriptorPath), "archived\n");
      return {
        sessionId: request.sessionId,
        sessionKey: request.stableSessionKey,
        transcriptFilename: request.transcriptFilename,
        offset: request.offset,
        hasMore: false,
        totalMessages: 1,
        messages: [{ role: "user", content: "late projection" }]
      };
    }
  });
  const census = await contract(censusParams());
  const request = contract({
    contract: "archived-family-v1",
    mode: "page",
    stableSessionKey: key,
    expectedCurrentSessionId: currentId,
    expectedCurrentSessionStartedAtMs: 300,
    familyToken: census.familyToken,
    sessionId: archivedId,
    segmentOrder: 0,
    sourceRevision: census.segments[0].sourceRevision,
    offset: 0,
    limit: 2
  }, { signal: controller.signal });
  await entered;
  controller.abort();
  await assert.rejects(request, /cancelled/);
  assert.equal(await readDescriptorAtZero(descriptorPath), "archived\n");
  const other = path.join(files.root, "post-cancel.jsonl");
  await fs.writeFile(other, "different\n");
  const otherHandle = await fs.open(other, fsNative.constants.O_RDONLY);
  assert.notEqual(otherHandle.fd, Number(path.basename(descriptorPath)));
  await otherHandle.close();
  releaseResolve();
  for (let attempt = 0; attempt < 1_000; attempt += 1) {
    if (!await fs.stat(descriptorPath).then(() => true, () => false)) break;
    await new Promise((resolve) => setImmediate(resolve));
  }
  await assert.rejects(fs.readFile(descriptorPath));
});

test("filesystem adapter rejects permissive secret permissions", async (t) => {
  const files = await fixture();
  t.after(() => fs.rm(files.root, { recursive: true, force: true }));
  await fs.chmod(
    path.join(files.vimicateDir, openClawHistoryFamilyHostFiles.secret),
    0o644
  );
  await assert.rejects(loadOpenClawHistoryFamilyContract({
    stateDir: files.stateDir,
    vimicateDir: files.vimicateDir,
    readProjectedHistoryPage: async () => ({})
  }), /mode-0600/);
});

test("filesystem adapter quarantines a family missing immutable current epoch", async (t) => {
  const files = await fixture();
  t.after(() => fs.rm(files.root, { recursive: true, force: true }));
  await fs.writeFile(path.join(files.sessionsDir, "sessions.json"), JSON.stringify({
    [key]: { sessionId: currentId }
  }));
  const contract = await loadOpenClawHistoryFamilyContract({
    stateDir: files.stateDir,
    vimicateDir: files.vimicateDir,
    readProjectedHistoryPage: async () => ({})
  });
  await assert.rejects(
    contract({
      contract: "archived-family-v1",
      mode: "segments",
      stableSessionKey: key,
      expectedCurrentSessionId: currentId,
      expectedCurrentSessionStartedAtMs: 300,
      cursor: 0,
      limit: 2
    }),
    (error) => {
      assert.match(String(error), /immutable id\/epoch/);
      assert.equal(error?.vimicateHistoryFamilyFailureKind, "unavailable");
      return true;
    }
  );
  await fs.writeFile(path.join(files.sessionsDir, "sessions.json"), JSON.stringify({
    [key]: {
      sessionId: currentId,
      sessionStartedAt: 300,
      sessionFile: path.join(files.sessionsDir, `${currentId}.jsonl`)
    }
  }));
  const recovered = await contract(censusParams());
  assert.equal(recovered.segments.at(-1).sessionId, currentId);
});

test("filesystem adapter rejects a mismatched current transcript target", async (t) => {
  const files = await fixture();
  t.after(() => fs.rm(files.root, { recursive: true, force: true }));
  const wrongTarget = path.join(files.sessionsDir, `${archivedId}.jsonl`);
  await fs.writeFile(path.join(files.sessionsDir, "sessions.json"), JSON.stringify({
    [key]: {
      sessionId: currentId,
      sessionStartedAt: 300,
      sessionFile: wrongTarget
    }
  }));
  const contract = await loadOpenClawHistoryFamilyContract({
    stateDir: files.stateDir,
    vimicateDir: files.vimicateDir,
    readProjectedHistoryPage: async () => ({})
  });
  await assert.rejects(contract({
    contract: "archived-family-v1",
    mode: "segments",
    stableSessionKey: key,
    expectedCurrentSessionId: currentId,
    expectedCurrentSessionStartedAtMs: 300,
    cursor: 0,
    limit: 2
  }), /generation/);
});

test("filesystem adapter permits an audited empty current transcript", async (t) => {
  const files = await fixture();
  t.after(() => fs.rm(files.root, { recursive: true, force: true }));
  await fs.writeFile(path.join(files.sessionsDir, `${currentId}.jsonl`), "");
  const contract = await loadOpenClawHistoryFamilyContract({
    stateDir: files.stateDir,
    vimicateDir: files.vimicateDir,
    readProjectedHistoryPage: async () => ({})
  });
  const census = await contract({
    contract: "archived-family-v1",
    mode: "segments",
    stableSessionKey: key,
    expectedCurrentSessionId: currentId,
    expectedCurrentSessionStartedAtMs: 300,
    cursor: 0,
    limit: 2
  });
  assert.equal(census.segments.at(-1).state, "current");
  assert.match(census.segments.at(-1).sourceRevision, /^[0-9a-f]{64}$/);
});

test("filesystem adapter refuses symlinks for every authority file class", async (t) => {
  const roots = [];
  t.after(async () => {
    await Promise.all(roots.map((root) => fs.rm(root, { recursive: true, force: true })));
  });

  {
    const files = await fixture();
    roots.push(files.root);
    const target = path.join(files.root, "secret-target");
    await fs.writeFile(target, `${"ab".repeat(32)}\n`, { mode: 0o600 });
    const secret = path.join(files.vimicateDir, openClawHistoryFamilyHostFiles.secret);
    await fs.rm(secret);
    await fs.symlink(target, secret);
    await assert.rejects(loadFixtureContract(files), /non-symlink/);
  }

  {
    const files = await fixture();
    roots.push(files.root);
    const ledger = path.join(files.vimicateDir, openClawHistoryFamilyHostFiles.ledger);
    const target = path.join(files.root, "ledger-target");
    await fs.rename(ledger, target);
    await fs.symlink(target, ledger);
    const contract = await loadFixtureContract(files);
    await assert.rejects(contract(censusParams()), /non-symlink/);
  }

  {
    const files = await fixture();
    roots.push(files.root);
    const store = path.join(files.sessionsDir, "sessions.json");
    const target = path.join(files.root, "sessions-target");
    await fs.rename(store, target);
    await fs.symlink(target, store);
    const contract = await loadFixtureContract(files);
    await assert.rejects(contract(censusParams()), /non-symlink/);
  }

  {
    const files = await fixture();
    roots.push(files.root);
    const transcript = path.join(files.sessionsDir, `${currentId}.jsonl`);
    const target = path.join(files.root, "transcript-target");
    await fs.rename(transcript, target);
    await fs.symlink(target, transcript);
    const contract = await loadFixtureContract(files);
    await assert.rejects(contract(censusParams()), /non-symlink/);
  }

  {
    const files = await fixture();
    roots.push(files.root);
    const transcript = path.join(
      files.vimicateDir,
      openClawHistoryFamilyHostFiles.ownedTranscripts,
      `${archivedId}.jsonl`
    );
    const target = path.join(files.root, "owned-transcript-target");
    await fs.rename(transcript, target);
    await fs.symlink(target, transcript);
    const contract = await loadFixtureContract(files);
    await assert.rejects(contract.probe(), /non-symlink/);
  }
});

test("filesystem adapter refuses symlinked configured roots and session ancestors", async (t) => {
  const roots = [];
  t.after(async () => {
    await Promise.all(roots.map((root) => fs.rm(root, { recursive: true, force: true })));
  });

  {
    const files = await fixture();
    roots.push(files.root);
    const target = `${files.vimicateDir}-target`;
    await fs.rename(files.vimicateDir, target);
    await fs.symlink(target, files.vimicateDir);
    await assert.rejects(loadFixtureContract(files), /non-symlink directory/);
  }

  {
    const files = await fixture();
    roots.push(files.root);
    const target = `${files.stateDir}-target`;
    await fs.rename(files.stateDir, target);
    await fs.symlink(target, files.stateDir);
    await assert.rejects(loadFixtureContract(files), /non-symlink directory/);
  }

  {
    const files = await fixture();
    roots.push(files.root);
    const target = `${files.sessionsDir}-target`;
    await fs.rename(files.sessionsDir, target);
    await fs.symlink(target, files.sessionsDir);
    const contract = await loadFixtureContract(files);
    await assert.rejects(contract(censusParams()), /non-symlink directory/);
  }

  {
    const files = await fixture();
    roots.push(files.root);
    const owned = path.join(
      files.vimicateDir,
      openClawHistoryFamilyHostFiles.ownedTranscripts
    );
    const target = `${owned}-target`;
    await fs.rename(owned, target);
    await fs.symlink(target, owned);
    await assert.rejects(loadFixtureContract(files), /non-symlink directory/);
  }
});

test("concurrent cold census requests coalesce transcript hashing", async (t) => {
  const files = await fixture();
  t.after(() => fs.rm(files.root, { recursive: true, force: true }));
  const probe = await fs.open(path.join(files.sessionsDir, `${currentId}.jsonl`));
  const prototype = Object.getPrototypeOf(probe);
  await probe.close();
  const original = prototype.createReadStream;
  let hashStreams = 0;
  prototype.createReadStream = function (...args) {
    hashStreams += 1;
    return original.apply(this, args);
  };
  t.after(() => { prototype.createReadStream = original; });

  const contract = await loadFixtureContract(files);
  const [first, second] = await Promise.all([
    contract(censusParams()),
    contract(censusParams())
  ]);
  assert.equal(first.familyToken, second.familyToken);
  assert.equal(hashStreams, 2);
});

test("distinct cold families never exceed the two-hash scheduler bound", async (t) => {
  const files = await fixture();
  t.after(() => fs.rm(files.root, { recursive: true, force: true }));
  const secondKey = "agent:main:dashboard:fixture-2";
  const thirdKey = "agent:main:dashboard:fixture-3";
  const secondArchived = "33333333-3333-4333-8333-333333333333";
  const secondCurrent = "44444444-4444-4444-8444-444444444444";
  const thirdArchived = "55555555-5555-4555-8555-555555555555";
  const thirdCurrent = "66666666-6666-4666-8666-666666666666";
  await addFamily(files, secondKey, secondArchived, secondCurrent);
  await addFamily(files, thirdKey, thirdArchived, thirdCurrent);

  const probe = await fs.open(path.join(files.sessionsDir, `${currentId}.jsonl`));
  const prototype = Object.getPrototypeOf(probe);
  await probe.close();
  const original = prototype.createReadStream;
  const held = [];
  let active = 0;
  let peak = 0;
  let gateFirstPair = true;
  prototype.createReadStream = function (...args) {
    const stream = original.apply(this, args);
    active += 1;
    peak = Math.max(peak, active);
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      active -= 1;
    };
    stream.once("end", finish);
    stream.once("error", finish);
    stream.once("close", finish);
    if (gateFirstPair) {
      stream.pause();
      held.push(stream);
      if (held.length === 2) gateFirstPair = false;
    }
    return stream;
  };
  t.after(() => { prototype.createReadStream = original; });

  const contract = await loadFixtureContract(files);
  const pending = Promise.all([
    contract(censusParams()),
    contract(censusParamsFor(secondKey, secondCurrent)),
    contract(censusParamsFor(thirdKey, thirdCurrent))
  ]);
  await waitUntil(() => held.length === 2, "the first two scheduled hashes");
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(peak, 2);
  held.forEach((stream) => stream.resume());
  await pending;
  assert.equal(peak, 2);
});

test("canceling one shared waiter preserves one hash for the other and cache", async (t) => {
  const files = await fixture();
  t.after(() => fs.rm(files.root, { recursive: true, force: true }));
  const probe = await fs.open(path.join(files.sessionsDir, `${currentId}.jsonl`));
  const prototype = Object.getPrototypeOf(probe);
  await probe.close();
  const original = prototype.createReadStream;
  const held = [];
  let hashStreams = 0;
  prototype.createReadStream = function (...args) {
    const stream = original.apply(this, args);
    hashStreams += 1;
    if (held.length === 0) {
      stream.pause();
      held.push(stream);
    }
    return stream;
  };
  t.after(() => { prototype.createReadStream = original; });

  const contract = await loadFixtureContract(files);
  const controller = new AbortController();
  const survivor = new AbortController();
  const joined = new Set();
  // A stream plus one event-loop turn does not prove the other census has
  // finished its filesystem reads and joined this hash. Observe each request's
  // real cancellation-listener admission, after the scheduler counts its waiter.
  for (const { signal } of [controller, survivor]) {
    const addEventListener = signal.addEventListener.bind(signal);
    signal.addEventListener = (...args) => {
      addEventListener(...args);
      if (args[0] === "abort") joined.add(signal);
    };
  }
  const cancelled = contract(censusParams(), { signal: controller.signal });
  await waitUntil(() => held.length === 1, "the first in-flight hash");
  const surviving = contract(censusParams(), { signal: survivor.signal });
  await waitUntil(() => joined.size === 2, "both waiters joining the shared hash");
  assert.equal(hashStreams, 1);
  controller.abort();
  await assert.rejects(cancelled, /cancelled/);
  held[0].resume();
  const result = await surviving;
  assert.equal(hashStreams, 2);

  const cached = await contract(censusParams());
  assert.equal(cached.familyToken, result.familyToken);
  assert.equal(hashStreams, 2);
});

test("a later census replaces an unobserved canceled hash and then uses cache", async (t) => {
  const files = await fixture();
  t.after(() => fs.rm(files.root, { recursive: true, force: true }));
  const probe = await fs.open(path.join(files.sessionsDir, `${currentId}.jsonl`));
  const prototype = Object.getPrototypeOf(probe);
  await probe.close();
  const original = prototype.createReadStream;
  const held = [];
  let hashStreams = 0;
  prototype.createReadStream = function (...args) {
    const stream = original.apply(this, args);
    hashStreams += 1;
    if (held.length === 0) {
      stream.pause();
      held.push(stream);
    }
    return stream;
  };
  t.after(() => { prototype.createReadStream = original; });

  const contract = await loadFixtureContract(files);
  const controller = new AbortController();
  const cancelled = contract(censusParams(), { signal: controller.signal });
  // Force the legitimate late-admission schedule which the former shared-
  // waiter test's one-setImmediate assumption could accidentally exercise.
  const later = cancelled.catch(() => {}).then(() => contract(censusParams()));
  await waitUntil(() => held.length === 1, "the first in-flight hash");
  await new Promise((resolve) => setImmediate(resolve));
  controller.abort();
  await assert.rejects(cancelled, /cancelled/);
  assert.equal(held[0].destroyed, true);
  const result = await later;
  assert.equal(hashStreams, 3); // One canceled hash; two fresh transcript hashes.
  const cached = await contract(censusParams());
  assert.equal(cached.familyToken, result.familyToken);
  assert.equal(hashStreams, 3);
});

test("bounded scheduler discards queued hashes after every waiter cancels", async (t) => {
  const files = await fixture();
  t.after(() => fs.rm(files.root, { recursive: true, force: true }));
  const requests = [{ params: censusParams(), controller: new AbortController() }];
  for (let index = 1; index < 68; index += 1) {
    const familyKey = `agent:main:dashboard:cancel-${index}`;
    const archivedSessionId = indexedSessionId(index, false);
    const currentSessionId = indexedSessionId(index, true);
    await addFamily(files, familyKey, archivedSessionId, currentSessionId);
    requests.push({
      params: censusParamsFor(familyKey, currentSessionId),
      controller: new AbortController()
    });
  }

  const probe = await fs.open(path.join(files.sessionsDir, `${currentId}.jsonl`));
  const prototype = Object.getPrototypeOf(probe);
  await probe.close();
  const original = prototype.createReadStream;
  let restored = false;
  let started = 0;
  let closed = 0;
  prototype.createReadStream = function (...args) {
    const stream = original.apply(this, args);
    started += 1;
    stream.pause();
    stream.once("close", () => { closed += 1; });
    return stream;
  };
  t.after(() => {
    if (!restored) prototype.createReadStream = original;
  });

  const contract = await loadFixtureContract(files);
  let boundFailures = 0;
  const pending = requests.map(({ params, controller }) => contract(
    params,
    { signal: controller.signal }
  ).catch((error) => {
    if (/pending transcript revision work exceeds its bound/.test(String(error))) {
      assert.equal(error?.vimicateHistoryFamilyFailureKind, "transient");
      boundFailures += 1;
    }
    throw error;
  }));
  const settled = Promise.allSettled(pending);
  await waitUntil(() => started === 2, "the two active cancellation hashes");
  await waitUntil(() => boundFailures > 0, "the finite pending hash bound");

  for (const request of requests) request.controller.abort();
  const results = await settled;
  await waitUntil(() => closed === 2, "the cancelled active hashes to close");
  assert.ok(results.every((result) => result.status === "rejected"));
  assert.ok(boundFailures > 0);
  assert.equal(started, 2);

  prototype.createReadStream = original;
  restored = true;
  const recovered = await contract(censusParams());
  assert.equal(recovered.segments.length, 2);
});

test("a late abort after warm-cache evidence prevents census publication", async (t) => {
  const files = await fixture();
  t.after(() => fs.rm(files.root, { recursive: true, force: true }));
  const contract = await loadFixtureContract(files);
  await contract(censusParams());

  const probe = await fs.open(path.join(files.sessionsDir, "sessions.json"));
  const prototype = Object.getPrototypeOf(probe);
  await probe.close();
  const original = prototype.readFile;
  const controller = new AbortController();
  let boundedReads = 0;
  prototype.readFile = async function (...args) {
    const result = await original.apply(this, args);
    boundedReads += 1;
    if (boundedReads === 3) controller.abort();
    return result;
  };
  t.after(() => { prototype.readFile = original; });

  await assert.rejects(
    contract(censusParams(), { signal: controller.signal }),
    /cancelled/
  );
  assert.equal(boundedReads, 3);
});

test("pathname replacement during hashing fails before census publication", async (t) => {
  const files = await fixture();
  t.after(() => fs.rm(files.root, { recursive: true, force: true }));
  const archived = path.join(
    files.vimicateDir,
    openClawHistoryFamilyHostFiles.ownedTranscripts,
    `${archivedId}.jsonl`
  );
  const displaced = `${archived}.displaced`;
  const probe = await fs.open(archived);
  const prototype = Object.getPrototypeOf(probe);
  await probe.close();
  const original = prototype.createReadStream;
  let replaced = false;
  prototype.createReadStream = function (...args) {
    const stream = original.apply(this, args);
    if (!replaced) {
      replaced = true;
      fsNative.renameSync(archived, displaced);
      fsNative.writeFileSync(archived, "replacement\n");
    }
    return stream;
  };
  t.after(() => { prototype.createReadStream = original; });

  const contract = await loadFixtureContract(files);
  await assert.rejects(
    contract(censusParams()),
    (error) => {
      assert.match(String(error), /changed while|fixed-path identity/);
      assert.notEqual(error?.vimicateHistoryFamilyFailureKind, "transient");
      return true;
    }
  );
});

test("current transcript mutation during hashing is tagged transient", async (t) => {
  const files = await fixture();
  t.after(() => fs.rm(files.root, { recursive: true, force: true }));
  const contract = await loadFixtureContract(files);
  await contract(censusParams());

  const current = path.join(files.sessionsDir, `${currentId}.jsonl`);
  await fs.appendFile(current, "before-current-rehash\n");
  const probe = await fs.open(current);
  const prototype = Object.getPrototypeOf(probe);
  await probe.close();
  const original = prototype.createReadStream;
  let mutated = false;
  prototype.createReadStream = function (...args) {
    const stream = original.apply(this, args);
    if (!mutated) {
      mutated = true;
      fsNative.appendFileSync(current, "during-current-rehash\n");
    }
    return stream;
  };
  t.after(() => { prototype.createReadStream = original; });

  await assert.rejects(
    contract(censusParams()),
    (error) => {
      assert.match(String(error), /changed while|fixed-path identity/);
      assert.equal(error?.vimicateHistoryFamilyFailureKind, "transient");
      return true;
    }
  );
  assert.equal(mutated, true);
  prototype.createReadStream = original;
  const recovered = await contract(censusParams());
  assert.equal(recovered.segments.at(-1).state, "current");
});

test("filesystem adapter rejects a cold family beyond the aggregate budget", async (t) => {
  const files = await fixture();
  t.after(() => fs.rm(files.root, { recursive: true, force: true }));
  await fs.truncate(path.join(files.sessionsDir, `${currentId}.jsonl`),
    256 * 1024 * 1024);
  const contract = await loadFixtureContract(files);
  await assert.rejects(contract(censusParams()), /bounded regular file/);
});

test("legitimate atomic ledger and session-child changes preserve directory authority", async (t) => {
  const files = await fixture();
  t.after(() => fs.rm(files.root, { recursive: true, force: true }));
  const contract = await loadFixtureContract(files);
  const first = await contract(censusParams());

  const ledger = path.join(files.vimicateDir, openClawHistoryFamilyHostFiles.ledger);
  const replacement = `${ledger}.replacement`;
  await fs.copyFile(ledger, replacement);
  await fs.rename(replacement, ledger);
  await fs.writeFile(path.join(files.sessionsDir, "unrelated-session.jsonl"), "fixture\n");

  const second = await contract(censusParams());
  assert.equal(second.familyToken, first.familyToken);
});

test("atomic ledger replacement during an RPC snapshot retries safely", async (t) => {
  const files = await fixture();
  t.after(() => fs.rm(files.root, { recursive: true, force: true }));
  const contract = await loadFixtureContract(files);
  const ledger = path.join(files.vimicateDir, openClawHistoryFamilyHostFiles.ledger);
  const replacement = `${ledger}.replacement`;
  const probe = await fs.open(ledger);
  const prototype = Object.getPrototypeOf(probe);
  await probe.close();
  const original = prototype.readFile;
  let reads = 0;
  prototype.readFile = async function (...args) {
    const result = await original.apply(this, args);
    reads += 1;
    if (reads === 1) {
      await fs.copyFile(ledger, replacement);
      await fs.rename(replacement, ledger);
    }
    return result;
  };
  t.after(() => { prototype.readFile = original; });

  const result = await contract(censusParams());
  assert.equal(result.segments.length, 2);
  assert.ok(reads >= 3);
});

test("atomic sessions-store replacement during an RPC snapshot retries safely", async (t) => {
  const files = await fixture();
  t.after(() => fs.rm(files.root, { recursive: true, force: true }));
  const contract = await loadFixtureContract(files);
  const store = path.join(files.sessionsDir, "sessions.json");
  const replacement = `${store}.replacement`;
  const probe = await fs.open(store);
  const prototype = Object.getPrototypeOf(probe);
  await probe.close();
  const original = prototype.readFile;
  let reads = 0;
  prototype.readFile = async function (...args) {
    const result = await original.apply(this, args);
    reads += 1;
    if (reads === 2) {
      await fs.copyFile(store, replacement);
      await fs.rename(replacement, store);
    }
    return result;
  };
  t.after(() => { prototype.readFile = original; });

  const result = await contract(censusParams());
  assert.equal(result.segments.at(-1).sessionID ?? result.segments.at(-1).sessionId, currentId);
  assert.ok(reads >= 3);
});

test("replacing the pinned sessions directory inode fails closed", async (t) => {
  const files = await fixture();
  t.after(() => fs.rm(files.root, { recursive: true, force: true }));
  const contract = await loadFixtureContract(files);
  await contract(censusParams());

  const displaced = `${files.sessionsDir}-displaced`;
  await fs.rename(files.sessionsDir, displaced);
  await fs.cp(displaced, files.sessionsDir, { recursive: true });
  await assert.rejects(contract(censusParams()), /directory chain identity changed/);
});
