#!/usr/bin/env node

import fsNative from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_TRANSCRIPT_BYTES = 256 * 1024 * 1024;

function fail(message) {
  throw new Error(`Vimicate retired-thread recovery: ${message}`);
}

function parseArguments(argv) {
  const options = { apply: false, agentId: 'main' };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--') continue;
    if (argument === '--state-dir') options.stateDir = argv[++index];
    else if (argument === '--vimicate-dir') options.vimicateDir = argv[++index];
    else if (argument === '--stable-session-key') options.stableSessionKey = argv[++index];
    else if (argument === '--retired-session-file') options.retiredSessionFile = argv[++index];
    else if (argument === '--retired-session-id') options.retiredSessionId = argv[++index];
    else if (argument === '--current-session-id') options.currentSessionId = argv[++index];
    else if (argument === '--agent-id') options.agentId = argv[++index];
    else if (argument === '--session-accessor') options.sessionAccessor = argv[++index];
    else if (argument === '--bootstrap-script') options.bootstrapScript = argv[++index];
    else if (argument === '--apply') options.apply = true;
    else fail(`unknown argument ${JSON.stringify(argument)}`);
  }
  for (const key of [
    'stateDir',
    'vimicateDir',
    'stableSessionKey',
    'retiredSessionFile',
    'retiredSessionId',
    'currentSessionId',
    'sessionAccessor',
    'bootstrapScript',
  ]) {
    if (typeof options[key] !== 'string' || !options[key].trim()) fail(`--${camelToKebab(key)} is required`);
  }
  if (!UUID.test(options.retiredSessionId) || !UUID.test(options.currentSessionId)) fail('session ids must be UUIDs');
  if (options.retiredSessionId === options.currentSessionId) fail('retired and current session ids must differ');
  if (!options.stableSessionKey.startsWith(`agent:${options.agentId}:`)) fail('stable session key disagrees with agent id');
  return options;
}

function camelToKebab(value) {
  return value.replace(/[A-Z]/g, (character) => `-${character.toLowerCase()}`);
}

async function fixedDirectory(value, label, expectedMode) {
  const resolved = path.resolve(value);
  const stat = await fs.lstat(resolved);
  if (!stat.isDirectory() || stat.isSymbolicLink()) fail(`${label} is not a fixed directory`);
  if (expectedMode != null && (stat.mode & 0o777) !== expectedMode) fail(`${label} must use mode ${expectedMode.toString(8)}`);
  return resolved;
}

async function fixedFile(value, label, maximumBytes = MAX_TRANSCRIPT_BYTES) {
  const resolved = path.resolve(value);
  const stat = await fs.lstat(resolved);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size < 1 || stat.size > maximumBytes) {
    fail(`${label} is not a bounded fixed file`);
  }
  return resolved;
}

async function readNoFollow(value, label, maximumBytes = MAX_TRANSCRIPT_BYTES) {
  const handle = await fs.open(value, fsNative.constants.O_RDONLY | fsNative.constants.O_NOFOLLOW);
  try {
    const before = await handle.stat();
    if (!before.isFile() || before.size < 1 || before.size > maximumBytes) fail(`${label} is not bounded`);
    const bytes = await handle.readFile();
    const after = await handle.stat();
    if (before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size
        || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs) {
      fail(`${label} changed while it was read`);
    }
    return bytes;
  } finally {
    await handle.close();
  }
}

function transcriptHeader(bytes, expectedSessionId, label) {
  const newline = bytes.indexOf(0x0a);
  if (newline < 1 || newline > 256 * 1024) fail(`${label} has no bounded JSONL header`);
  let header;
  try {
    header = JSON.parse(bytes.subarray(0, newline).toString('utf8'));
  } catch {
    fail(`${label} header is not JSON`);
  }
  const startedAtMs = Date.parse(header?.timestamp);
  if (header?.type !== 'session' || header?.id !== expectedSessionId
      || !Number.isSafeInteger(startedAtMs) || startedAtMs < 1) {
    fail(`${label} header disagrees with declared authority`);
  }
  return { startedAtMs, timestamp: header.timestamp };
}

