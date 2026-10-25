#!/usr/bin/env node

import crypto from 'node:crypto';
import fsNative from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_TRAJECTORY_BYTES = 256 * 1024 * 1024;
const MAX_RECOVERED_BYTES = 256 * 1024 * 1024;

function fail(message) { throw new Error(`Vimicate trajectory recovery: ${message}`); }

export function authoredPromptFromTrajectory(value) {
  const text = typeof value === 'string' ? value : '';
  const marker = '\nUser prompt:\n';
  const index = text.lastIndexOf(marker);
  if (index < 0) return text.trim();
  const prefix = text.slice(0, index);
  if (!prefix.includes('Vimicate project context:') && !prefix.includes('Vimicate selected project context:')) return text.trim();
  return text.slice(index + marker.length).trim();
}

export function recoveredSegmentFromTrajectory(records, expectedStableKey, expectedSessionId) {
  if (!UUID.test(expectedSessionId)) fail('trajectory filename does not carry a session UUID');
  if (!Array.isArray(records) || !records.length) fail(`trajectory ${expectedSessionId} is empty`);
  for (const record of records) {
    if (!isRecord(record)) fail(`trajectory ${expectedSessionId} contains a non-object record`);
    if (record.sessionKey !== expectedStableKey) fail(`trajectory ${expectedSessionId} mixes stable session authority`);
    if (record.sessionId !== expectedSessionId) fail(`trajectory ${expectedSessionId} mixes concrete session authority`);
    if (!validTimestamp(record.ts)) fail(`trajectory ${expectedSessionId} contains an invalid timestamp`);
  }
  const ordered = [...records].sort(compareTrajectoryRecord);
  if (!ordered.some((record) => record.type === 'prompt.submitted')) fail(`trajectory ${expectedSessionId} has no submitted prompt`);
  const startedAt = ordered[0].ts;
  const workspaceDir = ordered.find((record) => typeof record.workspaceDir === 'string')?.workspaceDir;
  const lines = [{ type: 'session', version: 3, id: expectedSessionId, timestamp: startedAt, ...(workspaceDir ? { cwd: workspaceDir } : {}) }];
  let parentId = null;
  let messageOrdinal = 0;

  const appendMessage = (timestamp, message) => {
    const id = deterministicUUID(`${expectedSessionId}\u0000${messageOrdinal++}\u0000${timestamp}\u0000${message.role}`);
    lines.push({ type: 'message', id, parentId, timestamp, message: { ...message, timestamp: Date.parse(timestamp) } });
    parentId = id;
  };

  for (const record of ordered) {
    const data = isRecord(record.data) ? record.data : {};
    if (record.type === 'prompt.submitted') {
      const prompt = authoredPromptFromTrajectory(data.finalPromptText ?? data.prompt);
      if (prompt) appendMessage(record.ts, { role: 'user', content: prompt, ...(record.runId ? { idempotencyKey: `${record.runId}:user` } : {}) });
      continue;
    }
    if (record.type === 'tool.call') {
      const name = stringValue(data.name) || 'tool';
      const toolCallId = stringValue(data.toolCallId) || stringValue(data.itemId) || deterministicUUID(`${expectedSessionId}\u0000tool\u0000${messageOrdinal}`);
      appendMessage(record.ts, { role: 'assistant', content: [{ type: 'toolCall', id: toolCallId, name, arguments: data.arguments ?? {}, input: data.arguments ?? {} }] });
      continue;
    }
    if (record.type === 'tool.result') {
      const name = stringValue(data.name) || 'tool';
      const toolCallId = stringValue(data.toolCallId) || stringValue(data.itemId) || deterministicUUID(`${expectedSessionId}\u0000result\u0000${messageOrdinal}`);
      const text = toolResultText(data);
      appendMessage(record.ts, {
        role: 'toolResult', toolCallId, toolName: name, isError: data.isError === true || data.success === false,
        content: [{ type: 'toolResult', id: toolCallId, name, toolName: name, toolCallId, toolUseId: toolCallId, tool_use_id: toolCallId, content: text, text }],
      });
      continue;
    }
    if (record.type === 'model.completed') {
      const texts = assistantTexts(data);
      texts.forEach((text, index) => appendMessage(shiftedTimestamp(record.ts, index), { role: 'assistant', content: [{ type: 'text', text }] }));
    }
  }

  const bytes = Buffer.from(`${lines.map((line) => JSON.stringify(line)).join('\n')}\n`);
  if (bytes.length > MAX_RECOVERED_BYTES) fail(`trajectory ${expectedSessionId} projects beyond the recovered transcript bound`);
  return { sessionId: expectedSessionId, startedAt, messageCount: lines.length - 1, bytes };
}

