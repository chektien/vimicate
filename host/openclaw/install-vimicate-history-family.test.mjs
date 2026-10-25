import assert from "node:assert/strict";
import childProcess from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createOpenClawHistoryFamilyLedgerWriter } from "./vimicate-history-family-ledger.mjs";
import { VIMICATE_ARCHIVED_FAMILY_PROOF } from "./vimicate-history-family-contract.mjs";

const directory = path.dirname(fileURLToPath(import.meta.url));
const installer = path.join(directory, "install-vimicate-history-family.mjs");
const sourceModules = [
  "vimicate-history-family-contract.mjs",
  "vimicate-history-family-openclaw.mjs",
  "vimicate-history-family-ledger.mjs",
  "vimicate-history-family-chain-repair.mjs",
  "vimicate-history-chain-witness.mjs",
  "vimicate-history-family-plugin-runtime.mjs",
  "vimicate-narration-record-contract.mjs",
  "vimicate-narration-page-views.mjs",
  "vimicate-narration-state-store.mjs",
  "vimicate-narration-plugin-runtime.mjs"
];

async function fixture({
  capabilityAnchor = true,
  nativeSupport = false,
  nativeNarrationSupport = false,
  liveLayout = false,
  version = "2026.7.1-2"
} = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "vimicate-installer-"));
  const packageDir = liveLayout
    ? path.join(root, "node_modules", "openclaw")
    : path.join(root, "openclaw-copy");
  const dist = path.join(packageDir, "dist");
  await fs.mkdir(dist, { recursive: true });
  await fs.writeFile(path.join(packageDir, "package.json"), JSON.stringify({
    name: "openclaw",
    version,
    type: "module",
    exports: { "./plugin-sdk/core": "./dist/plugin-sdk-core.js" }
  }));
  await fs.writeFile(path.join(packageDir, "openclaw.mjs"), `
import fs from "node:fs";
const expected = ["plugins", "registry", "--refresh", "--json"];
if (JSON.stringify(process.argv.slice(2)) !== JSON.stringify(expected)) process.exit(2);
if (process.env.VIMICATE_INSTALLER_TEST_REGISTRY_MARKER) {
  fs.writeFileSync(process.env.VIMICATE_INSTALLER_TEST_REGISTRY_MARKER, "refreshed\\n");
}
process.stdout.write(JSON.stringify({
  refreshed: true,
  registry: { plugins: [{ pluginId: "vimicate-history-family" }] }
}));
`);
  await fs.writeFile(path.join(dist, "chat-fixture.js"), `
import { Gn as errorShape, Wn as ErrorCodes } from "./schema-fixture.js";
const CHAT_HISTORY_MAX_SINGLE_MESSAGE_BYTES = 1;
${nativeSupport ? 'const nativeCapability = "archivedSessionFamily";' : ""}
${nativeNarrationSupport ? 'const nativeNarrationCapability = "sharedNarration";' : ""}
async function readChatHistoryPage(params) {
  const recentOptions = {
    allowResetArchiveFallback: true
  };
  const pageOptions = {
    allowResetArchiveFallback: true
  };
  const legacyOptions = {
    allowResetArchiveFallback: true
  };
  globalThis.__vimicateInstallerFallbackOptions = [
    recentOptions.allowResetArchiveFallback,
    pageOptions.allowResetArchiveFallback,
    legacyOptions.allowResetArchiveFallback
  ];
  globalThis.__vimicateInstallerExactOptions = [
    recentOptions.vimicateExactSessionFile,
    pageOptions.vimicateExactSessionFile,
    legacyOptions.vimicateExactSessionFile
  ];
  globalThis.__vimicateInstallerCacheKeys = [
    recentOptions.vimicateCacheKey,
    pageOptions.vimicateCacheKey,
    legacyOptions.vimicateCacheKey
  ];
  return globalThis.__vimicateInstallerHistoryPage ?? {
    messages: [], offset: params.offset, totalMessages: 0, rawPageMessages: 0
  };
}
async function handleChatHistoryRequest() {}
function getMaxChatHistoryMessagesBytes() { return 1024; }
function resolveEffectiveChatHistoryMaxChars() { return 1000; }
function replaceOversizedChatHistoryMessages({ messages }) { return { messages }; }
function capArrayByJsonBytes(messages) { return { items: messages }; }
function enforceChatHistoryFinalBudget({ messages }) { return { messages }; }
function resolveChatHistoryNextOffset({ offset, rawPageMessages }) { return offset + rawPageMessages; }
const chatHandlers = {};
export { chatHandlers as n };
`);
  await fs.writeFile(path.join(dist, "session-utils.fs-fixture.js"), `
import fs from "node:fs";
async function findExistingTranscriptHistoryPathAsync() { return "/outside/archive"; }
function findExistingTranscriptPath() { return "/outside/current"; }
const transcriptIndexCache = new Map();
const transcriptIndexBuilds = new Map();
function touchCachedIndex(filePath, entry) {
  transcriptIndexCache.delete(filePath);
  transcriptIndexCache.set(filePath, entry);
  return entry.index;
}
function setCachedIndex(filePath, entry) { transcriptIndexCache.set(filePath, entry); }
function selectTranscriptIndexView(index) { return index; }
async function buildSessionTranscriptIndex(filePath, stat) {
  const lines = (await fs.promises.readFile(filePath, "utf8")).trim().split("\\n").filter(Boolean);
  return { filePath, mtimeMs: stat.mtimeMs, size: stat.size,
    entries: lines.map((line, seq) => ({ seq: seq + 1, record: JSON.parse(line) })) };
}
async function readSessionTranscriptIndex(filePath, opts = {}) {
  let stat;
  try { stat = await fs.promises.stat(filePath); }
  catch { transcriptIndexCache.delete(filePath); return null; }
  if (!stat.isFile()) { transcriptIndexCache.delete(filePath); return null; }
  if (opts.cache === "skip") return selectTranscriptIndexView(await buildSessionTranscriptIndex(filePath, stat));
  const cached = transcriptIndexCache.get(filePath);
  if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) return touchCachedIndex(filePath, cached);
  const inFlight = transcriptIndexBuilds.get(filePath);
  if (inFlight && inFlight.mtimeMs === stat.mtimeMs && inFlight.size === stat.size) return await inFlight.promise;
  const promise = buildSessionTranscriptIndex(filePath, stat);
  transcriptIndexBuilds.set(filePath, { mtimeMs: stat.mtimeMs, size: stat.size, promise });
  const index = await promise.finally(() => {
    if (transcriptIndexBuilds.get(filePath)?.promise === promise) transcriptIndexBuilds.delete(filePath);
  });
  setCachedIndex(filePath, { mtimeMs: stat.mtimeMs, size: stat.size, index });
  return index;
}
const transcriptMessageCountCache = new Map();
function getCachedTranscriptMessageCount(filePath, stat) {
  const cached = transcriptMessageCountCache.get(filePath);
  return cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size ? cached.count : null;
}
function setCachedTranscriptMessageCount(filePath, stat, count) {
  transcriptMessageCountCache.set(filePath, { mtimeMs: stat.mtimeMs, size: stat.size, count });
}
async function readSessionMessagesWithSourceAsync(sessionId, storePath, sessionFile, opts, agentId) {
  const filePath = opts.allowResetArchiveFallback === true ? await findExistingTranscriptHistoryPathAsync(sessionId, storePath, sessionFile, agentId) : findExistingTranscriptPath(sessionId, storePath, sessionFile, agentId);
  if (!filePath) return { messages: [] };
  return { messages: (await readSessionTranscriptIndex(filePath))?.entries ?? [], transcriptPath: filePath };
}
async function readSessionMessageByIdAsync() {}
async function readRecentSessionMessagesWithStatsAsync(sessionId, storePath, sessionFile, opts, agentId) {
  const filePath = opts.allowResetArchiveFallback === true ? await findExistingTranscriptHistoryPathAsync(sessionId, storePath, sessionFile, agentId) : findExistingTranscriptPath(sessionId, storePath, sessionFile, agentId);
  if (!filePath) return { messages: [], totalMessages: 0 };
  const totalMessages = await readSessionMessageCountFromPathAsync(filePath);
  return { messages: [], totalMessages, transcriptPath: filePath };
}
async function readSessionMessagesPageWithStatsAsync(sessionId, storePath, sessionFile, opts, agentId) {
  const filePath = opts.allowResetArchiveFallback === true ? await findExistingTranscriptHistoryPathAsync(sessionId, storePath, sessionFile, agentId) : findExistingTranscriptPath(sessionId, storePath, sessionFile, agentId);
  if (!filePath) return { messages: [], totalMessages: 0 };
  const index = await readSessionTranscriptIndex(filePath);
  return { messages: index?.entries ?? [], totalMessages: index?.entries.length ?? 0, transcriptPath: filePath };
}
function parsedSessionEntryToMessage() {}
async function readSessionMessageCountFromPathAsync(filePath) {
  let stat = null;
  try {
    stat = await fs.promises.stat(filePath);
    const cached = getCachedTranscriptMessageCount(filePath, stat);
    if (typeof cached === "number") return cached;
  } catch {}
  const count = (await readSessionTranscriptIndex(filePath))?.entries.length ?? 0;
  if (stat) setCachedTranscriptMessageCount(filePath, stat, count);
  return count;
}
function withOpenTranscriptFd() {}
export { readSessionMessagesWithSourceAsync, readRecentSessionMessagesWithStatsAsync, readSessionMessagesPageWithStatsAsync };
`);
  await fs.writeFile(path.join(dist, "server-methods-fixture.js"), `
async function vimicateRegistryReadHandler() {
  return {
    capabilities: {
      threadSessionReconcile: "host-current-v1",
      ${capabilityAnchor ? 'threadRegistryProbe: "nonmutating-v1"' : 'other: "changed"'}
    }
  };
}
export { vimicateRegistryReadHandler };
`);
  await fs.writeFile(path.join(dist, "plugin-entry-fixture.js"), `
function definePluginEntry(value) { return value; }
export { definePluginEntry as t };
`);
  // Match the supported reset's creation transaction, not a guessed timestamp
  // added later by the client or by the first prompt in the new session.
  await fs.writeFile(path.join(dist, "session-reset-service-fixture.js"), `
function randomUUID() { return "22222222-2222-4222-8222-222222222222"; }
function buildResetEntry(currentEntry, sessionFile, Date = globalThis.Date) {
\tconst now = Date.now();
\tconst nextSessionId = randomUUID();
\tconst nextEntry = {
\t\tsessionId: nextSessionId,
\t\tsessionFile,
\t\tupdatedAt: now,
\t\tlabel: currentEntry.label,
\t\tsystemSent: false
\t};
\treturn nextEntry;
}
export { buildResetEntry };
`);
  await fs.writeFile(path.join(dist, "schema-fixture.js"), `
const ErrorCodes = { INVALID_REQUEST: "INVALID_REQUEST" };
function errorShape(code, message) { return { code, message }; }
export { errorShape as Gn, ErrorCodes as Wn };
`);
  return { root, packageDir };
}

