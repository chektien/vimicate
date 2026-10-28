import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadSqliteHistoryRuntime } from './sqlite-history-runtime.mjs';

const packageRoot = process.env.OPENCLAW_HISTORY_TEST_PACKAGE_ROOT;
test('installed audited runtime supplies the canonical history and authority ports', { skip: !packageRoot }, async t => {
  const info = JSON.parse(await fs.readFile(path.join(packageRoot, 'package.json'), 'utf8'));
  let overriddenEntries;
  if (['2026.9.8', '2026.9.9', '2026.10.2', '2026.10.4', '2026.10.5', '2026.10.6', '2026.10.7'].includes(info.version)) {
    ({ n: overriddenEntries } = await import(pathToFileURL(path.join(packageRoot,
      `dist/${['2026.10.5', '2026.10.6', '2026.10.7'].includes(info.version) ? 'runtime-process-entrypoints-De68tE_W.mjs' : ['2026.10.2', '2026.10.4', '2026.10.5', '2026.10.6', '2026.10.7'].includes(info.version) ? 'runtime-process-entrypoints-Dgz2IR4T.mjs' : info.version === '2026.9.9' ? 'runtime-process-entrypoints-Bh4reDp0.mjs' : 'runtime-process-entrypoints-CbWx0yUe.mjs'}`)).href));
    overriddenEntries.secretEgressProxy.root = '/explicit-fixture-root';
    overriddenEntries.codeModeNode.package = { name: 'fixture', distWorkerPath: 'fixture.worker.js' };
  }
  const { chat, readers, display, store, readRevision, preparePage } = await loadSqliteHistoryRuntime(packageRoot);
  if (overriddenEntries) {
    assert.equal(overriddenEntries.secretEgressProxy.root, '/explicit-fixture-root');
    assert.deepEqual(overriddenEntries.codeModeNode.package,
      { name: 'fixture', distWorkerPath: 'fixture.worker.js' });
    assert.equal(overriddenEntries.codeModeNode.root, undefined);
    delete overriddenEntries.secretEgressProxy.root;
    delete overriddenEntries.codeModeNode.package;
  }
  assert.deepEqual(Object.values(chat).map(fn => fn.name), [
    'readChatHistoryPage', 'enrichChatHistoryCompactionMarkers',
    'replaceOversizedChatHistoryMessages', ...(preparePage ? [] : ['resolveChatHistoryNextOffset']),
    'neverReplayOldestChatHistoryRecord',
  ]);
  for (const method of [chat.i, chat.r, chat.c, ...(preparePage ? [preparePage] : [chat.a]), chat.o, readers._, display.t,
    store.getSessionEntry, store.listSessionEntries, store.resolveTranscriptSessionKeyBySessionId, readRevision]) {
    assert.equal(typeof method, 'function');
  }
  const messages = [{ role: 'assistant', content: [{ type: 'text', text: 'fixture' }], __openclaw: { seq: 4 } }];
  assert.equal(chat.r(messages, undefined), messages);
  assert.deepEqual(chat.c({ messages, maxSingleMessageBytes: 4096 }).messages, messages);
  assert.deepEqual(readers._(messages, 4096).items, messages);
  const nextOffset = args => preparePage ? (preparePage({ messages: args.messages, pagination: args }, { maxHistoryBytes: 4096 }).nextOffset ?? args.totalMessages) : chat.a(args);
  if (preparePage) assert.equal(preparePage.name, 'prepareChatHistoryResponsePage');
  assert.equal(nextOffset({ messages, projected: messages, totalMessages: 5, offset: 0,
    rawPageMessages: 1, replayOldestRecord: false }), 2);
  assert.equal(chat.o({ projected: messages, bounded: messages }), false);
  if (['2026.10.2', '2026.10.4', '2026.10.5', '2026.10.6', '2026.10.7'].includes(info.version)) {
    const rows = [{ __openclaw: { id: 'older' } }, { __openclaw: { id: 'newer' } }];
    assert.equal(nextOffset({ messages: rows, projected: rows, totalMessages: 8,
      offset: 0, rawPageMessages: 2, messageSequences: { 'id:older': 4, 'id:newer': 5 } }), 5);
  }
  assert.deepEqual(display.t(messages), messages);
  // A wrong minified alias can still be callable (including a writer).
  assert.equal(readRevision.name, 'readSessionTranscriptWatermark');
  assert.equal(readers._.name, 'capArrayByJsonBytes');
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vimicate-runtime-scope-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  assert.deepEqual(readRevision({ agentId: 'main', sessionId: 'missing-fixture',
    sessionKey: 'agent:main:missing-fixture', storePath: path.join(root, 'agents/main/sessions/sessions.json') }),
  { generation: null, maxSeq: null });
  const missing = { agentId: 'main', sessionId: 'missing-fixture',
    sessionKey: 'agent:main:missing-fixture', readOnly: true,
    storePath: path.join(root, 'agents/main/sessions/sessions.json') };
  assert.equal(store.getSessionEntry(missing), undefined);
  assert.deepEqual(store.listSessionEntries(missing), []);
  assert.equal(store.resolveTranscriptSessionKeyBySessionId(missing), undefined);
  assert.deepEqual(await fs.readdir(root), [], 'missing read scope must not create a database');
  assert.deepEqual(readers._(['older', 'newer'], 10).items, ['newer']);
  const empty = await chat.i({ max: 16, maxHistoryBytes: 4096, effectiveMaxChars: 12000, offset: 0 });
  assert.deepEqual(empty.messages, []);
  assert.equal(empty.pagination.offset, 0);
  const entrypointFiles = {
    '2026.9.6': 'runtime-process-entrypoints-DazJcPEG.mjs',
    '2026.9.7': 'runtime-process-entrypoints-CbWx0yUe.mjs',
    '2026.9.8': 'runtime-process-entrypoints-CbWx0yUe.mjs',
    '2026.10.2': 'runtime-process-entrypoints-Dgz2IR4T.mjs',
    '2026.10.4': 'runtime-process-entrypoints-Dgz2IR4T.mjs',
    '2026.10.5': 'runtime-process-entrypoints-De68tE_W.mjs',
    '2026.10.6': 'runtime-process-entrypoints-De68tE_W.mjs',
    '2026.10.7': 'runtime-process-entrypoints-De68tE_W.mjs',
    '2026.9.9': 'runtime-process-entrypoints-Bh4reDp0.mjs',
  };
  if (entrypointFiles[info.version]) {
    // A plugin capture copy omits worker files; workers must resolve from the install.
    const { n: entrypoints } = await import(pathToFileURL(
      path.join(packageRoot, 'dist', entrypointFiles[info.version])).href);
    assert.equal(entrypoints.sessionTranscript.root, packageRoot);
  }
});

