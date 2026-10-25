#!/usr/bin/env node

import { fail, parseArguments } from "./history-family-install-arguments.mjs";
import childProcess from "node:child_process";
import crypto from "node:crypto";
import fsNative from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PATCH_VERSION = 3;
const CHAT_BEGIN = `// BEGIN vimicate-history-family projector-v${PATCH_VERSION}`;
const CHAT_END = `// END vimicate-history-family projector-v${PATCH_VERSION}`;
const REGISTRY_BEGIN = `// BEGIN vimicate-history-family capability-v${PATCH_VERSION}`;
const REGISTRY_END = `// END vimicate-history-family capability-v${PATCH_VERSION}`;
const HISTORY_METHOD = "vimicate.history.family";
const SUPPORTED_OPENCLAW_VERSIONS = new Set(["2026.7.1", "2026.7.1-2"]);
const TRANSACTION_SCHEMA_VERSION = 1;
const sourceDir = path.dirname(fileURLToPath(import.meta.url));
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



function isInstalledPackagePath(packageDir) {
  return path.basename(packageDir) === "openclaw"
    && path.basename(path.dirname(packageDir)) === "node_modules";
}

async function canonicalPackageAuthorityPath(packageDir) {
  const resolved = path.resolve(packageDir);
  return path.join(
    await fs.realpath(path.dirname(resolved)),
    path.basename(resolved)
  );
}

async function requirePackageDirectory(packageDir, applyLive, expectedIdentity) {
  const resolved = path.resolve(packageDir);
  if (expectedIdentity !== undefined
      && !sameDirectoryIdentity(expectedIdentity, await directoryIdentity(resolved, "package directory"))) {
    fail("package directory identity changed before manifest validation");
  }
  const stat = await fs.lstat(resolved);
  if (!stat.isDirectory() || stat.isSymbolicLink()) fail("package directory is not fixed");
  const manifestFile = path.join(resolved, "package.json");
  const manifestStat = await fs.lstat(manifestFile);
  if (!manifestStat.isFile() || manifestStat.isSymbolicLink()) fail("package manifest is not fixed");
  const manifest = JSON.parse((await readPinnedFile(manifestFile, {
    label: "package manifest",
    maxBytes: 1024 * 1024
  })).bytes.toString("utf8"));
  if (manifest?.name !== "openclaw" || typeof manifest?.version !== "string") {
    fail("target is not an OpenClaw package");
  }
  if (isInstalledPackagePath(await canonicalPackageAuthorityPath(resolved)) && !applyLive) {
    fail("refusing the live OpenClaw package without --apply-live");
  }
  if (expectedIdentity !== undefined
      && !sameDirectoryIdentity(expectedIdentity, await directoryIdentity(resolved, "package directory"))) {
    fail("package directory identity changed during manifest validation");
  }
  return { packageDir: resolved, version: manifest.version };
}

async function uniqueBundle(distDir, predicate, label) {
  const distStat = await fs.lstat(distDir);
  if (!distStat.isDirectory() || distStat.isSymbolicLink()) fail("dist directory is not fixed");
  const matches = [];
  for (const name of await fs.readdir(distDir)) {
    if (!name.endsWith(".js")) continue;
    const file = path.join(distDir, name);
    const stat = await fs.lstat(file);
    if (stat.isSymbolicLink()) fail(`refusing symbolic-link bundle ${JSON.stringify(name)}`);
    if (!stat.isFile()) continue;
    const text = (await readPinnedFile(file, {
      label: `bundle ${JSON.stringify(name)}`,
      maxBytes: 256 * 1024 * 1024
    })).bytes.toString("utf8");
    if (predicate(name, text)) matches.push({ file, name, text });
  }
  if (matches.length !== 1) fail(`expected one ${label} bundle; found ${matches.length}`);
  return matches[0];
}

function replaceExactly(text, anchor, replacement, label) {
  const first = text.indexOf(anchor);
  if (first < 0 || text.indexOf(anchor, first + anchor.length) >= 0) {
    fail(`expected one ${label} anchor`);
  }
  return text.slice(0, first) + replacement + text.slice(first + anchor.length);
}

function replaceManagedBlock(text, kind, currentBlock) {
  const pattern = new RegExp(
    `// BEGIN vimicate-history-family ${kind}-v(\\d+)\\n[\\s\\S]*?`
      + `// END vimicate-history-family ${kind}-v(\\d+)\\n?`,
    "g"
  );
  const matches = [...text.matchAll(pattern)];
  if (matches.length > 1) fail(`${kind} has stacked managed blocks`);
  if (matches.length === 0) return { found: false, text };
  const [match] = matches;
  if (match[1] !== match[2]) fail(`${kind} marker versions disagree`);
  if (Number(match[1]) > PATCH_VERSION) {
    fail(`${kind} managed block v${match[1]} is newer than installer v${PATCH_VERSION}`);
  }
  return {
    found: true,
    text: text.slice(0, match.index)
      + currentBlock
      + text.slice(match.index + match[0].length)
  };
}

