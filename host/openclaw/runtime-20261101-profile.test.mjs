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
const root = supplied && JSON.parse(await fs.readFile(path.join(supplied, 'package.json'))).version === '2026.11.1' ? supplied : undefined;
const named = {
  'chat-history-pages-D7C0cycq.mjs:n': 'readChatHistoryPage',
  'chat-history-response-page-BqyuqQqH.mjs:n': 'enrichChatHistoryCompactionMarkers',
  'chat-history-response-page-BqyuqQqH.mjs:r': 'prepareChatHistoryResponsePage',
  'chat-history-budget-BS2u2Rmt.mjs:c': 'replaceOversizedChatHistoryMessages',
  'session-utils.fs-BfASFo7x.mjs:t': 'capArrayByJsonBytes',
  'transcript-image-artifacts-BNfLH5hX.mjs:i': 'composeTranscriptDisplay',
  'session-accessor.sqlite-transcript-watermark-W3OQhsCR.mjs:t': 'readSessionTranscriptWatermark',
  'sessions-read-8WZVwcoa.mjs:t': 'sessionReadHandlers',
  'reply-run-registry.registry-BlzIDIz-.mjs:g': 'replyRunRegistry',
  'agent-run-registry-BBn72PQp.mjs:u': 'getAgentRunContext',
  'agent-run-registry-BBn72PQp.mjs:m': 'hasLiveAgentRunContext',
  'reply-run-registry.state-BOesaMPG.mjs:h': 'getAttachedBackend',
};
test('11.1 exact source exports identify readers, including relocated byte cap', { skip: !root }, async () => {
  for (const [binding, name] of Object.entries(named)) {
    const [filename, key] = binding.split(':');
    const source = await fs.readFile(path.join(root, 'dist', filename), 'utf8');
    assert.match(source, new RegExp(`export \\{[^}]*\\b${name} as ${key}\\b`));
  }
  const source = await fs.readFile(path.join(root, 'dist/session-transcript-readers-DMEsPkgl.mjs'), 'utf8');
  assert.match(source, /session_transcript_readers_exports as _/);
  assert.notEqual(PROFILES['2026.11.1'].bindings.readers[0], 'session-transcript-readers-DMEsPkgl.mjs');
  for (const [filename, pin] of Object.entries(PROFILES['2026.11.1'].pins)) {
    assert.ok((Array.isArray(pin) ? pin : [pin]).includes(crypto.createHash('sha256')
      .update(await fs.readFile(path.join(root, 'dist', filename))).digest('hex')));
  }
});
test('every 11.1 history owner rejects one-byte drift before private import', { skip: !root }, async t => {
  const fixture = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'vimicate-111-pins-')));
  t.after(() => fs.rm(fixture, { recursive: true, force: true }));
  await fs.writeFile(path.join(fixture, 'package.json'), JSON.stringify({ name: 'openclaw', version: '2026.11.1' }));
  for (const name of Object.keys(PROFILES['2026.11.1'].pins)) {
    const target = path.join(fixture, 'dist', name);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.copyFile(path.join(root, 'dist', name), target);
  }
  for (const name of Object.keys(PROFILES['2026.11.1'].pins)) {
    const target = path.join(fixture, 'dist', name), bytes = await fs.readFile(target);
    await fs.appendFile(target, '\n');
    await assert.rejects(loadSqliteHistoryRuntime(fixture), /fingerprint mismatch/);
    await fs.writeFile(target, bytes);
  }
});
test('every 11.1 run identity owner rejects drift before native registry import', { skip: !root }, async t => {
  const fixture = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'vimicate-111-run-pins-')));
  t.after(() => fs.rm(fixture, { recursive: true, force: true }));
  await fs.mkdir(path.join(fixture, 'dist'));
  await fs.writeFile(path.join(fixture, 'package.json'), JSON.stringify({ name: 'openclaw', version: '2026.11.1' }));
  const names = ['sessions-read-8WZVwcoa.mjs', 'reply-run-registry.registry-BlzIDIz-.mjs',
    'reply-run-registry.state-BOesaMPG.mjs', 'run-state-DCOv0i_E.mjs', 'agent-run-registry-BBn72PQp.mjs'];
  for (const name of names) await fs.copyFile(path.join(root, 'dist', name), path.join(fixture, 'dist', name));
  for (const name of names) {
    const target = path.join(fixture, 'dist', name), bytes = await fs.readFile(target);
    await fs.appendFile(target, '\n');
    await assert.rejects(loadSessionRunTruthRuntime(fixture), /integrity mismatch/);
    await fs.writeFile(target, bytes);
  }
});
