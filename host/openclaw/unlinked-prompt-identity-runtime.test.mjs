import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import { createSqliteHistoryReader } from './sqlite-history-reader.mjs';

// Opt-in investigation of installed source, not admission into a runtime profile.
// The child reads only synthetic CLI history and injected canonical rows.
const target = process.env.VIMICATE_PROMPT_IDENTITY_PACKAGE_ROOT;
if (process.env.VIMICATE_PROMPT_IDENTITY_CHILD !== '1') {
  test('native Claude import identity requires a join, not just an available UUID', { skip: !target }, async t => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vimicate-prompt-identity-'));
    t.after(() => fs.rm(root, { recursive: true, force: true }));
    const config = path.join(root, 'openclaw.json');
    await fs.writeFile(config, '{}');
    const result = await promisify(execFile)(process.execPath, [fileURLToPath(import.meta.url)], {
      timeout: 30000,
      env: { ...process.env, VIMICATE_PROMPT_IDENTITY_CHILD: '1',
        VIMICATE_PROMPT_IDENTITY_FIXTURE: root, OPENCLAW_STATE_DIR: root, OPENCLAW_CONFIG_PATH: config },
    });
    const report = JSON.parse(result.stdout.trim());
    assert.deepEqual(report, { linkedBeforeAggregate: true, unlinkedOutsideWindow: true,
      repeatedSubmissions: 2, missingUuidUnlinked: true, explicitIdentityOutsideWindow: true,
      ignoredImports: true, unchangedInputs: true });
  });
  test('repo archive adapter preserves supplied identity but cannot manufacture a missing link', async () => {
    const fixture = JSON.parse(await fs.readFile(new URL('../../fixtures/openclaw/unlinked-prompt-identity.json', import.meta.url), 'utf8'));
    for (const row of [fixture.canonicalWire, fixture.linkedCanonicalWire]) {
      const before = JSON.stringify(row);
      const reader = createSqliteHistoryReader({ stateDir: '/synthetic-state', env: {}, native: {
        resolveOwner: () => fixture.sessionKey,
        readStats: () => ({ eventCount: 1, maxSeq: 1, sizeBytes: 1000 }),
        readRevision: () => ({ generation: 'fixture-revision', maxSeq: 1 }),
        readPage: async params => {
          assert.equal(params.ignoreCliSessionImports, true);
          assert.equal(params.entry, undefined);
          assert.equal(params.canonicalKey, fixture.sessionKey);
          assert.equal(params.sessionId, fixture.sessionId);
          return { messages: [row], pagination: { offset: 0, totalMessages: 1, rawPageMessages: 1 } };
        },
        enrich: rows => rows, replaceOversized: ({ messages }) => ({ messages }),
        capBytes: rows => ({ items: rows }), nextOffset: () => 1,
        replayOldest: () => false, compose: rows => rows,
      } });
      try {
        const result = await reader.readPage({ agentId: 'main', stableSessionKey: fixture.sessionKey,
          sessionId: fixture.sessionId, offset: 0, limit: 16 });
        assert.deepEqual(result.messages, [row]);
        assert.equal(JSON.stringify(row), before);
      } finally { reader.dispose(); }
    }
  });
} else {
  const root = process.env.VIMICATE_PROMPT_IDENTITY_FIXTURE;
  assert.ok(root && target);
  const version = JSON.parse(await fs.readFile(path.join(target, 'package.json'), 'utf8')).version;
  assert.equal(version, '2026.10.5', 'investigation contract, not a wildcard compatibility profile');
  const dist = path.join(target, 'dist');
  const files = await fs.readdir(dist);
  const candidates = [];
  for (const name of files.filter(name => /^cli-session-history-[^.]+\.mjs$/.test(name))) {
    if ((await fs.readFile(path.join(dist, name), 'utf8')).includes('export { prepareCliSessionHistoryReader,')) candidates.push(name);
  }
  assert.equal(candidates.length, 1);
  const { prepareCliSessionHistoryReader: prepare } = await import(pathToFileURL(path.join(dist, candidates[0])));
  const fixture = JSON.parse(await fs.readFile(new URL('../../fixtures/openclaw/unlinked-prompt-identity.json', import.meta.url), 'utf8'));
  const { cliSessionId, sessionId, sessionKey } = fixture;
  const project = path.join(root, '.claude/projects/synthetic');
  await fs.mkdir(project, { recursive: true });
  const filename = path.join(project, `${cliSessionId}.jsonl`);
  const time = fixture.canonicalWire.timestamp;
  function local(index, delta = 0, identity) {
    return { role: 'user', content: 'Synthetic repeat', timestamp: time + index * 1000 + delta,
      idempotencyKey: `submission-${index}:user`, __openclaw: { id: `canonical-${index}`, seq: index + 1,
        transcriptPosition: { source: 'sqlite-fixture', rawSeq: index + 1 }, ...identity } };
  }
  function imported(index, includeUuid = true) {
    return { type: 'user', message: { role: 'user', content: 'Synthetic repeat' },
      timestamp: new Date(time + index * 1000).toISOString(), ...(includeUuid ? { uuid: `native-${index}` } : {}) };
  }
  async function run(locals, imports) {
    const bytes = imports.map(row => JSON.stringify(row)).join('\n') + '\n';
    await fs.writeFile(filename, bytes);
    const before = JSON.stringify(locals);
    const params = { entry: { cliSessionBindings: { 'claude-cli': { sessionId: cliSessionId } } },
      provider: 'claude-cli', sessionId, canonicalKey: sessionKey, sessionAgentId: 'main',
      storePath: path.join(root, 'agents/main/sessions/sessions.json'), cliHistoryHomeDir: root,
      cliHistoryRedaction: { policyToken: 1, patterns: [], registryRevision: 0, registeredSecretValues: [] } };
    let reads = 0;
    const readers = { readSessionMessagesPageWithStatsAsync: async (scope, options) => {
      reads++;
      assert.equal(scope.sessionKey, sessionKey); assert.equal(scope.sessionId, sessionId);
      assert.equal(options.readOnly, true);
      const rows = locals.filter(row => options.beforeSeq === undefined || row.__openclaw.seq < options.beforeSeq)
        .slice(-options.maxMessages);
      return { messages: rows, displaySource: 'sqlite-fixture', transcriptSource: 'archive',
        readWindow: { source: 'sqlite-fixture', latestResetRawSeq: null } };
    } };
    assert.equal(await prepare({ ...params, entry: {} }, readers), undefined);
    assert.equal(await prepare({ ...params, sessionId: undefined }, readers), undefined);
    assert.equal(await prepare({ ...params, cliHistoryHomeDir: path.join(root, 'absent-home') }, readers), undefined);
    assert.equal(reads, 0);
    const owner = await prepare(params, readers);
    assert.ok(owner);
    try {
      const page = await owner.readers.readSessionMessagesPageWithStatsAsync({}, { maxMessages: 20 });
      // A selected page is enriched from the complete index, not page-local text matching.
      const partial = await owner.readers.readSessionMessagesPageWithStatsAsync({}, { maxMessages: 1 });
      assert.deepEqual(partial.messages, page.messages.slice(-1));
      const previousReads = reads;
      assert.equal(await prepare({ ...params, ignoreCliSessionImports: true }, readers), undefined);
      assert.equal(reads, previousReads);
      assert.equal(JSON.stringify(locals), before);
      assert.equal(await fs.readFile(filename, 'utf8'), bytes);
      return page.messages;
    } finally { owner.dispose(); }
  }
  assert.deepEqual(local(0), fixture.canonicalWire);
  assert.deepEqual(imported(0), fixture.importedEntry);
  const nativeOnly = await run([], [fixture.importedEntry]);
  assert.deepEqual(nativeOnly, [fixture.nativeWire]);
  const linked = await run([fixture.canonicalWire], [fixture.importedEntry]);
  assert.deepEqual(linked, [fixture.linkedCanonicalWire]);
  assert.equal(linked.length, 1);
  assert.equal(linked[0].idempotencyKey, 'submission-0:user');
  assert.deepEqual(linked[0].__openclaw, { ...local(0).__openclaw,
    importedFrom: 'claude-cli', cliSessionId, externalId: 'native-0' });
  const unlinked = await run([local(0, 300001)], [imported(0)]);
  assert.equal(unlinked.length, 2);
  assert.equal(unlinked.find(row => row.idempotencyKey)?.__openclaw.externalId, undefined);
  assert.equal(unlinked.find(row => !row.idempotencyKey)?.__openclaw.externalId, 'native-0');
  const repeated = await run([local(0), local(1)], [imported(0), imported(1)]);
  assert.deepEqual(repeated.map(row => row.idempotencyKey), ['submission-0:user', 'submission-1:user']);
  assert.deepEqual(repeated.map(row => row.__openclaw.externalId), ['native-0', 'native-1']);
  const missing = await run([local(0, 300001)], [imported(0, false)]);
  assert.equal(missing.length, 2);
  assert.equal(missing.some(row => row.__openclaw.externalId), false);
  const explicit = await run([local(0, 300001, { importedFrom: 'claude-cli', cliSessionId, externalId: 'native-0' })], [imported(0)]);
  assert.equal(explicit.length, 1);
  assert.equal(explicit[0].idempotencyKey, 'submission-0:user');
  console.log(JSON.stringify({ linkedBeforeAggregate: true, unlinkedOutsideWindow: true,
    repeatedSubmissions: 2, missingUuidUnlinked: true, explicitIdentityOutsideWindow: true,
    ignoredImports: true, unchangedInputs: true }));
}
