import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createSqliteHistoryReader, loadSqliteHistoryReader } from './sqlite-history-reader.mjs';

const request = { agentId: 'main', stableSessionKey: 'agent:main:fixture',
  sessionId: '00000000-0000-4000-a000-000000000127', offset: 0, limit: 16 };
function fixture(overrides = {}) {
  const seen = [];
  const rows = [{ id: 'prompt' }, { id: 'answer' }, { id: 'late-activity' }];
  const native = {
    resolveOwner: () => request.stableSessionKey,
    readStats: () => ({ eventCount: 4, maxSeq: 4, sizeBytes: 400 }),
    readRevision: () => ({ generation: 'rewrite-1', maxSeq: 4 }),
    readPage: async params => { seen.push(params); return { messages: rows, pagination: { offset: 0, totalMessages: 4, rawPageMessages: 3 } }; },
    enrich: messages => messages,
    replaceOversized: ({ messages }) => ({ messages }),
    capBytes: messages => ({ items: messages }),
    replayOldest: () => false,
    // 9.6 reads the enriched projection itself instead of a replay flag.
    nextOffset: ({ messages, projected }) => { assert.equal(messages, rows); assert.equal(projected, rows); return 3; },
    compose: messages => [messages[0], messages[2], messages[1]],
    ...overrides,
  };
  return { reader: createSqliteHistoryReader({ stateDir: '/stage/state', env: {}, native }), native, seen };
}

test('native cursor uses physical order; final output uses native display composition', async () => {
  const { reader, seen } = fixture();
  const result = await reader.readPage(request);
  assert.deepEqual(result.messages.map(row => row.id), ['prompt', 'late-activity', 'answer']);
  assert.equal(result.nextOffset, 3);
  assert.equal(result.hasMore, true);
  assert.equal(seen[0].entry, undefined);
  assert.equal(seen[0].ignoreCliSessionImports, true);
  assert.equal(seen[0].storePath, '/stage/state/agents/main/sessions/sessions.json');
});

test('passes native sequence side metadata to the physical cursor owner', async () => {
  const messageSequences = { 'id:prompt': 2, 'id:answer': 3 };
  const rows = [{ __openclaw: { id: 'prompt' } }, { __openclaw: { id: 'answer' } }];
  const { reader } = fixture({
    readPage: async () => ({ messages: rows,
      pagination: { offset: 0, totalMessages: 4, rawPageMessages: 2, messageSequences } }),
    nextOffset: params => {
      assert.equal(params.messageSequences, messageSequences);
      return 3;
    },
    compose: messages => messages,
  });
  assert.equal((await reader.readPage(request)).nextOffset, 3);
});

test('canonical response owner preserves grouped replies and exclusively owns budget, placement and pagination', async () => {
  const projected = [{ id: 'reply-group' }];
  const fail = () => { throw new Error('superseded projection must not run'); };
  const { reader } = fixture({
    preparePage(raw, options) {
      assert.equal(raw.pagination.totalMessages, 4);
      assert.deepEqual(options, { maxHistoryBytes: 512 * 1024 });
      return { messages: projected, totalMessages: 4, hasMore: true, nextOffset: 2 };
    },
    enrich: fail, replaceOversized: fail, capBytes: fail, nextOffset: fail, compose: fail,
  });
  const result = await reader.readPage(request);
  assert.equal(result.messages, projected);
  assert.equal(result.nextOffset, 2);
  for (const prepared of [
    { messages: [], totalMessages: 4, hasMore: true },
    { messages: [], totalMessages: 4, hasMore: false, nextOffset: 2 },
    { messages: [], totalMessages: 5, hasMore: false },
    { messages: [], totalMessages: 4, hasMore: true, nextOffset: 0 },
  ]) await assert.rejects(fixture({ preparePage: () => prepared }).reader.readPage(request));
});

test('does not substitute a selected route for absent, foreign or escaped scopes', async () => {
  const { reader, seen } = fixture();
  for (const patch of [{ agentId: '../main' }, { stableSessionKey: 'agent:other:fixture' },
    { sessionId: undefined }, { sessionId: '../../elsewhere' }, { limit: 129 }, { offset: -1 }]) {
    await assert.rejects(reader.readPage({ ...request, ...patch }));
  }
  assert.equal(seen.length, 0);
  await assert.rejects(fixture({ resolveOwner: () => 'agent:main:another' }).reader.readPage(request), /does not belong/);
});