test("supported reset establishes the successor epoch before the lineage hook", async (t) => {
  const files = await fixture();
  t.after(() => fs.rm(files.root, { recursive: true, force: true }));
  run(files.packageDir);
  const { buildResetEntry } = await import(pathToFileURL(path.join(
    files.packageDir, "dist/session-reset-service-fixture.js"
  )).href);
  const stateDir = path.join(files.root, "state");
  const vimicateDir = path.join(files.root, "vimicate");
  const sessionsDir = path.join(stateDir, "agents/main/sessions");
  await fs.mkdir(sessionsDir, { recursive: true });
  await fs.mkdir(vimicateDir, { mode: 0o700 });
  const key = "agent:main:direct:reset-epoch";
  const previousId = "11111111-1111-4111-8111-111111111111";
  const nextId = "22222222-2222-4222-8222-222222222222";
  const createdAt = 1_788_050_876_941;
  const previous = { sessionId: previousId, sessionStartedAt: createdAt - 1000, label: "kept" };
  const nextFile = path.join(sessionsDir, `${nextId}.jsonl`);
  const next = buildResetEntry(previous, nextFile, { now: () => createdAt });
  // The real reset emits session_end before any prompt creates this transcript.
  await fs.writeFile(path.join(sessionsDir, "sessions.json"), JSON.stringify({ [key]: next }));
  const archived = path.join(sessionsDir, `${previousId}.jsonl.reset.2026-08-30T00-47-56.941Z`);
  await fs.writeFile(archived, "retained previous transcript\n", { mode: 0o600 });
  const ledgerFile = path.join(vimicateDir, "openclaw-history-families.json");
  await fs.writeFile(ledgerFile, JSON.stringify({
    schemaVersion: 1, proof: VIMICATE_ARCHIVED_FAMILY_PROOF,
    families: { [key]: { agentId: "main", segments: [{
      sessionId: previousId, startedAtMs: previous.sessionStartedAt,
      transcriptFilename: `${previousId}.jsonl`
    }] } }
  }), { mode: 0o600 });
  const writer = createOpenClawHistoryFamilyLedgerWriter({ stateDir, vimicateDir });
  const event = { sessionKey: key, sessionId: previousId, nextSessionId: nextId,
    reason: "reset", sessionFile: archived, transcriptArchived: true };
  assert.equal((await writer.record(event, { agentId: "main" })).status, "appended");
  assert.equal((await writer.record(event, { agentId: "main" })).status, "unchanged");
  const segments = JSON.parse(await fs.readFile(ledgerFile, "utf8")).families[key].segments;
  assert.equal(segments.length, 2);
  assert.equal(segments[1].startedAtMs, createdAt);
  assert.equal(next.sessionStartedAt, createdAt);
  assert.equal(next.updatedAt, createdAt);
  assert.equal(next.label, "kept");
  assert.equal(previous.sessionStartedAt, createdAt - 1000);
  assert.equal(run(files.packageDir).changed, false);
});