async function readSessionStore(storeFile, stableSessionKey, currentSessionId, currentSessionFile) {
  const value = JSON.parse((await readNoFollow(storeFile, 'OpenClaw session store', 64 * 1024 * 1024)).toString('utf8'));
  const entry = value?.[stableSessionKey];
  if (!entry || entry.sessionId !== currentSessionId || path.resolve(entry.sessionFile ?? '') !== currentSessionFile) {
    fail('current session store authority changed');
  }
  return entry;
}

async function establishCurrentEpoch(options, authority) {
  if (authority.sessionStartedAt != null) {
    if (authority.sessionStartedAt !== options.currentStartedAtMs) fail('existing current epoch disagrees with transcript header');
    return false;
  }
  const imported = await import(pathToFileURL(options.sessionAccessor).href);
  const patchSessionEntry = imported.patchSessionEntry ?? imported.C;
  if (typeof patchSessionEntry !== 'function') fail('OpenClaw session accessor does not export patchSessionEntry');
  const persisted = await patchSessionEntry({
    storePath: options.storeFile,
    sessionKey: options.stableSessionKey,
    agentId: options.agentId,
  }, (current) => {
    if (!current || current.sessionId !== options.currentSessionId
        || path.resolve(current.sessionFile ?? '') !== options.currentSessionFile) {
      fail('current session authority changed before epoch commit');
    }
    if (current.sessionStartedAt != null && current.sessionStartedAt !== options.currentStartedAtMs) {
      fail('current epoch changed before commit');
    }
    return current.sessionStartedAt == null ? { sessionStartedAt: options.currentStartedAtMs } : null;
  }, {
    preserveActivity: true,
    requireWriteSuccess: true,
    skipMaintenance: true,
    takeCacheOwnership: true,
  });
  if (persisted?.sessionStartedAt !== options.currentStartedAtMs) fail('OpenClaw did not persist the exact current epoch');
  return true;
}

async function atomicCreateOrVerify(file, bytes) {
  try {
    const handle = await fs.open(
      file,
      fsNative.constants.O_WRONLY | fsNative.constants.O_CREAT | fsNative.constants.O_EXCL,
      0o600,
    );
    try {
      await handle.writeFile(bytes);
      await handle.sync();
    } finally {
      await handle.close();
    }
    await fs.chmod(file, 0o600);
    return true;
  } catch (error) {
    if (error?.code !== 'EEXIST') throw error;
    const existing = await readNoFollow(file, 'existing canonical retired transcript');
    if (!existing.equals(bytes)) fail('existing canonical retired transcript differs from preserved source');
    return false;
  }
}

function runBootstrap(argumentsValue) {
  const result = spawnSync(process.execPath, argumentsValue, { encoding: 'utf8' });
  if (result.status !== 0) fail(`audited bootstrap rejected family: ${(result.stderr || result.stdout).trim()}`);
  return (result.stdout || '').trim();
}