test('rejects nonprogress, malformed or oversized native responses', async () => {
  for (const overrides of [
    { nextOffset: () => 0 }, { nextOffset: () => 5 },
    { readPage: async () => ({ messages: [], pagination: { offset: 1, totalMessages: 4, rawPageMessages: 1 } }) },
    { readPage: async () => ({ messages: [], pagination: { offset: 0, totalMessages: 40_000, rawPageMessages: 1 } }) },
    { compose: () => Array.from({ length: 513 }, () => ({})) },
    { compose: () => [{ text: 'x'.repeat(512 * 1024) }] },
  ]) await assert.rejects(fixture(overrides).reader.readPage(request));
});

test('rejects changed ownership or transcript stats during projection', async () => {
  let called = 0;
  await assert.rejects(fixture({ resolveOwner: () => ++called === 1 ? request.stableSessionKey : 'agent:main:other' }).reader.readPage(request), /changed during/);
  called = 0;
  await assert.rejects(fixture({ readStats: () => ({ eventCount: ++called, maxSeq: 4, sizeBytes: 400 }) }).reader.readPage(request), /changed during/);
});

test('rejects a same-sized rewrite even when count, max sequence and bytes match', async () => {
  let reads = 0;
  const { reader } = fixture({ readRevision: () => ({ generation: `rewrite-${++reads}`, maxSeq: 4 }) });
  await assert.rejects(reader.readPage(request), /changed during/);
});

test('supports terminal empty projected pages without inventing a cursor', async () => {
  const { reader } = fixture({
    readPage: async () => ({ messages: [], pagination: { offset: 0, totalMessages: 1, rawPageMessages: 1 } }),
    nextOffset: () => 1, compose: () => [],
  });
  const result = await reader.readPage(request);
  assert.equal(result.hasMore, false);
  assert.equal(result.nextOffset, undefined);
  assert.deepEqual(result.messages, []);
});

test('bounds outstanding reads, rejects disposed publication, and releases slots after failure', async () => {
  let release;
  const barrier = new Promise(resolve => { release = resolve; });
  const { reader } = fixture({ readPage: () => barrier });
  const one = reader.readPage(request), two = reader.readPage(request);
  await assert.rejects(reader.readPage(request), /busy/);
  reader.dispose();
  release({});
  await assert.rejects(one, /disposed/);
  await assert.rejects(two, /disposed/);
  await assert.rejects(reader.readPage(request), /disposed/);
  const retry = fixture({ readPage: async () => { throw new Error('unavailable'); } }).reader;
  for (let count = 0; count < 3; count++) await assert.rejects(retry.readPage(request), /unavailable/);
});

test('cancellation prevents native calls and suppresses an in-flight result', async () => {
  const controller = new AbortController();
  const { reader, seen } = fixture({ readPage: async () => { controller.abort(); return {}; } });
  await assert.rejects(reader.readPage({ ...request, signal: controller.signal }), /abort/i);
  await assert.rejects(reader.readPage({ ...request, signal: controller.signal }), /abort/i);
  assert.equal(seen.length, 0);
});

test('loader rejects changed versions and bundles before loading native code', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vimicate-sqlite-reader-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.writeFile(path.join(root, 'package.json'), JSON.stringify({ name: 'openclaw', version: '2026.7.1-2' }));
  await assert.rejects(loadSqliteHistoryReader({ packageRoot: root, stateDir: '/stage' }), /unsupported/);
  await fs.writeFile(path.join(root, 'package.json'), JSON.stringify({ name: 'openclaw', version: '2026.8.1' }));
  await fs.mkdir(path.join(root, 'dist'));
  await fs.writeFile(path.join(root, 'dist/chat-BMcwuITo.js'), 'throw new Error("must not import")');
  await assert.rejects(loadSqliteHistoryReader({ packageRoot: root, stateDir: '/stage' }), /fingerprint mismatch/);
});