function patchSessionResetEpoch(text) {
  // The supported reset creates and commits its successor before session_end.
  // Establish its immutable epoch in that same creation transaction; neither
  // the reader nor the lineage writer may infer one from later activity.
  const anchor = /const now = Date\.now\(\);\n([\t ]*)const nextSessionId = randomUUID\(\);\n\1const nextEntry = \{\n([\t ]*)sessionId: nextSessionId,/g;
  const matches = [...text.matchAll(anchor)];
  if (matches.length !== 1) fail("reset successor creation anchor changed");
  const [match] = matches;
  const end = text.indexOf("return nextEntry;", match.index + match[0].length);
  if (end < 0) fail("reset successor return anchor changed");
  const offset = match.index + match[0].length;
  const line = `\n${match[2]}sessionStartedAt: now, // vimicate-history-family reset-epoch-v${PATCH_VERSION}`;
  const body = text.slice(offset, end);
  if (body.startsWith(line)
      && (body.match(/sessionStartedAt\s*:/g) ?? []).length === 1) return text;
  if (body.includes("sessionStartedAt") || body.includes("reset-epoch-v")) {
    fail("reset successor epoch already has an unreviewed owner");
  }
  if (!body.startsWith(`\n${match[2]}sessionFile`)) fail("reset successor fields changed");
  return text.slice(0, offset) + line + text.slice(offset);
}

function projectorBlock() {
  return `${CHAT_BEGIN}
async function vimicateReadArchivedHistoryPage(params) {
\tconst max = Math.min(128, Number.isSafeInteger(params?.limit) ? params.limit : 0);
\tif (max < 1 || !Number.isSafeInteger(params?.offset) || params.offset < 0
\t\t|| typeof params?.sessionId !== "string"
\t\t|| typeof params?.stableSessionKey !== "string"
\t\t|| typeof params?.agentId !== "string"
\t\t|| typeof params?.storePath !== "string"
\t\t|| typeof params?.sessionFile !== "string"
\t\t|| typeof params?.transcriptFilename !== "string"
\t\t|| !/^[0-9a-f]{64}$/.test(params?.sourceRevision)
\t\t|| !Number.isSafeInteger(params?.startedAtMs) || params.startedAtMs < 1) {
\t\tthrow new Error("vimicate canonical history projector received invalid authority");
\t}
\tconst maxHistoryBytes = getMaxChatHistoryMessagesBytes();
\tconst historyPage = await readChatHistoryPage({
\t\tentry: {
\t\t\tsessionId: params.sessionId,
\t\t\tsessionStartedAt: params.startedAtMs,
\t\t\tsessionFile: params.sessionFile
\t\t},
\t\tprovider: "",
\t\tsessionId: params.sessionId,
\t\tstorePath: params.storePath,
\t\tsessionAgentId: params.agentId,
\t\tcanonicalKey: params.stableSessionKey,
\t\tmax,
\t\tmaxHistoryBytes,
\t\teffectiveMaxChars: resolveEffectiveChatHistoryMaxChars(params.cfg ?? {}),
\t\toffset: params.offset,
\t\tvimicateExactSessionFile: true,
\t\tvimicateCacheKey: "vimicate:" + params.sourceRevision
\t});
\tconst replaced = replaceOversizedChatHistoryMessages({
\t\tmessages: historyPage.messages,
\t\tmaxSingleMessageBytes: Math.min(CHAT_HISTORY_MAX_SINGLE_MESSAGE_BYTES, maxHistoryBytes)
\t});
\tconst capped = capArrayByJsonBytes(replaced.messages, maxHistoryBytes).items;
\tconst bounded = enforceChatHistoryFinalBudget({ messages: capped, maxBytes: maxHistoryBytes });
\tif (!Number.isSafeInteger(historyPage.totalMessages) || historyPage.totalMessages < 0
\t\t|| !Number.isSafeInteger(historyPage.rawPageMessages) || historyPage.rawPageMessages < 0
\t\t|| params.offset > historyPage.totalMessages
\t\t|| historyPage.rawPageMessages > historyPage.totalMessages - params.offset) {
\t\tthrow new Error("vimicate canonical history projector received invalid pagination metadata");
\t}
\tconst nextOffset = resolveChatHistoryNextOffset({
\t\tmessages: bounded.messages,
\t\ttotalMessages: historyPage.totalMessages,
\t\toffset: params.offset,
\t\trawPageMessages: historyPage.rawPageMessages
\t});
\tif (!Number.isSafeInteger(nextOffset) || nextOffset < params.offset
\t\t|| nextOffset > historyPage.totalMessages
\t\t|| (nextOffset === params.offset && nextOffset < historyPage.totalMessages)) {
\t\tthrow new Error("vimicate canonical history projector received inconsistent pagination cursor");
\t}
\tconst hasMore = nextOffset < historyPage.totalMessages;
\treturn {
\t\tsessionId: params.sessionId,
\t\tsessionKey: params.stableSessionKey,
\t\ttranscriptFilename: params.transcriptFilename,
\t\toffset: params.offset,
\t\t...hasMore ? { nextOffset } : {},
\t\thasMore,
\t\ttotalMessages: historyPage.totalMessages,
\t\tmessages: bounded.messages
\t};
}
function vimicateHistoryFamilyProjectorProbe() {
\treturn { contract: "canonical-chat-history-page-v1" };
}
${CHAT_END}
`;
}

function patchCanonicalHistoryReader(text) {
  const beginAnchor = "async function readChatHistoryPage(params) {";
  const endAnchor = "async function handleChatHistoryRequest";
  const begin = text.indexOf(beginAnchor);
  const end = text.indexOf(endAnchor, begin + beginAnchor.length);
  if (begin < 0 || end < 0
      || text.indexOf(beginAnchor, begin + beginAnchor.length) >= 0
      || text.indexOf(endAnchor, end + endAnchor.length) >= 0) {
    fail("canonical chat-history reader anchor changed");
  }
  const slice = text.slice(begin, end);
  const original = "allowResetArchiveFallback: true";
  const patchedFallback =
    "allowResetArchiveFallback: params.vimicateExactSessionFile !== true";
  const patchedExact =
    "vimicateExactSessionFile: params.vimicateExactSessionFile === true";
  const patchedCache = "vimicateCacheKey: params.vimicateCacheKey";
  const originalCount = slice.split(original).length - 1;
  const patchedFallbackCount = slice.split(patchedFallback).length - 1;
  const patchedExactCount = slice.split(patchedExact).length - 1;
  const patchedCacheCount = slice.split(patchedCache).length - 1;
  if (originalCount === 3 && patchedFallbackCount === 0
      && patchedExactCount === 0 && patchedCacheCount === 0) {
    const replacement = slice.replace(/^(\s*)allowResetArchiveFallback: true$/gm,
      (_line, indentation) => `${indentation}${patchedFallback},\n`
        + `${indentation}${patchedExact},\n`
        + `${indentation}${patchedCache}`);
    if (replacement.split(patchedFallback).length - 1 !== 3
        || replacement.split(patchedExact).length - 1 !== 3
        || replacement.split(patchedCache).length - 1 !== 3) {
      fail("canonical reset-archive fallback indentation changed");
    }
    return text.slice(0, begin) + replacement + text.slice(end);
  }
  if (originalCount === 0 && patchedFallbackCount === 3
      && patchedExactCount === 0 && patchedCacheCount === 0) {
    const replacement = slice.replace(
      /^(\s*)allowResetArchiveFallback: params\.vimicateExactSessionFile !== true$/gm,
      (_line, indentation) => `${indentation}${patchedFallback},\n`
        + `${indentation}${patchedExact},\n`
        + `${indentation}${patchedCache}`
    );
    if (replacement.split(patchedExact).length - 1 !== 3
        || replacement.split(patchedCache).length - 1 !== 3) {
      fail("canonical exact-file upgrade indentation changed");
    }
    return text.slice(0, begin) + replacement + text.slice(end);
  }
  if (originalCount === 0 && patchedFallbackCount === 3
      && patchedExactCount === 3 && patchedCacheCount === 0) {
    const replacement = slice.replace(
      /^(\s*)vimicateExactSessionFile: params\.vimicateExactSessionFile === true$/gm,
      (_line, indentation) => `${indentation}${patchedExact},\n`
        + `${indentation}${patchedCache}`
    );
    if (replacement.split(patchedCache).length - 1 !== 3) {
      fail("canonical exact-cache upgrade indentation changed");
    }
    return text.slice(0, begin) + replacement + text.slice(end);
  }
  if (originalCount === 0 && patchedFallbackCount === 3
      && patchedExactCount === 3 && patchedCacheCount === 3) {
    return text;
  }
  fail("canonical reset-archive fallback anchors changed");
}

function patchChat(bundle) {
  const canonical = patchCanonicalHistoryReader(bundle.text);
  const managed = replaceManagedBlock(canonical, "projector", projectorBlock());
  let text = managed.text;
  if (!managed.found) {
    text = replaceExactly(
      text,
      "const chatHandlers = {",
      `${projectorBlock()}const chatHandlers = {`,
      "chat handler"
    );
  }
  if (!/vimicateReadArchivedHistoryPage as vimicateReadArchivedHistoryPage/.test(text)) {
    const exportPattern = /export \{ ([^\n]+) \};\s*$/;
    const match = exportPattern.exec(text);
    if (!match) fail("chat export anchor changed");
    text = text.slice(0, match.index)
      + `export { ${match[1]}, vimicateReadArchivedHistoryPage as vimicateReadArchivedHistoryPage, vimicateHistoryFamilyProjectorProbe as vimicateHistoryFamilyProjectorProbe };\n`;
  }
  return text;
}

function patchSessionUtils(bundle) {
  const original = "opts.allowResetArchiveFallback === true ? await "
    + "findExistingTranscriptHistoryPathAsync(sessionId, storePath, sessionFile, agentId) "
    + ": findExistingTranscriptPath(sessionId, storePath, sessionFile, agentId)";
  const patched = "opts.vimicateExactSessionFile === true ? sessionFile : "
    + original;
  const originalCount = bundle.text.split(original).length - 1;
  const patchedCount = bundle.text.split(patched).length - 1;
  let text = bundle.text;
  if (originalCount === 3 && patchedCount === 0) text = text.replaceAll(original, patched);
  else if (!(originalCount === 3 && patchedCount === 3)) {
    fail("canonical transcript reader exact-file anchors changed");
  }

  const indexAnchor = "async function readSessionTranscriptIndex(filePath, opts = {}) {";
  const cacheKeyLine = "\tconst cacheKey = typeof opts.vimicateCacheKey === \"string\" ? opts.vimicateCacheKey : filePath;";
  const indexStart = text.indexOf(indexAnchor);
  const indexEnd = text.indexOf("\n}\n", indexStart) + 3;
  if (indexStart < 0 || indexEnd < 3) fail("transcript index cache anchor changed");
  let indexSlice = text.slice(indexStart, indexEnd);
  if (!indexSlice.includes(cacheKeyLine)) {
    indexSlice = indexSlice.replace(indexAnchor, `${indexAnchor}\n${cacheKeyLine}`)
      .replaceAll("transcriptIndexCache.delete(filePath)", "transcriptIndexCache.delete(cacheKey)")
      .replaceAll("transcriptIndexCache.get(filePath)", "transcriptIndexCache.get(cacheKey)")
      .replaceAll("touchCachedIndex(filePath, cached)", "touchCachedIndex(cacheKey, cached)")
      .replaceAll("transcriptIndexBuilds.get(filePath)", "transcriptIndexBuilds.get(cacheKey)")
      .replaceAll("transcriptIndexBuilds.set(filePath", "transcriptIndexBuilds.set(cacheKey")
      .replaceAll("transcriptIndexBuilds.delete(filePath)", "transcriptIndexBuilds.delete(cacheKey)")
      .replaceAll("setCachedIndex(filePath", "setCachedIndex(cacheKey");
  }
  if ((indexSlice.match(/cacheKey/g) ?? []).length < 8) {
    fail("transcript index cache-key patch is incomplete");
  }
  text = text.slice(0, indexStart) + indexSlice + text.slice(indexEnd);

  function patchFunctionSlice(beginAnchor, endAnchor, replacements, label) {
    const begin = text.indexOf(beginAnchor);
    const end = text.indexOf(endAnchor, begin + beginAnchor.length);
    if (begin < 0 || end < 0) fail(`${label} anchors changed`);
    let slice = text.slice(begin, end);
    for (const [from, to] of replacements) {
      if (slice.includes(to)) continue;
      if (slice.split(from).length - 1 !== 1) fail(`${label} cache call changed`);
      slice = slice.replace(from, to);
    }
    text = text.slice(0, begin) + slice + text.slice(end);
  }
  patchFunctionSlice(
    "async function readSessionMessagesWithSourceAsync(",
    "async function readSessionMessageByIdAsync(",
    [["readSessionTranscriptIndex(filePath)",
      "readSessionTranscriptIndex(filePath, { vimicateCacheKey: opts.vimicateCacheKey })"]],
    "all-history exact reader"
  );
  patchFunctionSlice(
    "async function readRecentSessionMessagesWithStatsAsync(",
    "async function readSessionMessagesPageWithStatsAsync(",
    [["readSessionMessageCountFromPathAsync(filePath)",
      "readSessionMessageCountFromPathAsync(filePath, opts.vimicateCacheKey)"]],
    "recent-history exact reader"
  );
  patchFunctionSlice(
    "async function readSessionMessagesPageWithStatsAsync(",
    "function parsedSessionEntryToMessage(",
    [["readSessionTranscriptIndex(filePath)",
      "readSessionTranscriptIndex(filePath, { vimicateCacheKey: opts.vimicateCacheKey })"]],
    "paged-history exact reader"
  );
  patchFunctionSlice(
    "async function readSessionMessageCountFromPathAsync(",
    "function withOpenTranscriptFd(",
    [
      ["async function readSessionMessageCountFromPathAsync(filePath)",
        "async function readSessionMessageCountFromPathAsync(filePath, vimicateCacheKey)"],
      ["let stat = null;", "const cacheKey = typeof vimicateCacheKey === \"string\" ? vimicateCacheKey : filePath;\n\tlet stat = null;"],
      ["getCachedTranscriptMessageCount(filePath, stat)",
        "getCachedTranscriptMessageCount(cacheKey, stat)"],
      ["readSessionTranscriptIndex(filePath)",
        "readSessionTranscriptIndex(filePath, { vimicateCacheKey: cacheKey })"],
      ["setCachedTranscriptMessageCount(filePath, stat, count)",
        "setCachedTranscriptMessageCount(cacheKey, stat, count)"]
    ],
    "message-count cache"
  );
  return text;
}

function registryCapabilityBlock() {
  return `${REGISTRY_BEGIN}
const vimicateHistoryFamilyPath = process.getBuiltinModule("node:path");
const vimicateHistoryFamilyOS = process.getBuiltinModule("node:os");
const vimicateHistoryFamilyFS = process.getBuiltinModule("node:fs");
function vimicateReadHealthMarker(filename) {
\tconst configuredHome = process.env.VIMICATE_HOME;
\tif (configuredHome !== void 0 && !vimicateHistoryFamilyPath.isAbsolute(configuredHome)) return;
\tconst file = vimicateHistoryFamilyPath.join(
\t\tconfiguredHome ?? vimicateHistoryFamilyPath.join(vimicateHistoryFamilyOS.homedir(), ".vimicate"),
\t\tfilename
\t);
\tlet descriptor;
\ttry {
\t\tdescriptor = vimicateHistoryFamilyFS.openSync(
\t\t\tfile,
\t\t\tvimicateHistoryFamilyFS.constants.O_RDONLY | vimicateHistoryFamilyFS.constants.O_NOFOLLOW
\t\t);
\t\tconst before = vimicateHistoryFamilyFS.fstatSync(descriptor);
\t\tif (!before.isFile() || before.size < 1 || before.size > 4096 || (before.mode & 511) !== 384) return;
\t\tconst value = JSON.parse(vimicateHistoryFamilyFS.readFileSync(descriptor, "utf8"));
\t\tconst after = vimicateHistoryFamilyFS.fstatSync(descriptor);
\t\tconst fixed = vimicateHistoryFamilyFS.lstatSync(file);
\t\tif (before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size
\t\t\t|| before.mode !== after.mode || before.mtimeMs !== after.mtimeMs
\t\t\t|| before.ctimeMs !== after.ctimeMs
\t\t\t|| fixed.isSymbolicLink() || fixed.dev !== after.dev || fixed.ino !== after.ino
\t\t\t|| fixed.size !== after.size || fixed.mode !== after.mode
\t\t\t|| fixed.mtimeMs !== after.mtimeMs || fixed.ctimeMs !== after.ctimeMs
\t\t\t|| value?.schemaVersion !== 1 || value?.pid !== process.pid || value?.ready !== true) return;
\t\treturn value;
\t} catch {
\t\treturn;
\t} finally {
\t\tif (descriptor !== void 0) {
\t\t\ttry { vimicateHistoryFamilyFS.closeSync(descriptor); } catch {}
\t\t}
\t}
}
function vimicateHistoryFamilyCapability() {
\tconst value = vimicateReadHealthMarker("openclaw-history-family-health.json");
\tif (value?.contract !== "archived-family-v1"
\t\t\t|| value?.writer !== "session-end-ledger-v1"
\t\t\t|| value?.projector !== "canonical-chat-history-page-v1"
\t\t\t|| value?.handler !== "operator-read-rpc-v1"
\t\t\t|| value?.audit !== "archived-family-audit-v1") return {};
\treturn { archivedSessionFamily: "archived-family-v1" };
}
function vimicateSharedNarrationCapability() {
\tconst value = vimicateReadHealthMarker("openclaw-shared-narration-health.json");
\tif (value?.contract !== "shared-narration-v1"
\t\t\t|| value?.store !== "shared-narration-state-v1"
\t\t\t|| value?.subscription !== "sanitized-agent-lifecycle-item-v2"
\t\t\t|| value?.handler !== "operator-read-rpc-v1") return {};
\treturn { sharedNarration: "shared-narration-v1" };
}
${REGISTRY_END}
`;
}

function patchRegistry(bundle) {
  const managed = replaceManagedBlock(
    bundle.text,
    "capability",
    registryCapabilityBlock()
  );
  let text = managed.text;
  if (!text.includes("async function vimicateRegistryReadHandler")) {
    fail("Vimicate registry v5 host patch is required before family integration");
  }
  if (!managed.found) {
    text = replaceExactly(
      text,
      "async function vimicateRegistryReadHandler",
      `${registryCapabilityBlock()}async function vimicateRegistryReadHandler`,
      "registry read handler"
    );
  }
  if (!text.includes("...vimicateHistoryFamilyCapability()")) {
    text = replaceExactly(
      text,
      'threadRegistryProbe: "nonmutating-v1"',
      'threadRegistryProbe: "nonmutating-v1",\n\t\t\t\t...vimicateHistoryFamilyCapability()',
      "registry capabilities"
    );
  }
  if (!text.includes("...vimicateSharedNarrationCapability()")) {
    text = replaceExactly(
      text,
      'threadRegistryProbe: "nonmutating-v1"',
      'threadRegistryProbe: "nonmutating-v1",\n\t\t\t\t...vimicateSharedNarrationCapability()',
      "shared narration registry capability"
    );
  }
  return text;
}

async function writeManagedFile(file, content, mode = 0o644) {
  const bytes = Buffer.isBuffer(content) ? content : Buffer.from(content);
  const parent = path.dirname(file);
  if (await pathKind(parent) !== "directory") fail("managed file parent is not fixed");
  const beforeKind = await pathKind(file);
  let beforeStat;
  if (beforeKind === "file") {
    const before = await readPinnedFile(file, {
      label: `managed target ${JSON.stringify(path.basename(file))}`,
      maxBytes: 256 * 1024 * 1024
    });
    if (before.bytes.equals(bytes) && Number(before.stat.mode & 0o777n) === mode) return false;
    beforeStat = before.stat;
  } else if (beforeKind !== "missing") {
    fail(`managed target ${JSON.stringify(path.basename(file))} is ${beforeKind}`);
  }
  const temporary = path.join(
    parent,
    `.${path.basename(file)}.${process.pid}.${crypto.randomBytes(6).toString("hex")}.tmp`
  );
  let handle;
  try {
    handle = await fs.open(
      temporary,
      fsNative.constants.O_WRONLY | fsNative.constants.O_CREAT
        | fsNative.constants.O_EXCL | fsNative.constants.O_NOFOLLOW,
      mode
    );
    await handle.writeFile(bytes);
    await handle.sync();
    await handle.close();
    handle = undefined;
    if (beforeStat === undefined) {
      if (await pathKind(file) !== "missing") fail("managed target appeared before publication");
    } else {
      const current = await fs.lstat(file, { bigint: true });
      if (current.isSymbolicLink() || !current.isFile() || !samePinnedStat(beforeStat, current)) {
        fail("managed target changed before publication");
      }
    }
    await fs.rename(temporary, file);
    await syncDirectory(parent);
    return true;
  } finally {
    if (handle !== undefined) await handle.close().catch(() => {});
    await fs.rm(temporary, { force: true }).catch(() => {});
  }
}

async function installExtension(stageDir, chatName, pluginEntryName, schemaName, sourceSnapshot) {
  const distDir = path.join(stageDir, "dist");
  const extensionsDir = path.join(distDir, "extensions");
  const extensionDir = path.join(extensionsDir, "vimicate-history-family");
  if (await pathKind(distDir) !== "directory") fail("staged dist directory is not fixed");
  if (await pathKind(extensionsDir) === "missing") await fs.mkdir(extensionsDir, { mode: 0o755 });
  else if (await pathKind(extensionsDir) !== "directory") fail("staged extensions directory is not fixed");
  if (await pathKind(extensionDir) === "missing") await fs.mkdir(extensionDir, { mode: 0o755 });
  else if (await pathKind(extensionDir) !== "directory") fail("staged extension target is not fixed");
  for (const name of sourceModules) {
    const source = sourceSnapshot.files.get(name);
    if (source === undefined) fail(`installer source snapshot omitted ${JSON.stringify(name)}`);
    await writeManagedFile(path.join(extensionDir, name), source.bytes, source.mode);
  }
  const index = `import { t as definePluginEntry } from "../../${pluginEntryName}";
import { Gn as errorShape, Wn as ErrorCodes } from "../../${schemaName}";
import {
  vimicateHistoryFamilyProjectorProbe,
  vimicateReadArchivedHistoryPage
} from "../../${chatName}";
import { registerVimicateHistoryFamilyPlugin } from
  "./vimicate-history-family-plugin-runtime.mjs";
import { registerVimicateNarrationPlugin } from
  "./vimicate-narration-plugin-runtime.mjs";

export default definePluginEntry({
  id: "vimicate-history-family",
  name: "Vimicate history transport",
  description: "Audited archived lineage and shared narration transport for Vimicate",
  configSchema: { parse: () => ({}), jsonSchema: { type: "object", additionalProperties: false } },
  register(api) {
    if (typeof api?.registerGatewayMethod !== "function"
        || typeof api?.registerService !== "function"
        || typeof api?.on !== "function"
        || typeof api?.runtime?.state?.resolveStateDir !== "function"
        || typeof api?.agent?.events?.registerAgentEventSubscription !== "function") {
      throw new Error("Vimicate history transport requires the complete OpenClaw plugin API");
    }
    registerVimicateHistoryFamilyPlugin(api, {
      projector: {
        probe: async () => vimicateHistoryFamilyProjectorProbe(),
        readPage: async (request, { signal } = {}) => {
          if (signal?.aborted) throw signal.reason ?? new Error("history-family read aborted");
          const result = await vimicateReadArchivedHistoryPage({
            ...request,
            cfg: api.runtime.config.current()
          });
          if (signal?.aborted) throw signal.reason ?? new Error("history-family read aborted");
          return result;
        }
      },
      formatError: (message) => errorShape(ErrorCodes.INVALID_REQUEST, message)
    });
    registerVimicateNarrationPlugin(api, {
      formatError: (message) => errorShape(ErrorCodes.INVALID_REQUEST, message)
    });
  }
});
`;
  await writeManagedFile(path.join(extensionDir, "index.js"), index);
  await writeManagedFile(path.join(extensionDir, "package.json"), `${JSON.stringify({
    name: "@openclaw/vimicate-history-family",
    version: "1.1.0",
    private: true,
    type: "module",
    peerDependencies: { openclaw: "2026.7.1 || 2026.7.1-2" },
    openclaw: { extensions: ["./index.js"] }
  }, null, 2)}\n`);
  await writeManagedFile(path.join(extensionDir, "openclaw.plugin.json"), `${JSON.stringify({
    id: "vimicate-history-family",
    name: "Vimicate history transport",
    description: "Audited archived session lineage and shared narration for Vimicate",
    enabledByDefault: true,
    activation: { onStartup: true },
    configSchema: { type: "object", additionalProperties: false, properties: {} }
  }, null, 2)}\n`);
  return extensionDir;
}

function runNode(args, cwd) {
  childProcess.execFileSync(process.execPath, args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });
}