export function recoveredSegmentsFromTrajectoryRecords(
  records,
  expectedStableKey,
  currentSessionId
) {
  if (!Array.isArray(records)) fail('trajectory record collection is invalid');
  if (!UUID.test(currentSessionId)) fail('current session authority is not a UUID');
  const bySession = new Map();
  const exactRecords = new Set();
  for (const record of records) {
    if (!isRecord(record) || record.sessionKey !== expectedStableKey) continue;
    if (!UUID.test(stringValue(record.sessionId))) {
      fail('trajectory record has no concrete session authority');
    }
    // A trajectory file may remain the runtime sink after OpenClaw rotates the
    // concrete session id. Group by the authority carried by each record, not
    // by the historical filename. Identical records can also survive in more
    // than one retained trajectory snapshot, so admit each exact record once.
    const fingerprint = crypto.createHash('sha256')
      .update(JSON.stringify(record))
      .digest('hex');
    if (exactRecords.has(fingerprint)) continue;
    exactRecords.add(fingerprint);
    if (record.sessionId === currentSessionId) continue;
    const group = bySession.get(record.sessionId) ?? [];
    group.push(record);
    bySession.set(record.sessionId, group);
  }
  const recovered = [...bySession.entries()].map(([sessionId, sessionRecords]) =>
    recoveredSegmentFromTrajectory(
      sessionRecords,
      expectedStableKey,
      sessionId
    )
  );
  recovered.sort((left, right) => Date.parse(left.startedAt) - Date.parse(right.startedAt));
  return recovered;
}

function assistantTexts(data) {
  const direct = Array.isArray(data.assistantTexts) ? data.assistantTexts.filter((value) => typeof value === 'string' && value.trim()).map((value) => value.trim()) : [];
  if (direct.length) return direct;
  const snapshot = Array.isArray(data.messagesSnapshot) ? data.messagesSnapshot : [];
  for (let index = snapshot.length - 1; index >= 0; index -= 1) {
    const message = snapshot[index];
    if (!isRecord(message) || message.role !== 'assistant') continue;
    const text = assistantContentText(message.content);
    if (text) return [text];
    const error = stringValue(message.errorMessage);
    if (error) return [`Error: ${error}`];
  }
  return [];
}

function assistantContentText(content) {
  if (typeof content === 'string') return content.trim();
  if (!Array.isArray(content)) return '';
  return content.flatMap((part) => isRecord(part) && part.type === 'text' && typeof part.text === 'string' ? [part.text.trim()] : []).filter(Boolean).join('\n\n');
}

function toolResultText(data) {
  if (typeof data.output === 'string') return data.output;
  if (typeof data.text === 'string') return data.text;
  if (Array.isArray(data.contentItems)) {
    const text = data.contentItems.flatMap((item) => isRecord(item) && typeof item.text === 'string' ? [item.text] : []).join('\n');
    if (text) return text;
  }
  if (data.result !== undefined) return printable(data.result);
  return data.isError === true || data.success === false ? 'tool failed' : 'tool completed';
}

function parseArguments(argv) {
  const result = { apply: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--') continue;
    if (argument === '--state-dir') result.stateDir = argv[++index];
    else if (argument === '--vimicate-dir') result.vimicateDir = argv[++index];
    else if (argument === '--stable-session-key') result.stableSessionKey = argv[++index];
    else if (argument === '--bootstrap-script') result.bootstrapScript = argv[++index];
    else if (argument === '--apply') result.apply = true;
    else fail(`unknown argument ${JSON.stringify(argument)}`);
  }
  if (!result.stateDir || !result.vimicateDir || !result.stableSessionKey || !result.bootstrapScript) {
    fail('--state-dir, --vimicate-dir, --stable-session-key, and --bootstrap-script are required');
  }
  return result;
}