test("installer refuses an unreviewed reset epoch owner without changing the package", async (t) => {
  const files = await fixture();
  t.after(() => fs.rm(files.root, { recursive: true, force: true }));
  const resetFile = path.join(files.packageDir, "dist/session-reset-service-fixture.js");
  const drifted = (await fs.readFile(resetFile, "utf8")).replace(
    "sessionId: nextSessionId,",
    "sessionId: nextSessionId,\n\t\tsessionStartedAt: currentEntry.sessionStartedAt,"
  );
  await fs.writeFile(resetFile, drifted);
  assert.throws(() => run(files.packageDir), /unreviewed owner/);
  assert.equal(await fs.readFile(resetFile, "utf8"), drifted);
  await assert.rejects(fs.stat(path.join(
    files.packageDir, "dist/extensions/vimicate-history-family"
  )), /ENOENT/);
});

function runWithEnvironment(packageDir, environment, ...extra) {
  const output = childProcess.execFileSync(process.execPath, [
    installer,
    "--package-dir",
    packageDir,
    ...extra
  ], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, ...environment }
  });
  return JSON.parse(output);
}

function run(packageDir, ...extra) {
  return runWithEnvironment(packageDir, {}, ...extra);
}

function spawnRun(packageDir, environment = {}) {
  const child = childProcess.spawn(process.execPath, [
    installer,
    "--package-dir",
    packageDir
  ], {
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, ...environment }
  });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => { stdout += chunk; });
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  return {
    child,
    completed: new Promise((resolve) => {
      child.on("exit", (code, signal) => resolve({ code, signal, stdout, stderr }));
    })
  };
}

async function waitForFile(file) {
  const deadline = Date.now() + 10_000;
  while (true) {
    if (await fs.stat(file).then(() => true, () => false)) return;
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${file}`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

async function waitForFileWhileRunning(file, running) {
  await Promise.race([
    waitForFile(file),
    running.completed.then((result) => {
      throw new Error(
        `installer exited before ${file}: code=${result.code} stderr=${result.stderr}`
      );
    })
  ]);
}

function validAuthority(overrides = {}) {
  return {
    limit: 32,
    offset: 0,
    sessionId: "session-1",
    stableSessionKey: "agent:main:direct:test",
    agentId: "main",
    storePath: "/tmp/sessions.json",
    sessionFile: "/tmp/session-1.jsonl",
    transcriptFilename: "session-1.jsonl.reset.2026-07-19T00-00-00.000Z",
    sourceRevision: "ab".repeat(32),
    startedAtMs: 1,
    ...overrides
  };
}

async function treeDigest(root) {
  const entries = [];
  async function visit(directoryPath) {
    for (const name of (await fs.readdir(directoryPath)).sort()) {
      const file = path.join(directoryPath, name);
      const stat = await fs.lstat(file);
      const relative = path.relative(root, file);
      if (stat.isDirectory()) await visit(file);
      else entries.push(`${relative}\0${crypto.createHash("sha256")
        .update(await fs.readFile(file)).digest("hex")}`);
    }
  }
  await visit(root);
  return crypto.createHash("sha256").update(entries.join("\n")).digest("hex");
}

async function fixtureSourceSnapshot(root) {
  const target = path.join(root, "installer-source");
  await fs.mkdir(target);
  for (const name of sourceModules) {
    await fs.copyFile(path.join(directory, name), path.join(target, name));
  }
  return target;
}

test("transactional installer swaps the package set and is idempotent", async (t) => {
  const files = await fixture();
  t.after(() => fs.rm(files.root, { recursive: true, force: true }));
  const first = run(files.packageDir);
  assert.equal(first.applied, true);
  assert.equal(first.changed, true);
  assert.equal(first.openClawVersion, "2026.7.1-2");
  assert.equal((await fs.stat(first.backup)).isDirectory(), true);
  assert.match(
    await fs.readFile(path.join(files.packageDir, "dist", "chat-fixture.js"), "utf8"),
    /canonical-chat-history-page-v1/
  );
  assert.match(
    await fs.readFile(
      path.join(files.packageDir, "dist", "server-methods-fixture.js"),
      "utf8"
    ),
    /vimicateHistoryFamilyCapability/
  );
  assert.equal((await fs.stat(path.join(
    files.packageDir,
    "dist",
    "extensions",
    "vimicate-history-family",
    "index.js"
  ))).isFile(), true);
  const extensionIndex = await fs.readFile(path.join(
    files.packageDir,
    "dist",
    "extensions",
    "vimicate-history-family",
    "index.js"
  ), "utf8");
  assert.equal((extensionIndex.match(/signal\?\.aborted/g) ?? []).length, 2);
  assert.match(extensionIndex, /await vimicateReadArchivedHistoryPage/);
  assert.match(extensionIndex, /registerVimicateNarrationPlugin/);
  assert.match(
    extensionIndex,
    /registerAgentEventSubscription !== "function"/
  );
  assert.equal((await fs.stat(path.join(
    files.packageDir,
    "dist",
    "extensions",
    "vimicate-history-family",
    "vimicate-narration-plugin-runtime.mjs"
  ))).isFile(), true);
  const installedNarration = await import(pathToFileURL(path.join(
    files.packageDir, "dist", "extensions", "vimicate-history-family",
    "vimicate-narration-plugin-runtime.mjs"
  )).href);
  assert.equal(typeof installedNarration.createVimicateNarrationStateStore, "function");
  assert.equal((await fs.stat(path.join(
    files.packageDir, "dist", "extensions", "vimicate-history-family",
    "vimicate-narration-state-store.mjs"
  ))).isFile(), true);
  const second = run(files.packageDir);
  assert.equal(second.applied, false);
  assert.equal(second.changed, false);
});

test("transactional installer replaces older managed blocks without stacking", async (t) => {
  const files = await fixture();
  t.after(() => fs.rm(files.root, { recursive: true, force: true }));
  run(files.packageDir);
  for (const [name, kind] of [
    ["chat-fixture.js", "projector"],
    ["server-methods-fixture.js", "capability"]
  ]) {
    const file = path.join(files.packageDir, "dist", name);
    const current = await fs.readFile(file, "utf8");
    await fs.writeFile(
      file,
      current
        .replace(
          new RegExp(`// BEGIN vimicate-history-family ${kind}-v3[\\s\\S]*?// END vimicate-history-family ${kind}-v3\\n?`),
          `// BEGIN vimicate-history-family ${kind}-v0\nthrow new Error("stale");\n// END vimicate-history-family ${kind}-v0\n`
        )
    );
  }
  const upgraded = run(files.packageDir);
  assert.equal(upgraded.applied, true);
  assert.equal(upgraded.changed, true);
  for (const [name, kind] of [
    ["chat-fixture.js", "projector"],
    ["server-methods-fixture.js", "capability"]
  ]) {
    const text = await fs.readFile(path.join(files.packageDir, "dist", name), "utf8");
    assert.equal((text.match(new RegExp(`BEGIN vimicate-history-family ${kind}-v`, "g")) ?? []).length, 1);
    assert.match(text, new RegExp(`BEGIN vimicate-history-family ${kind}-v3`));
    assert.doesNotMatch(text, /throw new Error\("stale"\)/);
  }
  const stable = run(files.packageDir);
  assert.equal(stable.applied, false);
  assert.equal(stable.changed, false);
});

