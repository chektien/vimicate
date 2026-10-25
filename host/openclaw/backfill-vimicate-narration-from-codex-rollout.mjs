#!/usr/bin/env node

import fsNative from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  createVimicateNarrationRecordContract
} from "./vimicate-narration-record-contract.mjs";
import {
  createVimicateNarrationStateStore
} from "./vimicate-narration-plugin-runtime.mjs";

const MAXIMUM_SOURCE_BYTES = 256 * 1024 * 1024;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function fail(message) {
  throw new Error(`vimicate narration backfill: ${message}`);
}

function requiredValue(argv, index, argument) {
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) fail(`${argument} requires a value`);
  return value;
}

export function parseArguments(argv) {
  const result = { apply: false, dryRun: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--state-dir") {
      result.stateDir = requiredValue(argv, index, argument);
      index += 1;
    } else if (argument === "--vimicate-dir") {
      result.vimicateDir = requiredValue(argv, index, argument);
      index += 1;
    } else if (argument === "--stable-session-key") {
      result.stableSessionKey = requiredValue(argv, index, argument);
      index += 1;
    } else if (argument === "--session-id") {
      result.sessionId = requiredValue(argv, index, argument);
      index += 1;
    } else if (argument === "--run-id") {
      result.runId = requiredValue(argv, index, argument);
      index += 1;
    } else if (argument === "--turn-id") {
      result.turnId = requiredValue(argv, index, argument);
      index += 1;
    } else if (argument === "--rollout-file") {
      result.rolloutFile = requiredValue(argv, index, argument);
      index += 1;
    } else if (argument === "--dry-run") result.dryRun = true;
    else if (argument === "--apply") result.apply = true;
    else fail(`unknown argument ${JSON.stringify(argument)}`);
  }
  for (const name of [
    "stateDir",
    "vimicateDir",
    "stableSessionKey",
    "sessionId",
    "runId",
    "turnId",
    "rolloutFile"
  ]) {
    if (!result[name]) {
      fail(`--${name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)} is required`);
    }
  }
  if (result.apply === result.dryRun) {
    fail("choose exactly one of --dry-run or --apply");
  }
  if (!UUID_PATTERN.test(result.sessionId)) fail("session id is not a UUID");
  if (!UUID_PATTERN.test(result.runId)) fail("run id is not a UUID");
  if (!UUID_PATTERN.test(result.turnId)) fail("turn id is not a UUID");
  const keyMatch = result.stableSessionKey.match(/^agent:([A-Za-z0-9_-]+):.+$/);
  if (!keyMatch) fail("stable session key is invalid");
  result.agentId = keyMatch[1];
  return result;
}

async function requireFixedDirectory(directory, label, expectedMode) {
  const resolved = path.resolve(directory);
  const canonical = await fs.realpath(resolved);
  const stat = await fs.lstat(resolved);
  if (canonical !== resolved || !stat.isDirectory() || stat.isSymbolicLink()) {
    fail(`${label} is not a canonical fixed directory`);
  }
  if (expectedMode != null && (stat.mode & 0o777) !== expectedMode) {
    fail(`${label} must use mode ${expectedMode.toString(8)}`);
  }
  return resolved;
}

async function readNoFollow(file, label) {
  let handle;
  try {
    handle = await fs.open(
      file,
      fsNative.constants.O_RDONLY | fsNative.constants.O_NOFOLLOW
    );
    const before = await handle.stat({ bigint: true });
    if (!before.isFile()
        || before.isSymbolicLink()
        || before.size < 1n
        || before.size > BigInt(MAXIMUM_SOURCE_BYTES)) {
      fail(`${label} is not a bounded fixed file`);
    }
    const bytes = await handle.readFile();
    const after = await handle.stat({ bigint: true });
    if (before.dev !== after.dev
        || before.ino !== after.ino
        || before.size !== after.size
        || before.mtimeNs !== after.mtimeNs
        || before.ctimeNs !== after.ctimeNs) {
      fail(`${label} changed while it was read`);
    }
    return bytes.toString("utf8");
  } finally {
    await handle?.close();
  }
}

function jsonLines(text, label) {
  const result = [];
  for (const [index, line] of text.split("\n").entries()) {
    if (!line.trim()) continue;
    try {
      result.push({ lineNumber: index + 1, value: JSON.parse(line) });
    } catch {
      fail(`${label} line ${index + 1} is invalid JSON`);
    }
  }
  return result;
}