async function main(argv) {
  const options = parseArguments(argv);
  options.stateDir = await fixedDirectory(options.stateDir, 'OpenClaw state directory');
  options.vimicateDir = await fixedDirectory(options.vimicateDir, 'Vimicate directory');
  options.sessionsDirectory = await fixedDirectory(
    path.join(options.stateDir, 'agents', options.agentId, 'sessions'),
    'OpenClaw sessions directory',
  );
  await fixedDirectory(path.join(options.vimicateDir, 'openclaw-history-family-owned'), 'owned transcript directory', 0o700);
  options.sessionAccessor = await fixedFile(options.sessionAccessor, 'OpenClaw session accessor', 16 * 1024 * 1024);
  options.bootstrapScript = await fixedFile(options.bootstrapScript, 'history-family bootstrap', 4 * 1024 * 1024);
  options.storeFile = path.join(options.sessionsDirectory, 'sessions.json');
  options.currentSessionFile = path.join(options.sessionsDirectory, `${options.currentSessionId}.jsonl`);
  const retiredSessionFile = await fixedFile(options.retiredSessionFile, 'preserved retired transcript');
  if (path.dirname(retiredSessionFile) !== options.sessionsDirectory
      || !path.basename(retiredSessionFile).startsWith(`${options.retiredSessionId}.jsonl.deleted.`)) {
    fail('retired transcript is not the declared OpenClaw cleanup artifact');
  }
  await fixedFile(options.currentSessionFile, 'current transcript');
  const retiredBytes = await readNoFollow(retiredSessionFile, 'preserved retired transcript');
  const currentBytes = await readNoFollow(options.currentSessionFile, 'current transcript');
  const retiredHeader = transcriptHeader(retiredBytes, options.retiredSessionId, 'retired transcript');
  const currentHeader = transcriptHeader(currentBytes, options.currentSessionId, 'current transcript');
  if (retiredHeader.startedAtMs >= currentHeader.startedAtMs) fail('retired transcript does not precede current session');
  options.currentStartedAtMs = currentHeader.startedAtMs;
  const authority = await readSessionStore(
    options.storeFile,
    options.stableSessionKey,
    options.currentSessionId,
    options.currentSessionFile,
  );
  if (authority.sessionStartedAt != null && authority.sessionStartedAt !== currentHeader.startedAtMs) {
    fail('current session epoch disagrees with transcript header');
  }
  const resetStamp = currentHeader.timestamp.replace(/:/g, '-');
  const canonicalRetiredFile = path.join(
    options.sessionsDirectory,
    `${options.retiredSessionId}.jsonl.reset.${resetStamp}`,
  );
  try {
    const existing = await readNoFollow(canonicalRetiredFile, 'existing canonical retired transcript');
    if (!existing.equals(retiredBytes)) fail('existing canonical retired transcript differs from preserved source');
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
  const report = {
    dryRun: !options.apply,
    stableSessionKey: options.stableSessionKey,
    retiredSessionId: options.retiredSessionId,
    retiredStartedAtMs: retiredHeader.startedAtMs,
    currentSessionId: options.currentSessionId,
    currentStartedAtMs: currentHeader.startedAtMs,
    epochRepairRequired: authority.sessionStartedAt == null,
    canonicalRetiredFile,
    retiredBytes: retiredBytes.length,
  };
  if (!options.apply) {
    process.stdout.write(`${JSON.stringify(report)}\n`);
    return;
  }
  const epochRepaired = await establishCurrentEpoch(options, authority);
  const resetCreated = await atomicCreateOrVerify(canonicalRetiredFile, retiredBytes);
  const bootstrapArguments = [
    options.bootstrapScript,
    '--state-dir', options.stateDir,
    '--vimicate-dir', options.vimicateDir,
    '--stable-session-key', options.stableSessionKey,
    '--agent-id', options.agentId,
    '--segment-file', canonicalRetiredFile,
    '--segment-file', options.currentSessionFile,
  ];
  const bootstrapDryRun = runBootstrap([...bootstrapArguments, '--dry-run']);
  const bootstrapApply = runBootstrap(bootstrapArguments);
  const after = await readSessionStore(
    options.storeFile,
    options.stableSessionKey,
    options.currentSessionId,
    options.currentSessionFile,
  );
  if (after.sessionStartedAt !== currentHeader.startedAtMs) fail('current epoch changed after audit');
  process.stdout.write(`${JSON.stringify({
    ...report,
    dryRun: false,
    epochRepaired,
    resetCreated,
    bootstrapDryRun,
    bootstrapApply,
  })}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  await main(process.argv.slice(2));
}

export { main, parseArguments, transcriptHeader };