test("installer upgrades the prior reset-only exact-reader patch in place", async (t) => {
  const files = await fixture();
  t.after(() => fs.rm(files.root, { recursive: true, force: true }));
  run(files.packageDir);
  const chat = path.join(files.packageDir, "dist", "chat-fixture.js");
  const current = await fs.readFile(chat, "utf8");
  const prior = current.replace(
    /,\n\s*vimicateExactSessionFile: params\.vimicateExactSessionFile === true,\n\s*vimicateCacheKey: params\.vimicateCacheKey/g,
    ""
  );
  assert.equal(
    (prior.match(/vimicateExactSessionFile: params\.vimicateExactSessionFile === true/g)
      ?? []).length,
    0
  );
  assert.equal((prior.match(/vimicateCacheKey: params\.vimicateCacheKey/g) ?? []).length, 0);
  await fs.writeFile(chat, prior);
  const upgraded = run(files.packageDir);
  assert.equal(upgraded.applied, true);
  assert.equal(upgraded.changed, true);
  const result = await fs.readFile(chat, "utf8");
  assert.equal(
    (result.match(/vimicateExactSessionFile: params\.vimicateExactSessionFile === true/g)
      ?? []).length,
    3
  );
  assert.equal((result.match(/vimicateCacheKey: params\.vimicateCacheKey/g) ?? []).length, 3);
});

test("dry run validates the full stage without changing the target", async (t) => {
  const files = await fixture();
  t.after(() => fs.rm(files.root, { recursive: true, force: true }));
  const before = await treeDigest(files.packageDir);
  const result = run(files.packageDir, "--dry-run");
  assert.equal(result.applied, false);
  assert.equal(result.changed, true);
  assert.equal(await treeDigest(files.packageDir), before);
});

test("live apply refreshes the persisted plugin registry before reporting success", async (t) => {
  const files = await fixture({ liveLayout: true });
  const marker = path.join(files.root, "registry-refreshed");
  t.after(() => fs.rm(files.root, { recursive: true, force: true }));
  const result = runWithEnvironment(
    files.packageDir,
    { VIMICATE_INSTALLER_TEST_REGISTRY_MARKER: marker },
    "--apply-live"
  );
  assert.equal(result.applied, true);
  assert.deepEqual(result.pluginRegistry, {
    contract: "openclaw-persisted-plugin-registry-v1",
    refreshed: true,
    pluginId: "vimicate-history-family"
  });
  assert.equal(result.gatewayRestartRequired, true);
  assert.equal(await fs.readFile(marker, "utf8"), "refreshed\n");
});

test("idempotent live apply still repairs a stale persisted plugin registry", async (t) => {
  const files = await fixture({ liveLayout: true });
  const marker = path.join(files.root, "registry-refreshed");
  t.after(() => fs.rm(files.root, { recursive: true, force: true }));
  runWithEnvironment(
    files.packageDir,
    { VIMICATE_INSTALLER_TEST_REGISTRY_MARKER: marker },
    "--apply-live"
  );
  await fs.rm(marker);
  const result = runWithEnvironment(
    files.packageDir,
    { VIMICATE_INSTALLER_TEST_REGISTRY_MARKER: marker },
    "--apply-live"
  );
  assert.equal(result.applied, false);
  assert.equal(result.changed, false);
  assert.equal(result.pluginRegistry.refreshed, true);
  assert.equal(result.gatewayRestartRequired, true);
  assert.equal(await fs.readFile(marker, "utf8"), "refreshed\n");
});

test("installer preserves inert npm command-shim symlinks without following them", async (t) => {
  const files = await fixture();
  t.after(() => fs.rm(files.root, { recursive: true, force: true }));
  const bin = path.join(files.packageDir, "node_modules", ".bin");
  const tool = path.join(files.packageDir, "node_modules", "tool", "cli.js");
  await fs.mkdir(path.dirname(tool), { recursive: true });
  await fs.mkdir(bin, { recursive: true });
  await fs.writeFile(tool, "export {};\n");
  await fs.symlink("../tool/cli.js", path.join(bin, "tool"));

  const result = run(files.packageDir);
  assert.equal(result.applied, true);
  assert.equal(await fs.readlink(path.join(bin, "tool")), "../tool/cli.js");
  assert.equal(await fs.readFile(tool, "utf8"), "export {};\n");
});

test("changed bundle anchor fails before any target mutation", async (t) => {
  const files = await fixture({ capabilityAnchor: false });
  t.after(() => fs.rm(files.root, { recursive: true, force: true }));
  const before = await treeDigest(files.packageDir);
  assert.throws(() => run(files.packageDir), /registry capabilities anchor/);
  assert.equal(await treeDigest(files.packageDir), before);
});

test("live OpenClaw refusal happens before any lock or journal write", async () => {
  if (!process.platform.startsWith("darwin")) return;
  const parent = "/opt/homebrew/lib/node_modules";
  const lock = path.join(parent, ".openclaw.vimicate-install.lock");
  const journal = path.join(parent, ".openclaw.vimicate-install-transaction.json");
  const snapshot = (file) => fs.stat(file).then(
    (stat) => ({
      dev: stat.dev,
      ino: stat.ino,
      size: stat.size,
      mode: stat.mode,
      mtimeMs: stat.mtimeMs,
      ctimeMs: stat.ctimeMs
    }),
    () => null
  );
  const lockBefore = await snapshot(lock);
  const journalBefore = await snapshot(journal);
  assert.throws(() => run(
    "/opt/homebrew/lib/node_modules/openclaw",
    "--dry-run"
  ), /refusing the live OpenClaw package/);
  assert.deepEqual(await snapshot(lock), lockBefore);
  assert.deepEqual(await snapshot(journal), journalBefore);
});