async function sha256(file) {
  const { bytes } = await readPinnedFile(file, {
    label: `managed file ${JSON.stringify(file)}`,
    maxBytes: 256 * 1024 * 1024
  });
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

async function managedManifest(root, relativeFiles, { allowMissing = false } = {}) {
  const files = {};
  for (const relative of [...relativeFiles].sort()) {
    const file = path.join(root, relative);
    const kind = await pathKind(file);
    if (kind === "missing" && allowMissing) files[relative] = null;
    else if (kind === "file") files[relative] = await sha256(file);
    else fail(`managed manifest target ${JSON.stringify(relative)} is ${kind}`);
  }
  return files;
}

async function pathKind(file) {
  const stat = await fs.lstat(file).catch((error) => {
    if (error?.code === "ENOENT") return null;
    throw error;
  });
  if (stat === null) return "missing";
  if (stat.isSymbolicLink()) return "symlink";
  if (stat.isDirectory()) return "directory";
  if (stat.isFile()) return "file";
  return "special";
}

function samePinnedStat(first, second) {
  return first.dev === second.dev
    && first.ino === second.ino
    && first.size === second.size
    && first.mtimeNs === second.mtimeNs
    && first.ctimeNs === second.ctimeNs;
}

async function readPinnedFile(file, { label = "file", maxBytes = Number.MAX_SAFE_INTEGER } = {}) {
  let handle;
  try {
    handle = await fs.open(file, fsNative.constants.O_RDONLY | fsNative.constants.O_NOFOLLOW);
    const before = await handle.stat({ bigint: true });
    if (!before.isFile() || before.size < 0n || before.size > BigInt(maxBytes)) {
      fail(`${label} is not a bounded regular file`);
    }
    const bytes = await handle.readFile();
    const after = await handle.stat({ bigint: true });
    const fixed = await fs.lstat(file, { bigint: true });
    if (fixed.isSymbolicLink() || !fixed.isFile()
        || !samePinnedStat(before, after) || !samePinnedStat(after, fixed)
        || BigInt(bytes.length) !== after.size) {
      fail(`${label} changed while it was being read`);
    }
    return { bytes, stat: after };
  } catch (error) {
    if (error?.code === "ELOOP") fail(`${label} is a symbolic link`);
    throw error;
  } finally {
    if (handle !== undefined) await handle.close().catch(() => {});
  }
}

function resolveInstallerSourceDirectory(packageDir) {
  const override = process.env.VIMICATE_INSTALLER_TEST_SOURCE_DIR;
  if (override === undefined) return sourceDir;
  if (!testHookAllowed(packageDir)) fail("installer source override is not confined to a fixture");
  const resolved = fsNative.realpathSync(override);
  const testRoot = fsNative.realpathSync(process.env.VIMICATE_INSTALLER_TEST_ROOT);
  const relative = path.relative(testRoot, resolved);
  if (relative === "" || relative === ".." || relative.startsWith(`..${path.sep}`)
      || path.isAbsolute(relative)) {
    fail("installer source override escapes its fixture root");
  }
  return resolved;
}

async function captureInstallerSourceSnapshot(packageDir) {
  const directory = resolveInstallerSourceDirectory(packageDir);
  const before = await fs.lstat(directory, { bigint: true });
  if (!before.isDirectory() || before.isSymbolicLink()) fail("installer source directory is not fixed");
  const files = new Map();
  const generation = crypto.createHash("sha256");
  for (const name of [...sourceModules].sort()) {
    const pinned = await readPinnedFile(path.join(directory, name), {
      label: `installer source ${JSON.stringify(name)}`,
      maxBytes: 256 * 1024 * 1024
    });
    const mode = Number(pinned.stat.mode & 0o777n);
    files.set(name, { bytes: pinned.bytes, mode, stat: pinned.stat });
    generation.update(`${name}\0${mode}\0${pinned.stat.size}\0`);
    generation.update(pinned.bytes);
    generation.update("\n");
  }
  const after = await fs.lstat(directory, { bigint: true });
  if (!after.isDirectory() || after.isSymbolicLink() || !samePinnedStat(before, after)) {
    fail("installer source directory changed during snapshot");
  }
  return { directory, directoryStat: after, files, generation: generation.digest("hex") };
}

async function verifyInstallerSourceSnapshot(snapshot) {
  const before = await fs.lstat(snapshot.directory, { bigint: true });
  if (!before.isDirectory() || before.isSymbolicLink()
      || !samePinnedStat(snapshot.directoryStat, before)) {
    fail("installer source directory identity changed");
  }
  const generation = crypto.createHash("sha256");
  for (const name of [...sourceModules].sort()) {
    const expected = snapshot.files.get(name);
    if (expected === undefined) fail(`installer source snapshot omitted ${JSON.stringify(name)}`);
    const current = await readPinnedFile(path.join(snapshot.directory, name), {
      label: `installer source ${JSON.stringify(name)}`,
      maxBytes: 256 * 1024 * 1024
    });
    const mode = Number(current.stat.mode & 0o777n);
    if (!samePinnedStat(expected.stat, current.stat) || !expected.bytes.equals(current.bytes)) {
      fail(`installer source ${JSON.stringify(name)} changed after snapshot`);
    }
    generation.update(`${name}\0${mode}\0${current.stat.size}\0`);
    generation.update(current.bytes);
    generation.update("\n");
  }
  const after = await fs.lstat(snapshot.directory, { bigint: true });
  if (!after.isDirectory() || after.isSymbolicLink()
      || !samePinnedStat(snapshot.directoryStat, after)
      || generation.digest("hex") !== snapshot.generation) {
    fail("installer source snapshot no longer matches");
  }
}

async function syncFile(file) {
  const handle = await fs.open(file, fsNative.constants.O_RDONLY | fsNative.constants.O_NOFOLLOW);
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function syncDirectory(directoryPath) {
  const handle = await fs.open(directoryPath, fsNative.constants.O_RDONLY);
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function syncTree(root) {
  const kind = await pathKind(root);
  if (kind !== "directory") fail(`staged package root is ${kind}`);
  async function visit(directoryPath) {
    for (const name of (await fs.readdir(directoryPath)).sort()) {
      const file = path.join(directoryPath, name);
      const entryKind = await pathKind(file);
      if (entryKind === "directory") await visit(file);
      else if (entryKind === "file") await syncFile(file);
      else if (entryKind === "symlink") {
        // The installed npm package legitimately contains relative command
        // shims under node_modules/.bin. Never follow or fsync them; syncing
        // their containing directory durably records the link entry.
      }
      else fail(`staged package contains unsupported ${entryKind} entry ${JSON.stringify(path.relative(root, file))}`);
    }
    await syncDirectory(directoryPath);
  }
  await visit(root);
}

async function packageGeneration(root) {
  const hash = crypto.createHash("sha256");
  async function visit(directoryPath) {
    const before = await fs.lstat(directoryPath, { bigint: true });
    if (!before.isDirectory() || before.isSymbolicLink()) {
      fail(`package directory changed while hashing ${JSON.stringify(path.relative(root, directoryPath))}`);
    }
    const names = (await fs.readdir(directoryPath)).sort();
    for (const name of names) {
      const file = path.join(directoryPath, name);
      const relative = path.relative(root, file);
      const stat = await fs.lstat(file, { bigint: true });
      if (stat.isSymbolicLink()) {
        // Hash a symlink as an inert directory entry. This permits normal npm
        // .bin shims without traversing them, while the managed bundle and
        // extension paths retain their stricter no-symlink checks.
        const target = await fs.readlink(file, { encoding: "buffer" });
        const after = await fs.lstat(file, { bigint: true });
        if (!after.isSymbolicLink() || !samePinnedStat(stat, after)) {
          fail(`package symbolic link changed while hashing ${JSON.stringify(relative)}`);
        }
        hash.update(`l\0${relative}\0${Number(stat.mode & 0o777n)}\0${target.length}\0`);
        hash.update(target);
        hash.update("\n");
        continue;
      }
      if (stat.isDirectory()) {
        hash.update(`d\0${relative}\0${Number(stat.mode & 0o777n)}\n`);
        await visit(file);
      } else if (stat.isFile()) {
        const pinned = await readPinnedFile(file, {
          label: `package file ${JSON.stringify(relative)}`,
          maxBytes: 1024 * 1024 * 1024
        });
        hash.update(`f\0${relative}\0${Number(pinned.stat.mode & 0o777n)}\0${pinned.stat.size}\0`);
        hash.update(pinned.bytes);
        hash.update("\n");
      } else {
        fail(`package contains unsupported entry ${JSON.stringify(relative)}`);
      }
    }
    const after = await fs.lstat(directoryPath, { bigint: true });
    if (!after.isDirectory() || after.isSymbolicLink() || !samePinnedStat(before, after)) {
      fail(`package directory changed while hashing ${JSON.stringify(path.relative(root, directoryPath))}`);
    }
  }
  const rootStat = await fs.lstat(root);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) fail("package directory is not fixed");
  hash.update(`root\0${rootStat.mode & 0o777}\n`);
  await visit(root);
  return hash.digest("hex");
}

async function directoryIdentity(directoryPath, label) {
  const stat = await fs.lstat(directoryPath, { bigint: true });
  if (!stat.isDirectory() || stat.isSymbolicLink()) fail(`${label} is not a fixed directory`);
  return { dev: stat.dev, ino: stat.ino };
}

function sameDirectoryIdentity(first, second) {
  return first.dev === second.dev && first.ino === second.ino;
}

function withoutVimicateManagedBlocks(text) {
  return text.replace(
    /\/\/ BEGIN vimicate-history-family (?:projector|capability)-v\d+\n[\s\S]*?\/\/ END vimicate-history-family (?:projector|capability)-v\d+\n?/g,
    ""
  );
}

async function detectNativeHistoryFamily(packageDir, expectedIdentity) {
  if (!sameDirectoryIdentity(expectedIdentity, await directoryIdentity(packageDir, "package directory"))) {
    fail("package directory identity changed before native support validation");
  }
  const distDir = path.join(packageDir, "dist");
  if (await pathKind(distDir) !== "directory") fail("dist directory is not fixed");
  for (const name of (await fs.readdir(distDir)).sort()) {
    if (!name.endsWith(".js")) continue;
    const file = path.join(distDir, name);
    const kind = await pathKind(file);
    if (kind === "symlink") fail(`refusing symbolic-link bundle ${JSON.stringify(name)}`);
    if (kind !== "file") continue;
    const text = withoutVimicateManagedBlocks((await readPinnedFile(file, {
      label: `bundle ${JSON.stringify(name)}`,
      maxBytes: 256 * 1024 * 1024
    })).bytes.toString("utf8"));
    if (text.includes(HISTORY_METHOD) || text.includes("archivedSessionFamily")
        || text.includes("vimicate.narration.page")
        || text.includes("sharedNarration")) {
      fail(`OpenClaw already exposes native Vimicate history support in ${JSON.stringify(name)}`);
    }
  }
  if (!sameDirectoryIdentity(expectedIdentity, await directoryIdentity(packageDir, "package directory"))) {
    fail("package directory identity changed during native support validation");
  }
}

async function validateSupportedPackage(target, expectedIdentity) {
  await detectNativeHistoryFamily(target.packageDir, expectedIdentity);
  if (!SUPPORTED_OPENCLAW_VERSIONS.has(target.version)) {
    fail(`unsupported OpenClaw version ${JSON.stringify(target.version)}`);
  }
}

async function atomicWriteJson(file, value) {
  const parent = path.dirname(file);
  const temporary = path.join(parent, `.${path.basename(file)}.${process.pid}.${crypto.randomBytes(4).toString("hex")}.tmp`);
  const text = `${JSON.stringify(value, null, 2)}\n`;
  let handle;
  try {
    handle = await fs.open(
      temporary,
      fsNative.constants.O_WRONLY | fsNative.constants.O_CREAT | fsNative.constants.O_EXCL | fsNative.constants.O_NOFOLLOW,
      0o600
    );
    await handle.writeFile(text, "utf8");
    await handle.sync();
    await handle.close();
    handle = undefined;
    await fs.rename(temporary, file);
    await syncDirectory(parent);
  } finally {
    if (handle !== undefined) await handle.close().catch(() => {});
    await fs.rm(temporary, { force: true }).catch(() => {});
  }
}

async function readFixedJson(file, label) {
  const { bytes, stat } = await readPinnedFile(file, { label, maxBytes: 64 * 1024 });
  if (Number(stat.mode & 0o777n) !== 0o600 || stat.size < 2n) {
    fail(`${label} metadata is not fixed`);
  }
  return JSON.parse(bytes.toString("utf8"));
}

async function ensureAdvisoryLockFile(lock) {
  const kind = await pathKind(lock);
  if (kind === "missing") {
    let handle;
    try {
      handle = await fs.open(
        lock,
        fsNative.constants.O_WRONLY | fsNative.constants.O_CREAT
          | fsNative.constants.O_EXCL | fsNative.constants.O_NOFOLLOW,
        0o600
      );
      await handle.sync();
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
    } finally {
      if (handle !== undefined) await handle.close().catch(() => {});
    }
    await syncDirectory(path.dirname(lock));
  }
  const stat = await fs.lstat(lock);
  if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o777) !== 0o600) {
    fail("installer advisory lock file is not fixed");
  }
}