test('unknown versions and changed native bytes fail before module execution', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vimicate-runtime-pin-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const metadata = path.join(root, 'package.json');
  await fs.writeFile(metadata, JSON.stringify({ name: 'openclaw', version: '2099.1.1' }));
  await assert.rejects(loadSqliteHistoryRuntime(root), /unsupported OpenClaw runtime/);
  await fs.mkdir(path.join(root, 'dist'));
  for (const [version, filename] of [['2026.9.4', 'chat-history-handler-DpOELHcj.mjs'],
    ['2026.9.8', 'chat-history-pages-UsCDs89e.mjs'],
    ['2026.9.9', 'chat-history-pages-35kBcpOJ.mjs'],
    ['2026.10.2', 'chat-history-pages-BxZu7NVk.mjs'],
    ['2026.10.4', 'chat-history-pages-Dwy5WUPH.mjs'],
    ['2026.10.5', 'chat-history-pages-DPfzrnwK.mjs'],
    ['2026.10.6', 'chat-history-pages-_X-Upbh7.mjs'],
    ['2026.10.7', 'chat-history-pages-CHtAXEWj.mjs']]) {
    await fs.writeFile(metadata, JSON.stringify({ name: 'openclaw', version }));
    await fs.writeFile(path.join(root, 'dist', filename), 'throw new Error("unverified module executed");');
    await assert.rejects(loadSqliteHistoryRuntime(root), /native reader fingerprint mismatch/);
  }
});