test("live OpenClaw refusal cannot be bypassed through a symlinked ancestor", async (t) => {
  if (!process.platform.startsWith("darwin")) return;
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "vimicate-live-alias-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const alias = path.join(root, "alias");
  await fs.symlink("/opt/homebrew/lib/node_modules", alias);
  const lock = "/opt/homebrew/lib/node_modules/.openclaw.vimicate-install.lock";
  const journal = "/opt/homebrew/lib/node_modules/.openclaw.vimicate-install-transaction.json";
  const snapshot = (file) => fs.stat(file).then(
    (stat) => ({
      dev: stat.dev,
      ino: stat.ino,
      size: stat.size,
      mode: stat.mode,
      mtimeMs: stat.mtimeMs,
      ctimeMs: stat.ctimeMs
    }),
    () => null
  );
  const lockBefore = await snapshot(lock);
  const journalBefore = await snapshot(journal);
  assert.throws(() => run(path.join(alias, "openclaw"), "--dry-run"),
    /refusing the live OpenClaw package/);
  assert.deepEqual(await snapshot(lock), lockBefore);
  assert.deepEqual(await snapshot(journal), journalBefore);
});

test("retargeting a symlinked ancestor cannot redirect an accepted transaction", async (t) => {
  if (!process.platform.startsWith("darwin")) return;
  const files = await fixture();
  t.after(() => fs.rm(files.root, { recursive: true, force: true }));
  const safeParent = path.join(files.root, "safe-parent");
  const safePackage = path.join(safeParent, "openclaw");
  await fs.mkdir(safeParent);
  await fs.rename(files.packageDir, safePackage);
  const alias = path.join(files.root, "package-authority");
  await fs.symlink(safeParent, alias);

  // An isolated protected destination preserves the same inode/content contract
  // without relying on an installed live package on the assessment host.
  const protectedParent = path.join(files.root, "unrelated-protected-parent");
  const protectedPackage = path.join(protectedParent, "openclaw");
  await fs.mkdir(protectedPackage, { recursive: true });
  const liveManifest = path.join(protectedPackage, "package.json");
  await fs.writeFile(liveManifest, JSON.stringify({ name: "protected-fixture", version: "1.0.0" }));
  const liveBefore = await fs.readFile(liveManifest);
  const liveBeforeStat = await fs.stat(liveManifest, { bigint: true });
  const control = path.join(files.root, "ancestor-retarget-control");
  const running = spawnRun(path.join(alias, "openclaw"), {
    VIMICATE_INSTALLER_TEST_ROOT: files.root,
    VIMICATE_INSTALLER_TEST_CONTROL: control,
    VIMICATE_INSTALLER_TEST_PAUSE_AT: "after-initial-generation-before-validation"
  });
  await waitForFileWhileRunning(`${control}.ready`, running);
  const replacementAlias = `${alias}.replacement`;
  await fs.symlink(protectedParent, replacementAlias);
  await fs.rename(replacementAlias, alias);
  await fs.writeFile(`${control}.continue`, "continue\n");

  const completed = await running.completed;
  assert.equal(completed.code, 0, completed.stderr);
  assert.equal(JSON.parse(completed.stdout).applied, true);
  assert.match(
    await fs.readFile(path.join(safePackage, "dist", "chat-fixture.js"), "utf8"),
    /canonical-chat-history-page-v1/
  );
  assert.deepEqual(await fs.readFile(liveManifest), liveBefore);
  const liveAfterStat = await fs.stat(liveManifest, { bigint: true });
  assert.equal(liveAfterStat.dev, liveBeforeStat.dev);
  assert.equal(liveAfterStat.ino, liveBeforeStat.ino);
  assert.equal(liveAfterStat.mtimeNs, liveBeforeStat.mtimeNs);
  assert.equal(liveAfterStat.ctimeNs, liveBeforeStat.ctimeNs);
});

test("installer gates unsupported versions and detects native support first", async (t) => {
  const unsupported = await fixture({ version: "2026.8.0" });
  const native = await fixture({ version: "2026.8.0", nativeSupport: true });
  const nativeNarration = await fixture({
    version: "2026.8.0",
    nativeNarrationSupport: true
  });
  t.after(() => Promise.all([
    fs.rm(unsupported.root, { recursive: true, force: true }),
    fs.rm(native.root, { recursive: true, force: true }),
    fs.rm(nativeNarration.root, { recursive: true, force: true })
  ]));
  const unsupportedBefore = await treeDigest(unsupported.packageDir);
  assert.throws(() => run(unsupported.packageDir), /unsupported OpenClaw version/);
  assert.equal(await treeDigest(unsupported.packageDir), unsupportedBefore);
  assert.throws(() => run(native.packageDir), /already exposes native Vimicate history support/);
  assert.throws(
    () => run(nativeNarration.packageDir),
    /already exposes native Vimicate history support/
  );
});

test("installer refuses to downgrade a newer managed block", async (t) => {
  const files = await fixture();
  t.after(() => fs.rm(files.root, { recursive: true, force: true }));
  run(files.packageDir);
  const chat = path.join(files.packageDir, "dist", "chat-fixture.js");
  await fs.writeFile(chat, (await fs.readFile(chat, "utf8"))
    .replace("projector-v3", "projector-v4")
    .replace("projector-v3", "projector-v4"));
  const before = await treeDigest(files.packageDir);
  assert.throws(() => run(files.packageDir), /newer than installer/);
  assert.equal(await treeDigest(files.packageDir), before);
});

test("installer rejects symbolic-link package and bundle targets", async (t) => {
  const packageLinkFixture = await fixture();
  const bundleLinkFixture = await fixture();
  t.after(() => Promise.all([
    fs.rm(packageLinkFixture.root, { recursive: true, force: true }),
    fs.rm(bundleLinkFixture.root, { recursive: true, force: true })
  ]));
  const packageLink = path.join(packageLinkFixture.root, "openclaw-link");
  await fs.symlink(packageLinkFixture.packageDir, packageLink);
  assert.throws(() => run(packageLink), /package directory|source package is not a fixed directory/);

  const chat = path.join(bundleLinkFixture.packageDir, "dist", "chat-fixture.js");
  const backing = path.join(bundleLinkFixture.packageDir, "dist", "chat-fixture-source.txt");
  await fs.rename(chat, backing);
  await fs.symlink(backing, chat);
  assert.throws(() => run(bundleLinkFixture.packageDir), /symbolic-link bundle|symbolic link/);
});