async function delegateUnderAdvisoryLock(lock) {
  await ensureAdvisoryLockFile(lock);
  const result = childProcess.spawnSync(
    "/usr/bin/lockf",
    [
      "-t",
      "0",
      "-k",
      lock,
      process.execPath,
      fileURLToPath(import.meta.url),
      ...process.argv.slice(2)
    ],
    {
      encoding: "utf8",
      env: { ...process.env, VIMICATE_INSTALLER_ADVISORY_LOCK: lock },
      stdio: ["ignore", "pipe", "pipe"]
    }
  );
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.error) throw result.error;
  if (result.status === 0) return;
  if (result.status === 75) fail("another installer holds the advisory lock");
  process.exitCode = result.status ?? 1;
}

function requireAdvisoryLockParent() {
  const command = childProcess.execFileSync(
    "/bin/ps",
    ["-p", String(process.ppid), "-o", "comm="],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }
  ).trim();
  if (path.basename(command) !== "lockf") {
    fail("advisory lock marker is not owned by lockf");
  }
}

function refreshPersistedPluginRegistry(packageDir) {
  const cli = path.join(packageDir, "openclaw.mjs");
  const result = childProcess.spawnSync(
    process.execPath,
    [cli, "plugins", "registry", "--refresh", "--json"],
    {
      encoding: "utf8",
      env: process.env,
      maxBuffer: 32 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"]
    }
  );
  if (result.error) throw result.error;
  if (result.status !== 0) {
    fail("persisted plugin registry refresh failed");
  }
  let response;
  try {
    response = JSON.parse(result.stdout);
  } catch {
    fail("persisted plugin registry refresh returned invalid JSON");
  }
  if (response?.refreshed !== true
      || !Array.isArray(response?.registry?.plugins)
      || !response.registry.plugins.some(
        (plugin) => plugin?.pluginId === "vimicate-history-family"
      )) {
    fail("persisted plugin registry did not discover vimicate-history-family");
  }
  return {
    contract: "openclaw-persisted-plugin-registry-v1",
    refreshed: true,
    pluginId: "vimicate-history-family"
  };
}

