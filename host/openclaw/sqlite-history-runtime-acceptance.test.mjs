import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { Worker, isMainThread } from 'node:worker_threads';

import test from 'node:test';
import os from 'node:os';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import { buildSqlitePlugin } from './build-sqlite-plugin.mjs';

const exec = promisify(execFile);
const target = process.env.OPENCLAW_HISTORY_TEST_PACKAGE_ROOT;
const fixtures = {
  '2026.9.8': { accessor: 'session-accessor-CbRJM5Iy.mjs', loader: 'plugin-setup-module-CbcpILjg.mjs', entrypoints: 'runtime-process-entrypoints-CbWx0yUe.mjs' },
  '2026.10.5': { accessor: 'session-accessor-ripvAz_n.mjs', loader: 'plugin-setup-module-ivVK8RSf.mjs', entrypoints: 'runtime-process-entrypoints-De68tE_W.mjs' },
  '2026.10.6': { accessor: 'session-accessor-6sSzHMY-.mjs', loader: 'plugin-setup-module-BtgPcZxn.mjs', entrypoints: 'runtime-process-entrypoints-De68tE_W.mjs' },
  '2026.10.4': { accessor: 'session-accessor-C2axcAVZ.mjs', loader: 'plugin-setup-module-CeetwhwH.mjs', entrypoints: 'runtime-process-entrypoints-Dgz2IR4T.mjs' },
  '2026.10.2': { accessor: 'session-accessor-Ba0RADzo.mjs', loader: 'plugin-setup-module-B1butL8C.mjs', entrypoints: 'runtime-process-entrypoints-Dgz2IR4T.mjs' },
  '2026.9.9': { accessor: 'session-accessor-CiKKTlbe.mjs', loader: 'plugin-setup-module-D0o6Vfcg.mjs', entrypoints: 'runtime-process-entrypoints-Bh4reDp0.mjs' },
};
const isChild = process.env.VIMICATE_NATIVE_ACCEPTANCE_CHILD === '1';
if (!isChild) {
  test('exact audited 9.8/9.9/10.2/10.4/10.5/10.6 archived mixed-storage pages finish under native and captured plugin loading without writes',
    { skip: !target }, async t => {
      const metadata = JSON.parse(await fs.readFile(path.join(target, 'package.json'), 'utf8'));
      const fixture = fixtures[metadata.version];
      if (!fixture) return t.skip('exact 9.8/9.9/10.2/10.4/10.5 fixture contract');
      const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'vimicate-native-history-')));
      t.after(() => fs.rm(root, { recursive: true, force: true }));
      const plugin = path.join(root, 'plugin');
      await buildSqlitePlugin(plugin);
      // Fixture-only probe observes the captured entrypoint namespace, without
      // adding a production testing API to the adapter or packaged candidate.
      await fs.writeFile(path.join(plugin, 'probe.mjs'),
        `import { randomUUID } from 'node:crypto'; export const captureIdentity = randomUUID();\nexport { n as entries } from ${JSON.stringify(pathToFileURL(path.join(target,
          `dist/${fixture.entrypoints}`)).href)};\n`);
      const modes = ['2026.10.4', '2026.10.5', '2026.10.6'].includes(metadata.version) ? ['native', 'capture', 'worker-capture'] : ['native', 'capture'];
      for (const mode of modes) {
        const captured = mode !== 'native';
        const stateDir = path.join(root, `${mode}-state`);
        await fs.mkdir(stateDir, { mode: 0o700 });
        const env = { ...process.env, VIMICATE_NATIVE_ACCEPTANCE_CHILD: '1',
          VIMICATE_NATIVE_ACCEPTANCE_STATE: stateDir,
          HISTORY_CAPTURE_PLUGIN_ROOT: captured ? plugin : '' };
        let stdout;
        if (mode === 'worker-capture') {
          // 10.4 retains native ESM captures only inside plugin workers. A
          // main-thread capture alone does not exercise that upgrade boundary.
          const worker = new Worker(new URL(import.meta.url), { env,
            workerData: { sourceCaptureDirectory: root }, stdout: true, stderr: true });
          let output = '', errors = '';
          worker.stdout.on('data', data => { output += data; });
          worker.stderr.on('data', data => { errors += data; });
          await new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
              void worker.terminate(); reject(new Error('captured plugin worker timed out'));
            }, 90000);
            worker.once('error', error => { clearTimeout(timer); reject(error); });
            worker.once('exit', code => {
              clearTimeout(timer);
              if (code) reject(new Error(`captured plugin worker exited ${code}: ${errors}`));
              else resolve();
            });
          });
          stdout = output;
        } else {
          ({ stdout } = await exec(process.execPath, [fileURLToPath(import.meta.url)], {
            timeout: ['2026.10.2', '2026.10.4', '2026.10.5', '2026.10.6'].includes(metadata.version) && captured ? 90000 : 30000, env,
          }));
        }
        const reports = stdout.split('\n').filter(line => line.startsWith('{'));
        assert.equal(reports.length, 1);
        const result = JSON.parse(reports[0]);
        assert.deepEqual(result.pages.map(page => page.offset), [0, 2, 4, 6, 8]);
        assert.equal(result.pages.at(-1).hasMore, false);
        assert.equal(result.messageCount, 9);
        assert.equal(result.mixedStorage, true);
        assert.equal(result.archivedGeneration, true);
        assert.equal(result.unchangedDatabase, true);
        assert.equal(result.captured, captured);
        assert.equal(result.retainedCaptureReload, mode === 'worker-capture');
        assert.equal(result.decodedBytesChecked, true);
        assert.equal(result.malformedStorageRejected, true);
        console.log(JSON.stringify({ packageVersion: metadata.version, mode, ...result }));
      }
    });
} else {
  const packageRoot = process.env.OPENCLAW_HISTORY_TEST_PACKAGE_ROOT;
  const version = JSON.parse(await fs.readFile(path.join(packageRoot, 'package.json'), 'utf8')).version;
  const fixture = fixtures[version];
  const fixtureRoot = process.env.VIMICATE_NATIVE_ACCEPTANCE_STATE;
  process.env.OPENCLAW_STATE_DIR = fixtureRoot;
  process.env.OPENCLAW_CONFIG_PATH = path.join(fixtureRoot, 'openclaw.json');
  await fs.writeFile(process.env.OPENCLAW_CONFIG_PATH, '{}');
  const native = await import(pathToFileURL(path.join(packageRoot, `dist/${fixture.accessor}`)));
  const scope = { agentId: 'main', sessionKey: 'agent:main:fixture',
    sessionId: '00000000-0000-4000-a000-000000000127',
    storePath: path.join(fixtureRoot, 'agents/main/sessions/sessions.json'), env: process.env };
  native.replaceSessionEntrySync(scope, { sessionId: scope.sessionId, updatedAt: 1700000000000 });
  for (let i = 0; i < 9; i++) {
    const result = native.appendTranscriptMessageSync(scope, { eventId: `fixture-${i}`, now: 1700000000000+i,
      message: { role: i % 2 ? 'assistant' : 'user', content: [{ type: 'text', text: `fixture ${i} 🦉 中文` + (i === 3 ? " repeated".repeat(10000) : "") }],
        ...(['2026.10.5', '2026.10.6'].includes(version) && i === 8 ? { __openclaw: { replyToId: 'fixture-0' } } : {}),
        ...(i % 2 ? { stopReason: 'stop', api: 'openai-responses', provider: 'openai', model: 'fixture' } : {}) } });
    assert.equal(result.ok, true);
  }
  // Retain the nonempty concrete generation as an archive behind a fresh current identity.
  const currentSessionId = '00000000-0000-4000-a000-000000000109';
  native.replaceSessionEntrySync({ ...scope, sessionId: currentSessionId },
    { sessionId: currentSessionId, updatedAt: 1700000000100 });
  const filename = path.join(fixtureRoot, 'agents/main/agent/openclaw-agent.sqlite');
  const db = new DatabaseSync(filename);
  const { readSqliteArchiveEvidence } = await import('./sqlite-history-evidence.mjs');
  const evidenceScope = { stateDir: fixtureRoot, agentId: scope.agentId, sessionKey: scope.sessionKey, sessionId: scope.sessionId };
  const decodedEvidence = readSqliteArchiveEvidence(evidenceScope, true);
  const byteCount = decodedEvidence.records.reduce((sum, row) => sum + Buffer.byteLength(JSON.stringify(row.event)), 0)
    + decodedEvidence.records.length - 1;
  assert.equal(decodedEvidence.stats.sizeBytes, byteCount);
  const encodings = db.prepare('SELECT SUM(event_json IS NOT NULL) AS plain,SUM(event_zstd IS NOT NULL) AS compressed FROM transcript_events').get();
  assert.ok(encodings.plain > 0 && encodings.compressed > 0);
  db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
  db.close();
  const before = await fs.readFile(filename);
  const { loadSqliteHistoryRuntime } = await import('./sqlite-history-runtime.mjs');
  const runtime = await loadSqliteHistoryRuntime(packageRoot);
  let loadSqliteHistoryReader, capturedInstance;
  if (process.env.HISTORY_CAPTURE_PLUGIN_ROOT) {
    const { n: PluginInstance, r: bindPluginInstanceModuleLoader } = await import(pathToFileURL(path.join(packageRoot, `dist/${fixture.loader}`)));
    const instance = new PluginInstance('vimicate-history-family');
    capturedInstance = instance;
    const root = process.env.HISTORY_CAPTURE_PLUGIN_ROOT;
    const source = path.join(root, 'sqlite-history-reader.mjs');
    bindPluginInstanceModuleLoader({ instance, source, rootDir: root, origin: 'global' });
    const loaded = instance.loadModule(source);
    ({ loadSqliteHistoryReader } = loaded);
    if (!isMainThread) {
      const replacement = new PluginInstance('vimicate-history-family');
      bindPluginInstanceModuleLoader({ instance: replacement, source, rootDir: root, origin: 'global' });
      const probe = path.join(root, 'probe.mjs');
      const priorCapture = instance.loadModule(probe).captureIdentity;
      ({ loadSqliteHistoryReader } = replacement.loadModule(source));
      assert.equal(replacement.loadModule(probe).captureIdentity, priorCapture,
        'worker reload retains native ESM evaluation identity');
      assert.equal(replacement.sourceDigest, instance.sourceDigest);
      assert.deepEqual((await instance.dispose()).errors, []);
      assert.throws(() => instance.loadModule(source), /retir|dispos|available/i);
      capturedInstance = replacement;
    }
  } else {
    ({ loadSqliteHistoryReader } = await import('./sqlite-history-reader.mjs'));
  }
  const reader = await loadSqliteHistoryReader({ packageRoot, stateDir: fixtureRoot });
  let offset = 0;
  const pages = [], ids = [];
  for (let guard = 0; guard < 20; guard++) {
    const page = await reader.readPage({ agentId: scope.agentId, stableSessionKey: scope.sessionKey,
      sessionId: scope.sessionId, offset, limit: 2 });
    const direct = await runtime.chat.i({ entry: undefined, provider: '', sessionId: scope.sessionId,
      storePath: scope.storePath, sessionAgentId: scope.agentId, canonicalKey: scope.sessionKey,
      ignoreCliSessionImports: true, max: 2, maxHistoryBytes: 512*1024, effectiveMaxChars: 12000, offset });
    const canonical = runtime.preparePage ? runtime.preparePage(direct, { maxHistoryBytes: 512*1024 }).messages
      : runtime.display.t(runtime.readers._(runtime.chat.c({ messages: runtime.chat.r(direct.messages, undefined),
        maxSingleMessageBytes: 128*1024 }).messages, 512*1024).items);
    const directIds = canonical.map(m=>m.__openclaw?.id);
    assert.deepEqual(page.messages, canonical);
    if (['2026.10.5', '2026.10.6'].includes(version) && offset === 0) {
      const quoted = page.messages.find(message => message.__openclaw?.id === 'fixture-8').__openclaw.replyToMessage;
      assert.equal(quoted.ok, true);
      assert.equal(quoted.message.__openclaw.id, 'fixture-0');
    }
    assert.deepEqual(page.messages.map(m=>m.__openclaw?.id), directIds);
    pages.push({ offset, count: page.messages.length, hasMore: page.hasMore, nextOffset: page.nextOffset });
    ids.push(...directIds);
    if (!page.hasMore) break;
    assert.ok(page.nextOffset > offset);
    offset = page.nextOffset;
  }
  assert.ok(pages.length > 1);
  assert.equal(pages.at(-1).hasMore, false);
  assert.equal(new Set(ids).size, 9);
  assert.equal(ids.length, 9);
  assert.deepEqual(await fs.readFile(filename), before);
  if (capturedInstance) {
    const entrypointsFile = path.join(packageRoot, `dist/${fixture.entrypoints}`);
    const { entries } = capturedInstance.loadModule(path.join(process.env.HISTORY_CAPTURE_PLUGIN_ROOT, 'probe.mjs'));
    assert.equal(entries.sessionTranscript.root, packageRoot);
    assert.notEqual(entries.sessionTranscript.currentModuleUrl, pathToFileURL(entrypointsFile).href);
    const capturedDist = path.dirname(fileURLToPath(entries.sessionTranscript.currentModuleUrl));
    await assert.rejects(fs.access(path.join(capturedDist, entries.sessionTranscript.distWorkerPath)), /ENOENT/);
    await fs.access(path.join(packageRoot, 'dist', entries.sessionTranscript.distWorkerPath));
  }
  // Mutate only the synthetic fixture after read-only acceptance, then prove
  // malformed compressed length is rejected instead of treated as a missing row.
  const malformed = new DatabaseSync(filename);
  malformed.prepare('UPDATE transcript_events SET event_utf8_bytes = event_utf8_bytes + 1 WHERE event_zstd IS NOT NULL').run();
  malformed.close();
  assert.throws(() => readSqliteArchiveEvidence(evidenceScope, true), /invalid transcript event storage/);
  await assert.rejects(reader.readPage({ agentId: scope.agentId, stableSessionKey: scope.sessionKey,
    sessionId: scope.sessionId, offset: 4, limit: 2 }), /payload|length|storage/i);
  console.log(JSON.stringify({ decodedBytesChecked: true, malformedStorageRejected: true, pages, messageCount: ids.length, mixedStorage: true, archivedGeneration: true, unchangedDatabase: true, captured: Boolean(process.env.HISTORY_CAPTURE_PLUGIN_ROOT), retainedCaptureReload: !isMainThread }));
  reader.dispose();
  if (capturedInstance) assert.deepEqual((await capturedInstance.dispose()).errors, []);
  process.exit(0);
}