test("installed registry independently health-gates archived history and shared narration", async (t) => {
  const files = await fixture();
  const home = path.join(files.root, "vimicate-home");
  t.after(() => fs.rm(files.root, { recursive: true, force: true }));
  run(files.packageDir);
  await fs.mkdir(home);
  const historyHealth = path.join(
    home,
    "openclaw-history-family-health.json"
  );
  const narrationHealth = path.join(
    home,
    "openclaw-shared-narration-health.json"
  );
  const historyMarker = {
    schemaVersion: 1,
    pid: process.pid,
    ready: true,
    contract: "archived-family-v1",
    writer: "session-end-ledger-v1",
    projector: "canonical-chat-history-page-v1",
    handler: "operator-read-rpc-v1",
    audit: "archived-family-audit-v1"
  };
  const narrationMarker = {
    schemaVersion: 1,
    pid: process.pid,
    ready: true,
    contract: "shared-narration-v1",
    store: "shared-narration-state-v1",
    subscription: "sanitized-agent-lifecycle-item-v2",
    handler: "operator-read-rpc-v1"
  };
  await fs.writeFile(
    historyHealth,
    `${JSON.stringify(historyMarker)}\n`,
    { mode: 0o600 }
  );
  await fs.writeFile(
    narrationHealth,
    `${JSON.stringify(narrationMarker)}\n`,
    { mode: 0o600 }
  );
  const previousHome = process.env.VIMICATE_HOME;
  process.env.VIMICATE_HOME = home;
  try {
    const module = await import(`${pathToFileURL(path.join(
      files.packageDir,
      "dist",
      "server-methods-fixture.js"
    )).href}?registry=${Date.now()}`);
    const result = await module.vimicateRegistryReadHandler();
    assert.equal(result.capabilities.archivedSessionFamily, "archived-family-v1");
    assert.equal(result.capabilities.sharedNarration, "shared-narration-v1");
    delete historyMarker.audit;
    await fs.writeFile(
      historyHealth,
      `${JSON.stringify(historyMarker)}\n`,
      { mode: 0o600 }
    );
    const withoutAudit = await module.vimicateRegistryReadHandler();
    assert.equal(withoutAudit.capabilities.archivedSessionFamily, undefined);
    assert.equal(
      withoutAudit.capabilities.sharedNarration,
      "shared-narration-v1"
    );
    historyMarker.audit = "archived-family-audit-v1";
    delete narrationMarker.subscription;
    await fs.writeFile(
      historyHealth,
      `${JSON.stringify(historyMarker)}\n`,
      { mode: 0o600 }
    );
    await fs.writeFile(
      narrationHealth,
      `${JSON.stringify(narrationMarker)}\n`,
      { mode: 0o600 }
    );
    const withoutSubscription = await module.vimicateRegistryReadHandler();
    assert.equal(
      withoutSubscription.capabilities.archivedSessionFamily,
      "archived-family-v1"
    );
    assert.equal(withoutSubscription.capabilities.sharedNarration, undefined);
  } finally {
    if (previousHome === undefined) delete process.env.VIMICATE_HOME;
    else process.env.VIMICATE_HOME = previousHome;
  }
});

test("projector rejects missing or inconsistent pagination metadata", async (t) => {
  const files = await fixture();
  t.after(() => {
    delete globalThis.__vimicateInstallerHistoryPage;
    delete globalThis.__vimicateInstallerFallbackOptions;
    delete globalThis.__vimicateInstallerExactOptions;
    delete globalThis.__vimicateInstallerCacheKeys;
    return fs.rm(files.root, { recursive: true, force: true });
  });
  run(files.packageDir);
  const module = await import(`${pathToFileURL(path.join(
    files.packageDir,
    "dist",
    "chat-fixture.js"
  )).href}?projector=${Date.now()}`);
  globalThis.__vimicateInstallerHistoryPage = {
    messages: [], totalMessages: 2, rawPageMessages: 1
  };
  assert.deepEqual(
    await module.vimicateReadArchivedHistoryPage(validAuthority()),
    {
      sessionId: "session-1",
      sessionKey: "agent:main:direct:test",
      transcriptFilename: "session-1.jsonl.reset.2026-07-19T00-00-00.000Z",
      offset: 0,
      nextOffset: 1,
      hasMore: true,
      totalMessages: 2,
      messages: []
    }
  );
  assert.deepEqual(globalThis.__vimicateInstallerFallbackOptions, [false, false, false]);
  assert.deepEqual(globalThis.__vimicateInstallerExactOptions, [true, true, true]);
  assert.deepEqual(
    globalThis.__vimicateInstallerCacheKeys,
    Array(3).fill(`vimicate:${"ab".repeat(32)}`)
  );
  const sessionUtils = await import(`${pathToFileURL(path.join(
    files.packageDir,
    "dist",
    "session-utils.fs-fixture.js"
  )).href}?session-utils=${Date.now()}`);
  for (const reader of [
    sessionUtils.readSessionMessagesWithSourceAsync,
    sessionUtils.readRecentSessionMessagesWithStatsAsync,
    sessionUtils.readSessionMessagesPageWithStatsAsync
  ]) {
    assert.equal((await reader(
      "session-1",
      "/synthetic/sessions.json",
      "/private-owned/projection.jsonl",
      {
        allowResetArchiveFallback: false,
        vimicateExactSessionFile: true,
        vimicateCacheKey: `vimicate:${"ab".repeat(32)}`
      },
      "main"
    )).transcriptPath, "/private-owned/projection.jsonl");
    assert.equal((await reader(
      "session-1",
      "/synthetic/sessions.json",
      "/private-owned/projection.jsonl",
      { allowResetArchiveFallback: true },
      "main"
    )).transcriptPath, "/outside/archive");
  }
  for (const page of [
    { messages: [], rawPageMessages: 0 },
    { messages: [], totalMessages: 0 },
    { messages: [], totalMessages: -1, rawPageMessages: 0 },
    { messages: [], totalMessages: 1, rawPageMessages: 2 }
  ]) {
    globalThis.__vimicateInstallerHistoryPage = page;
    await assert.rejects(
      module.vimicateReadArchivedHistoryPage(validAuthority()),
      /invalid pagination metadata/
    );
  }
  globalThis.__vimicateInstallerHistoryPage = {
    messages: [], totalMessages: 2, rawPageMessages: 0
  };
  await assert.rejects(
    module.vimicateReadArchivedHistoryPage(validAuthority()),
    /inconsistent pagination cursor/
  );
});

test("exact descriptor reads key OpenClaw caches by audited source revision", async (t) => {
  const files = await fixture();
  t.after(() => fs.rm(files.root, { recursive: true, force: true }));
  run(files.packageDir);
  const module = await import(`${pathToFileURL(path.join(
    files.packageDir,
    "dist",
    "session-utils.fs-fixture.js"
  )).href}?cache-revision=${Date.now()}`);
  const transcript = path.join(files.root, "reused-descriptor.jsonl");
  const fixedTime = new Date("2026-07-19T00:00:00.000Z");
  await fs.writeFile(transcript, '{"value":"A"}\n');
  await fs.utimes(transcript, fixedTime, fixedTime);
  const first = await module.readSessionMessagesPageWithStatsAsync(
    "session-a",
    "/dev/fd/sessions.json",
    transcript,
    {
      allowResetArchiveFallback: false,
      vimicateExactSessionFile: true,
      vimicateCacheKey: `vimicate:${"aa".repeat(32)}`
    },
    "main"
  );
  await fs.writeFile(transcript, '{"value":"B"}\n');
  await fs.utimes(transcript, fixedTime, fixedTime);
  const second = await module.readSessionMessagesPageWithStatsAsync(
    "session-b",
    "/dev/fd/sessions.json",
    transcript,
    {
      allowResetArchiveFallback: false,
      vimicateExactSessionFile: true,
      vimicateCacheKey: `vimicate:${"bb".repeat(32)}`
    },
    "main"
  );
  assert.equal(first.messages[0].record.value, "A");
  assert.equal(second.messages[0].record.value, "B");
  assert.equal(first.totalMessages, 1);
  assert.equal(second.totalMessages, 1);
});