async function main(argv) {
  const options = parseArguments(argv);
  const stateDirectory = await fixedDirectory(options.stateDir, 'OpenClaw state directory');
  const vimicateDirectory = await fixedDirectory(options.vimicateDir, 'Vimicate directory');
  const sessionsDirectory = await fixedDirectory(path.join(stateDirectory, 'agents', 'main', 'sessions'), 'OpenClaw sessions directory');
  const bootstrapScript = await fixedFile(options.bootstrapScript, 'history-family bootstrap');
  const sessionStore = JSON.parse(await fs.readFile(path.join(sessionsDirectory, 'sessions.json'), 'utf8'));
  const authority = sessionStore[options.stableSessionKey];
  if (!isRecord(authority) || !UUID.test(stringValue(authority.sessionId))) fail('stable session has no current concrete authority');
  const currentSessionId = authority.sessionId;
  const currentFile = path.resolve(stringValue(authority.sessionFile));
  if (path.dirname(currentFile) !== sessionsDirectory
      || !isCanonicalCurrentTranscriptFilename(currentSessionId, path.basename(currentFile))) {
    fail('current transcript escaped fixed authority');
  }
  const currentHeader = firstJSONLine(await readBounded(currentFile, 'current transcript'));
  if (currentHeader.type !== 'session' || currentHeader.id !== currentSessionId || !validTimestamp(currentHeader.timestamp)) fail('current transcript header disagrees with authority');

  const directoryEntries = await fs.readdir(sessionsDirectory);
  const trajectoryRecords = [];
  for (const filename of directoryEntries.filter((value) => value.endsWith('.trajectory.jsonl')).sort()) {
    const bytes = await readBounded(path.join(sessionsDirectory, filename), `trajectory ${filename}`);
    const records = parseJSONLines(bytes, `trajectory ${filename}`);
    if (!records.some((record) => isRecord(record) && record.sessionKey === options.stableSessionKey)) continue;
    trajectoryRecords.push(...records);
  }
  const recovered = recoveredSegmentsFromTrajectoryRecords(
    trajectoryRecords,
    options.stableSessionKey,
    currentSessionId
  );
  if (!recovered.length) fail('no exact historical trajectories were found');
  for (let index = 1; index < recovered.length; index += 1) {
    if (Date.parse(recovered[index].startedAt) <= Date.parse(recovered[index - 1].startedAt)) fail('historical trajectory epochs are not strictly increasing');
  }
  if (Date.parse(recovered.at(-1).startedAt) >= Date.parse(currentHeader.timestamp)) fail('historical trajectory overlaps the current generation');

  const staged = recovered.map((segment, index) => {
    const endedAt = recovered[index + 1]?.startedAt ?? currentHeader.timestamp;
    const resetStamp = endedAt.replace(/:/g, '-');
    return { ...segment, file: path.join(sessionsDirectory, `${segment.sessionId}.jsonl.reset.${resetStamp}`) };
  });
  let aggregateBytes = 0;
  for (const segment of staged) {
    aggregateBytes += segment.bytes.length;
    if (aggregateBytes > MAX_RECOVERED_BYTES) fail('recovered family exceeds 256 MiB');
    try {
      const existing = await readBounded(segment.file, `existing recovered segment ${segment.sessionId}`);
      if (!existing.equals(segment.bytes)) fail(`existing recovered segment differs for ${segment.sessionId}`);
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
  }

  const report = {
    dryRun: !options.apply,
    stableSessionKey: options.stableSessionKey,
    archivedSegments: staged.length,
    recoveredMessages: staged.reduce((sum, segment) => sum + segment.messageCount, 0),
    firstStartedAt: staged[0].startedAt,
    lastStartedAt: staged.at(-1).startedAt,
    currentSessionId,
    aggregateBytes,
  };
  if (!options.apply) { process.stdout.write(`${JSON.stringify(report)}\n`); return; }

  for (const segment of staged) await atomicCreateOrVerify(segment.file, segment.bytes);
  const commonArguments = [bootstrapScript, '--state-dir', stateDirectory, '--vimicate-dir', vimicateDirectory, '--stable-session-key', options.stableSessionKey];
  for (const segment of staged) commonArguments.push('--segment-file', segment.file);
  commonArguments.push('--segment-file', currentFile);
  runBootstrap([...commonArguments, '--dry-run']);
  runBootstrap(commonArguments);
  process.stdout.write(`${JSON.stringify({ ...report, dryRun: false })}\n`);
}

function runBootstrap(argumentsValue) {
  const result = spawnSync(process.execPath, argumentsValue, { encoding: 'utf8' });
  if (result.status !== 0) fail(`audited bootstrap rejected recovered family: ${(result.stderr || result.stdout).trim()}`);
}

async function atomicCreateOrVerify(file, bytes) {
  try {
    const handle = await fs.open(file, fsNative.constants.O_WRONLY | fsNative.constants.O_CREAT | fsNative.constants.O_EXCL, 0o600);
    try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
    await fs.chmod(file, 0o600);
  } catch (error) {
    if (error?.code !== 'EEXIST') throw error;
    const existing = await readBounded(file, 'existing recovered transcript');
    if (!existing.equals(bytes)) fail(`refusing to replace ${path.basename(file)}`);
  }
}

async function fixedDirectory(directory, label) {
  const resolved = path.resolve(directory);
  const stat = await fs.lstat(resolved);
  if (!stat.isDirectory() || stat.isSymbolicLink()) fail(`${label} is not a fixed directory`);
  return resolved;
}

async function fixedFile(file, label) {
  const resolved = path.resolve(file);
  const stat = await fs.lstat(resolved);
  if (!stat.isFile() || stat.isSymbolicLink()) fail(`${label} is not a fixed file`);
  return resolved;
}

async function readBounded(file, label) {
  const handle = await fs.open(file, fsNative.constants.O_RDONLY | fsNative.constants.O_NOFOLLOW);
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size < 1 || stat.size > MAX_TRAJECTORY_BYTES) fail(`${label} is not a bounded regular file`);
    return await handle.readFile();
  } finally { await handle.close(); }
}