function validateTransactionPath(candidate, parent, prefix, label) {
  if (typeof candidate !== "string" || path.dirname(candidate) !== parent
      || !path.basename(candidate).startsWith(prefix)) {
    fail(`transaction ${label} path is invalid`);
  }
}

async function clearJournal(journal) {
  await fs.rm(journal, { force: true });
  await syncDirectory(path.dirname(journal));
}

async function recoverTransaction({ journal, target, parent, base }) {
  if (await pathKind(journal) === "missing") return false;
  const value = await readFixedJson(journal, "installer transaction journal");
  if (value?.schemaVersion !== TRANSACTION_SCHEMA_VERSION || value?.packageDir !== target) {
    fail("transaction journal authority is invalid");
  }
  if (!/^[0-9a-f]{64}$/.test(value?.sourceGeneration ?? "")
      || !/^[0-9a-f]{64}$/.test(value?.stageGeneration ?? "")) {
    fail("transaction journal generation is invalid");
  }
  validateTransactionPath(value.stage, parent, `.${base}.vimicate-stage-`, "stage");
  validateTransactionPath(value.backup, parent, `.${base}.vimicate-backup-`, "backup");
  const targetKind = await pathKind(target);
  const stageKind = await pathKind(value.stage);
  const backupKind = await pathKind(value.backup);
  for (const [label, kind] of [["target", targetKind], ["stage", stageKind], ["backup", backupKind]]) {
    if (!new Set(["missing", "directory"]).has(kind)) fail(`transaction ${label} is ${kind}`);
  }
  if (targetKind === "directory" && backupKind === "directory" && stageKind === "missing") {
    const targetGeneration = await packageGeneration(target);
    const backupGeneration = await packageGeneration(value.backup);
    await clearJournal(journal);
    if (targetGeneration !== value.stageGeneration
        || backupGeneration !== value.sourceGeneration) {
      fail("concurrently changed installed transaction was preserved; installation aborted");
    }
    return true;
  }
  if (targetKind === "missing" && backupKind === "directory") {
    const backupGeneration = await packageGeneration(value.backup);
    await fs.rename(value.backup, target);
    await syncDirectory(parent);
    if (stageKind === "directory") {
      await fs.rm(value.stage, { recursive: true });
      await syncDirectory(parent);
    }
    await clearJournal(journal);
    if (backupGeneration !== value.sourceGeneration) {
      fail("concurrently changed backup was restored; installation aborted");
    }
    return true;
  }
  if (targetKind === "directory" && backupKind === "missing") {
    const targetGeneration = await packageGeneration(target);
    if (stageKind === "directory") {
      await fs.rm(value.stage, { recursive: true });
      await syncDirectory(parent);
    }
    await clearJournal(journal);
    if (targetGeneration !== value.sourceGeneration) {
      fail("concurrently changed target was preserved; installation aborted");
    }
    return true;
  }
  fail(`cannot safely recover transaction (${targetKind}/${stageKind}/${backupKind})`);
}

