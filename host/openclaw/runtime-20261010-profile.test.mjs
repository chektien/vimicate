import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { PROFILES } from './sqlite-history-profiles.mjs';
import { loadSqliteHistoryRuntime } from './sqlite-history-runtime.mjs';
import { loadSessionRunTruthRuntime } from './session-run-truth.mjs';
const supplied = process.env.OPENCLAW_PROFILE_BYTES;
const root = supplied && JSON.parse(await fs.readFile(path.join(supplied, 'package.json'))).version === '2026.10.10' ? supplied : undefined;
const named = {
  'chat-history-pages-BScIpCdt.mjs:n': 'readChatHistoryPage',
  'chat-history-response-page-wiRB1dhs.mjs:n': 'enrichChatHistoryCompactionMarkers',
  'chat-history-response-page-wiRB1dhs.mjs:r': 'prepareChatHistoryResponsePage',
  'chat-history-budget-DMTS7TVJ.mjs:c': 'replaceOversizedChatHistoryMessages',
  'session-utils.fs-BTKkUYd7.mjs:t': 'capArrayByJsonBytes',
  'transcript-image-artifacts-BNfLH5hX.mjs:i': 'composeTranscriptDisplay',
  'session-accessor.sqlite-transcript-watermark-CJ36yRM5.mjs:t': 'readSessionTranscriptWatermark',
  'sessions-read-BSqkIDDT.mjs:t': 'sessionReadHandlers',
  'reply-run-registry.registry-AU46m76C.mjs:g': 'replyRunRegistry',
  'agent-run-registry-Dvv4_0by.mjs:u': 'getAgentRunContext',
  'agent-run-registry-Dvv4_0by.mjs:m': 'hasLiveAgentRunContext',
  'reply-run-registry.state-Cbu_mr1k.mjs:h': 'getAttachedBackend',
};
test('10.10 exact source exports identify readers, including relocated byte cap', { skip: !root }, async () => {
  for (const [binding, name] of Object.entries(named)) {
    const [filename, key] = binding.split(':');
    const source = await fs.readFile(path.join(root, 'dist', filename), 'utf8');
    assert.match(source, new RegExp(`export \\{[^}]*\\b${name} as ${key}\\b`));
  }
  const source = await fs.readFile(path.join(root, 'dist/session-transcript-readers-C6_dZAYs.mjs'), 'utf8');
  assert.match(source, /session_transcript_readers_exports as _/);
  assert.notEqual(PROFILES['2026.10.10'].bindings.readers[0], 'session-transcript-readers-C6_dZAYs.mjs');
  for (const [filename, pin] of Object.entries(PROFILES['2026.10.10'].pins)) {
    assert.ok((Array.isArray(pin) ? pin : [pin]).includes(crypto.createHash('sha256')
      .update(await fs.readFile(path.join(root, 'dist', filename))).digest('hex')));
  }
});
test('every 10.10 history owner rejects one-byte drift before private import', { skip: !root }, async t => {
  const fixture = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'vimicate-1010-pins-')));
  t.after(() => fs.rm(fixture, { recursive: true, force: true }));
  await fs.writeFile(path.join(fixture, 'package.json'), JSON.stringify({ name: 'openclaw', version: '2026.10.10' }));
  for (const name of Object.keys(PROFILES['2026.10.10'].pins)) {
    const target = path.join(fixture, 'dist', name);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.copyFile(path.join(root, 'dist', name), target);
  }
  for (const name of Object.keys(PROFILES['2026.10.10'].pins)) {
    const target = path.join(fixture, 'dist', name), bytes = await fs.readFile(target);
    await fs.appendFile(target, '\n');
    await assert.rejects(loadSqliteHistoryRuntime(fixture), /fingerprint mismatch/);
    await fs.writeFile(target, bytes);
  }
});
test('every 10.10 run identity owner rejects drift before native registry import', { skip: !root }, async t => {
  const fixture = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'vimicate-1010-run-pins-')));
  t.after(() => fs.rm(fixture, { recursive: true, force: true }));
  await fs.mkdir(path.join(fixture, 'dist'));
  await fs.writeFile(path.join(fixture, 'package.json'), JSON.stringify({ name: 'openclaw', version: '2026.10.10' }));
  const names = ['sessions-read-BSqkIDDT.mjs', 'reply-run-registry.registry-AU46m76C.mjs',
    'reply-run-registry.state-Cbu_mr1k.mjs', 'run-state-0vqQz4hS.mjs', 'agent-run-registry-Dvv4_0by.mjs'];
  for (const name of names) await fs.copyFile(path.join(root, 'dist', name), path.join(fixture, 'dist', name));
  for (const name of names) {
    const target = path.join(fixture, 'dist', name), bytes = await fs.readFile(target);
    await fs.appendFile(target, '\n');
    await assert.rejects(loadSessionRunTruthRuntime(fixture), /integrity mismatch/);
    await fs.writeFile(target, bytes);
  }
});