test("exclusive advisory lock blocks a second installer and reuses an unlocked lock file", async (t) => {
  const files = await fixture();
  t.after(() => fs.rm(files.root, { recursive: true, force: true }));
  const control = path.join(files.root, "lock-control");
  const running = spawnRun(files.packageDir, {
    VIMICATE_INSTALLER_TEST_ROOT: files.root,
    VIMICATE_INSTALLER_TEST_CONTROL: control,
    VIMICATE_INSTALLER_TEST_PAUSE_AT: "before-source-revalidation"
  });
  await waitForFileWhileRunning(`${control}.ready`, running);
  assert.throws(() => run(files.packageDir), /another installer holds the advisory lock/);
  await fs.writeFile(`${control}.continue`, "continue\n");
  const completed = await running.completed;
  assert.equal(completed.code, 0, completed.stderr);
  const retainedLock = path.join(files.root, ".openclaw-copy.vimicate-install.lock");
  assert.equal((await fs.stat(retainedLock)).mode & 0o777, 0o600);

  const stale = await fixture();
  t.after(() => fs.rm(stale.root, { recursive: true, force: true }));
  const lock = path.join(stale.root, ".openclaw-copy.vimicate-install.lock");
  await fs.writeFile(lock, `${JSON.stringify({
    schemaVersion: 1,
    pid: 99999999,
    nonce: "stale-owner",
    acquiredAt: "2026-07-19T00:00:00.000Z"
  })}\n`, { mode: 0o600 });
  assert.equal(run(stale.packageDir).applied, true);
});

test("source generation mutation aborts before package replacement", async (t) => {
  const files = await fixture();
  t.after(() => fs.rm(files.root, { recursive: true, force: true }));
  const control = path.join(files.root, "mutation-control");
  const running = spawnRun(files.packageDir, {
    VIMICATE_INSTALLER_TEST_ROOT: files.root,
    VIMICATE_INSTALLER_TEST_CONTROL: control,
    VIMICATE_INSTALLER_TEST_PAUSE_AT: "before-source-revalidation"
  });
  await waitForFile(`${control}.ready`);
  const manifest = path.join(files.packageDir, "package.json");
  const value = JSON.parse(await fs.readFile(manifest, "utf8"));
  value.concurrentMutation = true;
  await fs.writeFile(manifest, JSON.stringify(value));
  await fs.writeFile(`${control}.continue`, "continue\n");
  const completed = await running.completed;
  assert.equal(completed.code, 1);
  assert.match(completed.stderr, /package changed while the staged installer was validating/);
  assert.equal(JSON.parse(await fs.readFile(manifest, "utf8")).concurrentMutation, true);
  assert.equal((await fs.readdir(files.root)).some((name) => name.includes("vimicate-backup")), false);
});

test("version and native-support validation remain bound to the initial generation", async (t) => {
  const files = await fixture();
  t.after(() => fs.rm(files.root, { recursive: true, force: true }));
  const control = path.join(files.root, "validation-generation-control");
  const running = spawnRun(files.packageDir, {
    VIMICATE_INSTALLER_TEST_ROOT: files.root,
    VIMICATE_INSTALLER_TEST_CONTROL: control,
    VIMICATE_INSTALLER_TEST_PAUSE_AT: "after-initial-generation-before-validation"
  });
  await waitForFile(`${control}.ready`);
  const schema = path.join(files.packageDir, "dist", "schema-fixture.js");
  await fs.appendFile(schema, "\n// concurrent generation\n");
  await fs.writeFile(`${control}.continue`, "continue\n");
  const completed = await running.completed;
  assert.equal(completed.code, 1);
  assert.match(completed.stderr, /changed during version and native-support validation/);
  assert.match(await fs.readFile(schema, "utf8"), /concurrent generation/);
  assert.equal((await fs.readdir(files.root)).some((name) => name.includes("vimicate-backup")), false);
});

test("commit-boundary mutation is restored and never leaves the target absent", async (t) => {
  const files = await fixture();
  t.after(() => fs.rm(files.root, { recursive: true, force: true }));
  const control = path.join(files.root, "boundary-control");
  const running = spawnRun(files.packageDir, {
    VIMICATE_INSTALLER_TEST_ROOT: files.root,
    VIMICATE_INSTALLER_TEST_CONTROL: control,
    VIMICATE_INSTALLER_TEST_PAUSE_AT: "after-target-move-before-backup-validation"
  });
  await waitForFile(`${control}.ready`);
  assert.equal(await fs.stat(files.packageDir).then(() => true, () => false), false);
  const backupName = (await fs.readdir(files.root)).find((name) => name.includes("vimicate-backup"));
  assert.ok(backupName);
  const backupManifest = path.join(files.root, backupName, "package.json");
  const value = JSON.parse(await fs.readFile(backupManifest, "utf8"));
  value.commitBoundaryMutation = true;
  await fs.writeFile(backupManifest, JSON.stringify(value));
  await fs.writeFile(`${control}.continue`, "continue\n");
  const completed = await running.completed;
  assert.equal(completed.code, 1);
  assert.match(completed.stderr, /changed at commit boundary; changed package was restored/);
  assert.equal((await fs.stat(files.packageDir)).isDirectory(), true);
  assert.equal(
    JSON.parse(await fs.readFile(path.join(files.packageDir, "package.json"), "utf8"))
      .commitBoundaryMutation,
    true
  );
  assert.equal((await fs.readdir(files.root)).some((name) => name.includes("install-transaction")), false);
  assert.equal((await fs.readdir(files.root)).some((name) => name.includes("install.lock")), true);
});

test("managed extension child symlink is rejected without touching its victim", async (t) => {
  const files = await fixture();
  t.after(() => fs.rm(files.root, { recursive: true, force: true }));
  const victim = path.join(files.root, "victim.txt");
  await fs.writeFile(victim, "do not overwrite\n");
  const before = await treeDigest(files.packageDir);
  const control = path.join(files.root, "extension-symlink-control");
  const running = spawnRun(files.packageDir, {
    VIMICATE_INSTALLER_TEST_ROOT: files.root,
    VIMICATE_INSTALLER_TEST_CONTROL: control,
    VIMICATE_INSTALLER_TEST_PAUSE_AT: "after-stage-copy-before-patch"
  });
  await waitForFile(`${control}.ready`);
  const stageName = (await fs.readdir(files.root)).find((name) => name.includes("vimicate-stage"));
  assert.ok(stageName);
  const extension = path.join(
    files.root,
    stageName,
    "dist",
    "extensions",
    "vimicate-history-family"
  );
  await fs.mkdir(extension, { recursive: true });
  await fs.symlink(victim, path.join(extension, "index.js"));
  await fs.writeFile(`${control}.continue`, "continue\n");
  const completed = await running.completed;
  assert.equal(completed.code, 1);
  assert.match(completed.stderr, /managed target "index\.js" is symlink/);
  assert.equal(await fs.readFile(victim, "utf8"), "do not overwrite\n");
  assert.equal(await treeDigest(files.packageDir), before);
});