async function requireInstalledProduct({
  target,
  backup,
  journal,
  parent,
  expectedIdentity,
  expectedGeneration
}) {
  const kind = await pathKind(target);
  if (kind === "directory") {
    let matches = false;
    try {
      matches = sameDirectoryIdentity(
        expectedIdentity,
        await directoryIdentity(target, "installed package")
      ) && await packageGeneration(target) === expectedGeneration;
    } catch {
      matches = false;
    }
    if (matches) return;
    await clearJournal(journal);
    fail("installed package changed before acceptance; concurrent package was preserved");
  }
  if (kind === "missing" && await pathKind(backup) === "directory") {
    await packageGeneration(backup);
    await fs.rename(backup, target);
    await syncDirectory(parent);
    await clearJournal(journal);
    fail("installed package disappeared before acceptance; backup was restored");
  }
  fail(`installed package became ${kind} before acceptance`);
}

function testHookAllowed(packageDir) {
  const root = process.env.VIMICATE_INSTALLER_TEST_ROOT;
  if (root === undefined) return false;
  const relative = path.relative(fsNative.realpathSync(root), packageDir);
  return relative !== "" && !relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative);
}

function maybeCrash(packageDir, point) {
  if (process.env.VIMICATE_INSTALLER_TEST_CRASH_AT !== point) return;
  if (!testHookAllowed(packageDir)) fail("test crash hook is not confined to its fixture root");
  process.kill(process.pid, "SIGKILL");
}