export function extractNarrationRecords(rolloutText, turnId) {
  const records = [];
  for (const { lineNumber, value } of jsonLines(rolloutText, "rollout")) {
    const payload = value?.payload;
    if (value?.type !== "response_item"
        || payload?.type !== "message"
        || payload?.phase !== "commentary"
        || payload?.internal_chat_message_metadata_passthrough?.turn_id
          !== turnId) {
      continue;
    }
    const text = Array.isArray(payload.content)
      ? payload.content
        .filter((entry) => entry?.type === "output_text")
        .map((entry) => entry.text)
        .join("")
        .trim()
      : "";
    const timestampMs = Date.parse(value.timestamp);
    if (typeof payload.id !== "string" || !payload.id.trim()) {
      fail(`rollout line ${lineNumber} has no narration item id`);
    }
    if (!text) fail(`rollout line ${lineNumber} has no narration text`);
    if (!Number.isSafeInteger(timestampMs) || timestampMs < 1) {
      fail(`rollout line ${lineNumber} has an invalid timestamp`);
    }
    records.push({
      itemId: payload.id.trim(),
      sequence: lineNumber,
      text,
      timestampMs
    });
  }
  if (records.length === 0) fail("rollout has no matching commentary records");
  return records;
}

export function verifyPromptBinding(sessionText, { runId, turnId }) {
  const matches = jsonLines(sessionText, "session transcript").filter(({ value }) =>
    value?.type === "message"
      && value?.message?.role === "user"
      && value.message.idempotencyKey === `${runId}:user`
      && value.message.__openclaw?.mirrorIdentity === `${turnId}:prompt`
      && value.message.__openclaw?.mirrorOrigin === "codex-app-server"
  );
  if (matches.length !== 1) {
    fail("run and Codex turn do not resolve to exactly one user prompt");
  }
}

async function readJsonNoFollow(file, label) {
  try {
    return JSON.parse(await readNoFollow(file, label));
  } catch (error) {
    if (String(error?.message ?? error).startsWith("vimicate narration backfill:")) {
      throw error;
    }
    fail(`${label} is invalid JSON`);
  }
}

export async function runBackfill(options) {
  const stateDirectory = await requireFixedDirectory(
    options.stateDir,
    "OpenClaw state directory"
  );
  const vimicateDirectory = await requireFixedDirectory(
    options.vimicateDir,
    "Vimicate directory",
    0o700
  );
  const sessionsDirectory = await requireFixedDirectory(
    path.join(stateDirectory, "agents", options.agentId, "sessions"),
    "OpenClaw sessions directory"
  );
  const sessionStore = await readJsonNoFollow(
    path.join(sessionsDirectory, "sessions.json"),
    "OpenClaw session store"
  );
  const authority = sessionStore?.[options.stableSessionKey];
  const sessionFile = path.resolve(authority?.sessionFile ?? "");
  if (authority?.sessionId !== options.sessionId
      || path.dirname(sessionFile) !== sessionsDirectory
      || path.basename(sessionFile) !== `${options.sessionId}.jsonl`) {
    fail("stable session authority disagrees with the requested session");
  }
  verifyPromptBinding(await readNoFollow(
    sessionFile,
    "OpenClaw session transcript"
  ), options);
  const records = extractNarrationRecords(
    await readNoFollow(path.resolve(options.rolloutFile), "Codex rollout"),
    options.turnId
  );
  const outcomes = [];
  if (options.apply) {
    const narrationStore = createVimicateNarrationStateStore({
      vimicateDir: vimicateDirectory
    });
    const contract = createVimicateNarrationRecordContract({
      readState: narrationStore.readState,
      commitState: narrationStore.commitState
    });
    for (const record of records) {
      outcomes.push(await contract.record({
        runId: options.runId,
        seq: record.sequence,
        ts: record.timestampMs,
        stream: "item",
        sessionKey: options.stableSessionKey,
        sessionId: options.sessionId,
        data: {
          itemId: record.itemId,
          kind: "preamble",
          source: "codex-app-server",
          phase: "update",
          progressText: record.text
        }
      }));
    }
  }
  return {
    action: options.apply ? "applied" : "dry-run",
    stableSessionKey: options.stableSessionKey,
    sessionId: options.sessionId,
    runId: options.runId,
    turnId: options.turnId,
    recordCount: records.length,
    firstTimestampMs: records[0].timestampMs,
    lastTimestampMs: records.at(-1).timestampMs,
    items: records.map((record) => ({
      itemId: record.itemId,
      timestampMs: record.timestampMs
    })),
    ...(options.apply ? { outcomes } : {})
  };
}

async function main() {
  const result = await runBackfill(parseArguments(process.argv.slice(2)));
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

if (process.argv[1]
    && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