test("atomic package-directory replacement invalidates the bound authority", async (t) => {
  const files = await fixture();
  t.after(() => fs.rm(files.root, { recursive: true, force: true }));
  const control = path.join(files.root, "authority-swap-control");
  const running = spawnRun(files.packageDir, {
    VIMICATE_INSTALLER_TEST_ROOT: files.root,
    VIMICATE_INSTALLER_TEST_CONTROL: control,
    VIMICATE_INSTALLER_TEST_PAUSE_AT: "after-package-authority"
  });
  await waitForFile(`${control}.ready`);
  const replacement = path.join(files.root, "replacement-package");
  const displaced = path.join(files.root, "displaced-package");
  await fs.cp(files.packageDir, replacement, { recursive: true, preserveTimestamps: true });
  const manifest = JSON.parse(await fs.readFile(path.join(replacement, "package.json"), "utf8"));
  manifest.atomicReplacement = true;
  await fs.writeFile(path.join(replacement, "package.json"), JSON.stringify(manifest));
  await fs.rename(files.packageDir, displaced);
  await fs.rename(replacement, files.packageDir);
  await fs.writeFile(`${control}.continue`, "continue\n");
  const completed = await running.completed;
  assert.equal(completed.code, 1);
  assert.match(completed.stderr, /package authority changed before staging/);
  assert.equal(
    JSON.parse(await fs.readFile(path.join(files.packageDir, "package.json"), "utf8"))
      .atomicReplacement,
    true
  );
});

test("installer source modules are copied from one snapshot and revalidated", async (t) => {
  const files = await fixture();
  const installerSource = await fixtureSourceSnapshot(files.root);
  t.after(() => fs.rm(files.root, { recursive: true, force: true }));
  const before = await treeDigest(files.packageDir);
  const control = path.join(files.root, "installer-source-control");
  const running = spawnRun(files.packageDir, {
    VIMICATE_INSTALLER_TEST_ROOT: files.root,
    VIMICATE_INSTALLER_TEST_SOURCE_DIR: installerSource,
    VIMICATE_INSTALLER_TEST_CONTROL: control,
    VIMICATE_INSTALLER_TEST_PAUSE_AT: "before-source-revalidation"
  });
  await waitForFile(`${control}.ready`);
  await fs.appendFile(
    path.join(installerSource, sourceModules[0]),
    "\n// concurrent installer source mutation\n"
  );
  await fs.writeFile(`${control}.continue`, "continue\n");
  const completed = await running.completed;
  assert.equal(completed.code, 1);
  assert.match(completed.stderr, /installer source .* changed after snapshot/);
  assert.equal(await treeDigest(files.packageDir), before);
});

test("post-install atomic replacement is preserved and never reported as accepted", async (t) => {
  const files = await fixture();
  t.after(() => fs.rm(files.root, { recursive: true, force: true }));
  const control = path.join(files.root, "installed-swap-control");
  const running = spawnRun(files.packageDir, {
    VIMICATE_INSTALLER_TEST_ROOT: files.root,
    VIMICATE_INSTALLER_TEST_CONTROL: control,
    VIMICATE_INSTALLER_TEST_PAUSE_AT: "after-stage-install-before-validation"
  });
  await waitForFile(`${control}.ready`);
  const backupName = (await fs.readdir(files.root)).find((name) => name.includes("vimicate-backup"));
  assert.ok(backupName);
  const replacement = path.join(files.root, "post-install-replacement");
  const displaced = path.join(files.root, "post-install-displaced");
  await fs.cp(path.join(files.root, backupName), replacement, {
    recursive: true,
    preserveTimestamps: true
  });
  const manifestFile = path.join(replacement, "package.json");
  const manifest = JSON.parse(await fs.readFile(manifestFile, "utf8"));
  manifest.postInstallReplacement = true;
  await fs.writeFile(manifestFile, JSON.stringify(manifest));
  await fs.rename(files.packageDir, displaced);
  await fs.rename(replacement, files.packageDir);
  await fs.writeFile(`${control}.continue`, "continue\n");
  const completed = await running.completed;
  assert.equal(completed.code, 1);
  assert.match(completed.stderr, /concurrent package was preserved/);
  assert.equal(completed.stdout, "");
  assert.equal(
    JSON.parse(await fs.readFile(path.join(files.packageDir, "package.json"), "utf8"))
      .postInstallReplacement,
    true
  );
  assert.equal((await fs.readdir(files.root)).some((name) => name.includes("install-transaction")), false);
});

test("advisory lock admits one of three installers without stale-lock ABA", async (t) => {
  const files = await fixture();
  t.after(() => fs.rm(files.root, { recursive: true, force: true }));
  const control = path.join(files.root, "three-process-control");
  const winner = spawnRun(files.packageDir, {
    VIMICATE_INSTALLER_TEST_ROOT: files.root,
    VIMICATE_INSTALLER_TEST_CONTROL: control,
    VIMICATE_INSTALLER_TEST_PAUSE_AT: "before-source-revalidation"
  });
  await waitForFile(`${control}.ready`);
  const contenders = [spawnRun(files.packageDir), spawnRun(files.packageDir)];
  const rejected = await Promise.all(contenders.map((entry) => entry.completed));
  assert.deepEqual(rejected.map((entry) => entry.code), [1, 1]);
  for (const entry of rejected) assert.match(entry.stderr, /another installer holds the advisory lock/);
  await fs.writeFile(`${control}.continue`, "continue\n");
  const accepted = await winner.completed;
  assert.equal(accepted.code, 0, accepted.stderr);
  assert.equal(JSON.parse(accepted.stdout).applied, true);
});

for (const crashPoint of ["after-journal-prepared", "after-target-move", "after-stage-install"]) {
  test(`transaction journal recovers a deterministic crash at ${crashPoint}`, async (t) => {
    const files = await fixture();
    t.after(() => fs.rm(files.root, { recursive: true, force: true }));
    const crashed = spawnRun(files.packageDir, {
      VIMICATE_INSTALLER_TEST_ROOT: files.root,
      VIMICATE_INSTALLER_TEST_CRASH_AT: crashPoint
    });
    const result = await crashed.completed;
    assert.notEqual(result.code, 0);
    const recovered = run(files.packageDir);
    assert.equal(recovered.applied, crashPoint !== "after-stage-install");
    assert.equal((await fs.readdir(files.root)).some((name) => name.includes("install-transaction")), false);
    assert.equal((await fs.readdir(files.root)).some((name) => name.includes("install.lock")), true);
  });
}
