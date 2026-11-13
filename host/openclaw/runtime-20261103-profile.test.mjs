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
const root = supplied && JSON.parse(await fs.readFile(path.join(supplied, 'package.json'))).version === '2026.11.3' ? supplied : undefined;
const named = {
  'chat-history-pages-uusZwz8Y.mjs:n': 'readChatHistoryPage',
  'chat-history-response-page-eaictgfh.mjs:n': 'enrichChatHistoryCompactionMarkers',
  'chat-history-response-page-eaictgfh.mjs:r': 'prepareChatHistoryResponsePage',
  'chat-history-budget-zn9U6Nmg.mjs:c': 'replaceOversizedChatHistoryMessages',
  'session-utils.fs-BfASFo7x.mjs:t': 'capArrayByJsonBytes',
  'transcript-image-artifacts-BNfLH5hX.mjs:i': 'composeTranscriptDisplay',
  'session-accessor.sqlite-transcript-watermark-CfdOKFaq.mjs:t': 'readSessionTranscriptWatermark',
  'session-accessor.sqlite-read-scope-DzGQuOfU.mjs:a': 'resolveSqliteTranscriptReadScope',
  'session-accessor.sqlite-read-scope-DzGQuOfU.mjs:r': 'resolveSqliteScope',
  'sessions-read-QORJB2sW.mjs:t': 'sessionReadHandlers',
  'reply-run-registry.registry-DjlsSV_e.mjs:g': 'replyRunRegistry',
  'agent-run-registry-gmaPgO-n.mjs:u': 'getAgentRunContext',
  'agent-run-registry-gmaPgO-n.mjs:m': 'hasLiveAgentRunContext',
  'reply-run-registry.state-Hn_UqZjq.mjs:h': 'getAttachedBackend',
};
test('11.3 exact source exports identify readers, including relocated byte cap', { skip: !root }, async () => {
  for (const [binding, name] of Object.entries(named)) {
    const [filename, key] = binding.split(':');
    const source = await fs.readFile(path.join(root, 'dist', filename), 'utf8');
    assert.match(source, new RegExp(`export \\{[^}]*\\b${name} as ${key}\\b`));
  }
  const source = await fs.readFile(path.join(root, 'dist/session-transcript-readers-sEN0giif.mjs'), 'utf8');
  assert.match(source, /session_transcript_readers_exports as _/);
  assert.notEqual(PROFILES['2026.11.3'].bindings.readers[0], 'session-transcript-readers-sEN0giif.mjs');
  for (const [filename, pin] of Object.entries(PROFILES['2026.11.3'].pins)) {
    assert.ok((Array.isArray(pin) ? pin : [pin]).includes(crypto.createHash('sha256')
      .update(await fs.readFile(path.join(root, 'dist', filename))).digest('hex')));
  }
});
test('11.3 read owners take their read scope from the pinned relocated resolver', { skip: !root }, async () => {
  // 11.3 moved resolveSqliteTranscriptReadScope and resolveSqliteScope out of
  // session-accessor.sqlite-scope. The watermark and entry readers must bind the
  // pinned copy, not a writable scope owner.
  const owners = {
    'session-accessor.sqlite-transcript-watermark-CfdOKFaq.mjs': /import \{ a as resolveSqliteTranscriptReadScope \} from "\.\/session-accessor\.sqlite-read-scope-DzGQuOfU\.mjs";/,
    'session-accessor.sqlite-entry-DQgFS9_A.mjs': /import \{ a as resolveSqliteTranscriptReadScope, r as resolveSqliteScope \} from "\.\/session-accessor\.sqlite-read-scope-DzGQuOfU\.mjs";/,
    'session-accessor.sqlite-entry-list.read-BLfvs7b2.mjs': /import \{ r as resolveSqliteScope \} from "\.\/session-accessor\.sqlite-read-scope-DzGQuOfU\.mjs";/,
    'session-history-worker-runtime-cLJ9ttb9.mjs': /import \{ r as resolveSqliteScope \} from "\.\/session-accessor\.sqlite-read-scope-DzGQuOfU\.mjs";/,
  };
  for (const [filename, binding] of Object.entries(owners)) {
    assert.match(await fs.readFile(path.join(root, 'dist', filename), 'utf8'), binding, filename);
    assert.ok(Object.hasOwn(PROFILES['2026.11.3'].pins, filename), `${filename} is pinned`);
  }
  assert.ok(Object.hasOwn(PROFILES['2026.11.3'].pins, 'session-accessor.sqlite-read-scope-DzGQuOfU.mjs'));
  const watermark = await fs.readFile(path.join(root, 'dist/session-accessor.sqlite-transcript-watermark-CfdOKFaq.mjs'), 'utf8');
  assert.match(watermark, /withOpenClawAgentDatabaseReadOnly/);
});
test('every 11.3 history owner rejects one-byte drift before private import', { skip: !root }, async t => {
  const fixture = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'vimicate-113-pins-')));
  t.after(() => fs.rm(fixture, { recursive: true, force: true }));
  await fs.writeFile(path.join(fixture, 'package.json'), JSON.stringify({ name: 'openclaw', version: '2026.11.3' }));
  for (const name of Object.keys(PROFILES['2026.11.3'].pins)) {
    const target = path.join(fixture, 'dist', name);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.copyFile(path.join(root, 'dist', name), target);
  }
  for (const name of Object.keys(PROFILES['2026.11.3'].pins)) {
    const target = path.join(fixture, 'dist', name), bytes = await fs.readFile(target);
    await fs.appendFile(target, '\n');
    await assert.rejects(loadSqliteHistoryRuntime(fixture), /fingerprint mismatch/);
    await fs.writeFile(target, bytes);
  }
});
test('every 11.3 run identity owner rejects drift before native registry import', { skip: !root }, async t => {
  const fixture = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'vimicate-113-run-pins-')));
  t.after(() => fs.rm(fixture, { recursive: true, force: true }));
  await fs.mkdir(path.join(fixture, 'dist'));
  await fs.writeFile(path.join(fixture, 'package.json'), JSON.stringify({ name: 'openclaw', version: '2026.11.3' }));
  const names = ['sessions-read-QORJB2sW.mjs', 'reply-run-registry.registry-DjlsSV_e.mjs',
    'reply-run-registry.state-Hn_UqZjq.mjs', 'run-state-DZ4Vfz1J.mjs', 'agent-run-registry-gmaPgO-n.mjs'];
  for (const name of names) await fs.copyFile(path.join(root, 'dist', name), path.join(fixture, 'dist', name));
  for (const name of names) {
    const target = path.join(fixture, 'dist', name), bytes = await fs.readFile(target);
    await fs.appendFile(target, '\n');
    await assert.rejects(loadSessionRunTruthRuntime(fixture), /integrity mismatch/);
    await fs.writeFile(target, bytes);
  }
});
test('11.3 profiles retain the 11.1 owner shape and native identity', () => {
  const [old, next] = [PROFILES['2026.11.1'], PROFILES['2026.11.3']];
  assert.equal(next.nativeIdentity, true);
  assert.deepEqual(next.entrypoints, old.entrypoints);
  assert.equal(Object.keys(next.pins).length, Object.keys(old.pins).length + 1);
  for (const [stable, [, key]] of Object.entries(old.bindings.chat)) assert.equal(next.bindings.chat[stable][1], key);
  for (const name of ['preparePage', 'readers', 'display', 'accessor']) assert.equal(next.bindings[name][1], old.bindings[name][1]);
  for (const binding of [...Object.values(next.bindings.chat), next.bindings.preparePage, next.bindings.readers,
    next.bindings.display, next.bindings.accessor]) assert.ok(Object.hasOwn(next.pins, binding[0]), binding[0]);
});