function parseJSONLines(bytes, label) {
  return bytes.toString('utf8').split('\n').filter((line) => line.trim()).map((line, index) => {
    try { return JSON.parse(line); } catch { fail(`${label} line ${index + 1} is invalid JSON`); }
  });
}

function firstJSONLine(bytes) { return JSON.parse(bytes.toString('utf8').split('\n', 1)[0]); }
function compareTrajectoryRecord(left, right) { return Date.parse(left.ts) - Date.parse(right.ts) || numberValue(left.seq) - numberValue(right.seq); }
function shiftedTimestamp(value, offset) { return new Date(Date.parse(value) + offset).toISOString(); }
function validTimestamp(value) { return typeof value === 'string' && Number.isFinite(Date.parse(value)); }
function isCanonicalCurrentTranscriptFilename(sessionId, filename) {
  if (filename === `${sessionId}.jsonl`) return true;
  const prefix = `${sessionId}-topic-`;
  return filename.startsWith(prefix)
    && filename.endsWith('.jsonl')
    && /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(
      filename.slice(prefix.length, -'.jsonl'.length)
    );
}
function deterministicUUID(value) { const hex = crypto.createHash('sha256').update(value).digest('hex'); return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`; }
function printable(value) { if (typeof value === 'string') return value; try { return JSON.stringify(value, null, 2); } catch { return String(value); } }
function stringValue(value) { return typeof value === 'string' ? value : ''; }
function numberValue(value) { return typeof value === 'number' && Number.isFinite(value) ? value : 0; }
function isRecord(value) { return typeof value === 'object' && value !== null && !Array.isArray(value); }

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((error) => { process.stderr.write(`${error?.stack ?? error}\n`); process.exitCode = 1; });
}