async function maybePause(packageDir, point) {
  const control = process.env.VIMICATE_INSTALLER_TEST_CONTROL;
  if (control === undefined || process.env.VIMICATE_INSTALLER_TEST_PAUSE_AT !== point) return;
  if (!testHookAllowed(packageDir)) fail("test pause hook is not confined to its fixture root");
  const controlPath = path.resolve(control);
  const resolved = path.join(
    fsNative.realpathSync(path.dirname(controlPath)),
    path.basename(controlPath)
  );
  const testRoot = fsNative.realpathSync(process.env.VIMICATE_INSTALLER_TEST_ROOT);
  const relative = path.relative(testRoot, resolved);
  if (relative.startsWith(`..${path.sep}`) || relative === ".." || path.isAbsolute(relative)) {
    fail("test control path escapes its fixture root");
  }
  await fs.writeFile(`${resolved}.ready`, `${process.pid}\n`, { flag: "wx" });
  const deadline = Date.now() + 10_000;
  while (await pathKind(`${resolved}.continue`) === "missing") {
    if (Date.now() > deadline) fail("test pause timed out");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

async function patchStage(stageDir, sourceSnapshot) {
  const distDir = path.join(stageDir, "dist");
  const chat = await uniqueBundle(
    distDir,
    (_name, text) => text.includes("async function readChatHistoryPage(params)")
      && text.includes("const chatHandlers ="),
    "canonical chat implementation"
  );
  const registry = await uniqueBundle(
    distDir,
    (name, text) => name.startsWith("server-methods-")
      && text.includes("async function vimicateRegistryReadHandler"),
    "Vimicate registry server-methods"
  );
  const sessionUtils = await uniqueBundle(
    distDir,
    (name, text) => name.startsWith("session-utils.fs-")
      && text.includes("async function readRecentSessionMessagesWithStatsAsync(")
      && text.includes("async function readSessionMessagesPageWithStatsAsync("),
    "canonical session transcript readers"
  );
  const pluginEntry = await uniqueBundle(
    distDir,
    (name, text) => name.startsWith("plugin-entry-")
      && text.includes("function definePluginEntry"),
    "plugin entry"
  );
  const sessionReset = await uniqueBundle(
    distDir,
    (name, text) => name.startsWith("session-reset-service-")
      && text.includes("const nextSessionId = randomUUID();")
      && text.includes("const nextEntry = {"),
    "canonical session reset"
  );
  const schemaMatch = /from "\.\/(schema-[^"]+\.js)";/.exec(chat.text);
  if (!schemaMatch) fail("chat bundle schema import changed");
  await writeManagedFile(chat.file, patchChat(chat));
  await writeManagedFile(sessionUtils.file, patchSessionUtils(sessionUtils));
  await writeManagedFile(registry.file, patchRegistry(registry));
  await writeManagedFile(sessionReset.file, patchSessionResetEpoch(sessionReset.text));
  const extensionDir = await installExtension(
    stageDir,
    chat.name,
    pluginEntry.name,
    schemaMatch[1],
    sourceSnapshot
  );
  const managed = [
    path.relative(stageDir, chat.file),
    path.relative(stageDir, sessionUtils.file),
    path.relative(stageDir, registry.file),
    path.relative(stageDir, sessionReset.file),
    ...sourceModules.map((name) => path.relative(stageDir, path.join(extensionDir, name))),
    path.relative(stageDir, path.join(extensionDir, "index.js")),
    path.relative(stageDir, path.join(extensionDir, "package.json")),
    path.relative(stageDir, path.join(extensionDir, "openclaw.plugin.json"))
  ];
  for (const relative of managed.filter((name) => /\.(?:js|mjs)$/.test(name))) {
    runNode(["--check", path.join(stageDir, relative)], stageDir);
  }
  runNode([
    "--input-type=module",
    "--eval",
    `import(${JSON.stringify(path.join(extensionDir, "index.js"))}).then((m) => { if (!m.default) process.exit(2); })`
  ], stageDir);
  return {
    managed,
    chat: chat.name,
    sessionUtils: sessionUtils.name,
    sessionReset: sessionReset.name,
    registry: registry.name
  };
}

async function main() {
  const args = parseArguments(process.argv.slice(2));
  // Resolve ancestor symlinks once before the first lock or journal write and
  // use that immutable lexical authority for the entire transaction. An
  // alias redirected after this point cannot retarget the installer at the
  // live global package.
  const requestedPackageDir = await canonicalPackageAuthorityPath(
    path.resolve(args.packageDir)
  );
  const isLivePackage = isInstalledPackagePath(requestedPackageDir);
  if (isLivePackage && !args.applyLive) {
    fail("refusing the live OpenClaw package without --apply-live");
  }
  const parent = path.dirname(requestedPackageDir);
  const base = path.basename(requestedPackageDir);
  const advisoryLock = path.join(parent, `.${base}.vimicate-install.lock`);
  if (process.env.VIMICATE_INSTALLER_ADVISORY_LOCK !== advisoryLock) {
    await delegateUnderAdvisoryLock(advisoryLock);
    return;
  }
  requireAdvisoryLockParent();
  const nonce = `${process.pid}-${crypto.randomBytes(6).toString("hex")}`;
  const stage = path.join(parent, `.${base}.vimicate-stage-${nonce}`);
  const backup = path.join(
    parent,
    `.${base}.vimicate-backup-${new Date().toISOString().replace(/[:.]/g, "-")}-${nonce}`
  );
  const journal = path.join(parent, `.${base}.vimicate-install-transaction.json`);
  let transactionStarted = false;
  try {
    await recoverTransaction({
      journal,
      target: requestedPackageDir,
      parent,
      base
    });
    const sourceIdentity = await directoryIdentity(requestedPackageDir, "source package");
    const sourceGeneration = await packageGeneration(requestedPackageDir);
    await maybePause(
      requestedPackageDir,
      "after-initial-generation-before-validation"
    );
    const target = await requirePackageDirectory(
      requestedPackageDir,
      args.applyLive,
      sourceIdentity
    );
    await validateSupportedPackage(target, sourceIdentity);
    if (!sameDirectoryIdentity(
      sourceIdentity,
      await directoryIdentity(target.packageDir, "source package")
    ) || await packageGeneration(target.packageDir) !== sourceGeneration) {
      fail("package changed during version and native-support validation");
    }
    const installerSource = await captureInstallerSourceSnapshot(target.packageDir);
    await maybePause(target.packageDir, "after-package-authority");
    if (!sameDirectoryIdentity(
      sourceIdentity,
      await directoryIdentity(target.packageDir, "source package")
    ) || await packageGeneration(target.packageDir) !== sourceGeneration) {
      fail("package authority changed before staging");
    }
    await fs.cp(target.packageDir, stage, {
      recursive: true,
      preserveTimestamps: true,
      verbatimSymlinks: true
    });
    if (await packageGeneration(stage) !== sourceGeneration) {
      fail("staged package copy does not match the bound source generation");
    }
    if (!sameDirectoryIdentity(
      sourceIdentity,
      await directoryIdentity(target.packageDir, "source package")
    ) || await packageGeneration(target.packageDir) !== sourceGeneration) {
      fail("package authority changed while staging");
    }
    await maybePause(target.packageDir, "after-stage-copy-before-patch");
    const patched = await patchStage(stage, installerSource);
    const before = await managedManifest(target.packageDir, patched.managed, { allowMissing: true });
    const after = await managedManifest(stage, patched.managed);
    const changed = JSON.stringify(before) !== JSON.stringify(after);
    const manifest = {
      contract: "vimicate-history-family-installer-v1",
      openClawVersion: target.version,
      packageDir: target.packageDir,
      chatBundle: patched.chat,
      sessionUtilsBundle: patched.sessionUtils,
      sessionResetBundle: patched.sessionReset,
      registryBundle: patched.registry,
      changed,
      sourceGeneration,
      installerSourceGeneration: installerSource.generation,
      files: after
    };
    await verifyInstallerSourceSnapshot(installerSource);
    if (!changed || args.dryRun) {
      const pluginRegistry = isLivePackage && args.applyLive && !args.dryRun
        ? refreshPersistedPluginRegistry(target.packageDir)
        : {
            contract: "openclaw-persisted-plugin-registry-v1",
            refreshed: false,
            requiredAfterApply: isLivePackage && args.dryRun
          };
      process.stdout.write(`${JSON.stringify({
        ...manifest,
        applied: false,
        pluginRegistry,
        gatewayRestartRequired: isLivePackage && args.applyLive && !args.dryRun
      }, null, 2)}\n`);
      return;
    }
    await syncTree(stage);
    const stageGeneration = await packageGeneration(stage);
    const stageIdentity = await directoryIdentity(stage, "staged package");
    await maybePause(target.packageDir, "before-source-revalidation");
    await verifyInstallerSourceSnapshot(installerSource);
    const currentGeneration = await packageGeneration(target.packageDir);
    if (currentGeneration !== sourceGeneration) {
      fail("OpenClaw package changed while the staged installer was validating");
    }
    const identityBeforeJournal = await directoryIdentity(target.packageDir, "source package");
    if (!sameDirectoryIdentity(sourceIdentity, identityBeforeJournal)) {
      fail("package directory changed identity before commit");
    }
    const transaction = {
      schemaVersion: TRANSACTION_SCHEMA_VERSION,
      state: "prepared",
      packageDir: target.packageDir,
      stage,
      backup,
      sourceGeneration,
      stageGeneration,
      nonce
    };
    await atomicWriteJson(journal, transaction);
    transactionStarted = true;
    maybeCrash(target.packageDir, "after-journal-prepared");
    await verifyInstallerSourceSnapshot(installerSource);
    const finalGeneration = await packageGeneration(target.packageDir);
    const finalIdentity = await directoryIdentity(target.packageDir, "source package");
    if (finalGeneration !== sourceGeneration
        || !sameDirectoryIdentity(sourceIdentity, finalIdentity)) {
      fail("OpenClaw package changed after transaction preparation");
    }
    await fs.rename(target.packageDir, backup);
    await syncDirectory(parent);
    await maybePause(target.packageDir, "after-target-move-before-backup-validation");
    const movedGeneration = await packageGeneration(backup);
    if (movedGeneration !== sourceGeneration) {
      if (await pathKind(target.packageDir) !== "missing") {
        fail("concurrent target appeared while changed backup awaited restoration");
      }
      await fs.rename(backup, target.packageDir);
      await syncDirectory(parent);
      await clearJournal(journal);
      transactionStarted = false;
      fail("OpenClaw package changed at commit boundary; changed package was restored");
    }
    await atomicWriteJson(journal, { ...transaction, state: "target-moved" });
    maybeCrash(target.packageDir, "after-target-move");
    if (!sameDirectoryIdentity(stageIdentity, await directoryIdentity(stage, "staged package"))
        || await packageGeneration(stage) !== stageGeneration) {
      fail("staged package changed before installation");
    }
    await fs.rename(stage, target.packageDir);
    await syncDirectory(parent);
    await maybePause(target.packageDir, "after-stage-install-before-validation");
    maybeCrash(target.packageDir, "after-stage-install");
    await requireInstalledProduct({
      target: target.packageDir,
      backup,
      journal,
      parent,
      expectedIdentity: stageIdentity,
      expectedGeneration: stageGeneration
    });
    await atomicWriteJson(journal, { ...transaction, state: "stage-installed" });
    await requireInstalledProduct({
      target: target.packageDir,
      backup,
      journal,
      parent,
      expectedIdentity: stageIdentity,
      expectedGeneration: stageGeneration
    });
    const pluginRegistry = isLivePackage
      ? refreshPersistedPluginRegistry(target.packageDir)
      : {
          contract: "openclaw-persisted-plugin-registry-v1",
          refreshed: false,
          requiredAfterApply: false
        };
    await clearJournal(journal);
    transactionStarted = false;
    await requireInstalledProduct({
      target: target.packageDir,
      backup,
      journal,
      parent,
      expectedIdentity: stageIdentity,
      expectedGeneration: stageGeneration
    });
    process.stdout.write(`${JSON.stringify({
      ...manifest,
      applied: true,
      backup,
      pluginRegistry,
      gatewayRestartRequired: isLivePackage
    }, null, 2)}\n`);
  } catch (error) {
    if (transactionStarted || await pathKind(journal) !== "missing") {
      await recoverTransaction({
        journal,
        target: requestedPackageDir,
        parent,
        base
      });
    }
    throw error;
  } finally {
    await fs.rm(stage, { recursive: true, force: true }).catch(() => {});
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exitCode = 1;
});
