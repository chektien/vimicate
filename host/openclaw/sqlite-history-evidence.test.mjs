import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { zstdCompressSync } from 'node:zlib';
import { readSqliteArchiveEvidence, readSqliteNativeSegments } from './sqlite-history-evidence.mjs';

const id = '00000000-0000-4000-a000-000000000127', sessionKey = 'agent:main:fixture';
async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vimicate-sqlite-evidence-'));
  const stateDir = await fs.realpath(root);
  t.after(() => fs.rm(stateDir, { recursive: true, force: true }));
  const dir = path.join(stateDir, 'agents/main/agent'); await fs.mkdir(dir, { recursive: true });
  const filename = path.join(dir, 'openclaw-agent.sqlite');
  const db = new DatabaseSync(filename);
  db.exec('CREATE TABLE session_windows(session_id TEXT PRIMARY KEY, session_key TEXT); CREATE TABLE transcript_events(session_id TEXT, seq INTEGER, event_json TEXT, event_zstd BLOB, event_utf8_bytes INTEGER);');
  db.prepare('INSERT INTO session_windows VALUES (?, ?)').run(id, sessionKey);
  const records = [{ type: 'session', id }, { type: 'message', text: '🦉 中文' }];
  records.forEach((event, seq) => insertEvent(db, id, seq, event));
  db.close();
  return { scope: { stateDir, agentId: 'main', sessionKey, sessionId: id }, filename, records };
}
function insertEvent(db, sessionId, seq, event, compressed = false) {
  const json = JSON.stringify(event);
  db.prepare('INSERT INTO transcript_events VALUES (?, ?, ?, ?, ?)').run(sessionId, seq,
    compressed ? null : json, compressed ? zstdCompressSync(Buffer.from(json)) : null, Buffer.byteLength(json));
}
test('fixed read-only evidence returns exact zero-based UTF-8 records without DB mutation', async t => {
  const { scope, filename, records } = await fixture(t);
  const before = await fs.readFile(filename);
  const evidence = readSqliteArchiveEvidence(scope, true);
  assert.deepEqual(evidence.records, records.map((event, seq) => ({ seq, event })));
  assert.deepEqual({ ...evidence.stats }, { eventCount: 2, maxSeq: 1,
    sizeBytes: records.reduce((n, r) => n + Buffer.byteLength(JSON.stringify(r)), 0) + 1 });
  assert.deepEqual(await fs.readFile(filename), before);
  assert.deepEqual(readSqliteArchiveEvidence({ ...scope, sessionKey: 'agent:main:foreign' }, true).records, []);
});
test('legacy uncompressed schema retains its scoped evidence contract', async t => {
  const { scope, filename, records } = await fixture(t);
  const db = new DatabaseSync(filename);
  db.exec('ALTER TABLE transcript_events DROP COLUMN event_zstd; ALTER TABLE transcript_events DROP COLUMN event_utf8_bytes');
  db.close();
  const evidence = readSqliteArchiveEvidence(scope, true);
  assert.deepEqual(evidence.records, records.map((event, seq) => ({ seq, event })));
  assert.equal(evidence.stats.sizeBytes, records.reduce((n, event) => n + Buffer.byteLength(JSON.stringify(event)), 1));
});
test('refuses path escapes, symlinks and a missing database without creating one', async t => {
  const { scope, filename } = await fixture(t);
  assert.throws(() => readSqliteArchiveEvidence({ ...scope, agentId: '../main' }));
  assert.throws(() => readSqliteArchiveEvidence({ ...scope, agentId: 'other', sessionKey: 'agent:other:fixture' }));
  await assert.rejects(fs.stat(path.join(scope.stateDir, 'agents/other')));
  await fs.rename(filename, filename + '.retained'); await fs.symlink(filename + '.retained', filename);
  assert.throws(() => readSqliteArchiveEvidence(scope), /path is not fixed/);
});

test('native ancestry suppresses a proven copied prefix but keeps disjoint predecessors', async t => {
  const { scope, filename } = await fixture(t);
  const next = '00000000-0000-4000-a000-000000000109';
  const db = new DatabaseSync(filename);
  db.exec('ALTER TABLE session_windows ADD COLUMN previous_session_id TEXT');
  db.prepare('INSERT INTO session_windows VALUES (?, ?, ?)').run(next, sessionKey, id);
  db.prepare('INSERT INTO transcript_events SELECT ?, seq, event_json, event_zstd, event_utf8_bytes FROM transcript_events WHERE session_id=?').run(next, id);
  db.close();
  const before = await fs.readFile(filename);
  assert.deepEqual(readSqliteNativeSegments({ ...scope, sessionId: next }, id), []);
  assert.deepEqual(await fs.readFile(filename), before);
  const edit = new DatabaseSync(filename);
  edit.prepare('DELETE FROM transcript_events WHERE session_id=?').run(next);
  insertEvent(edit, next, 0, { type: 'session', id: next });
  edit.close();
  assert.deepEqual(readSqliteNativeSegments({ ...scope, sessionId: next }, id), [id]);
});

test('native ancestry rejects partial overlap, foreign routes, missing anchors and cycles', async t => {
  const { scope, filename } = await fixture(t);
  const next = '00000000-0000-4000-a000-000000000109';
  const db = new DatabaseSync(filename);
  db.exec('ALTER TABLE session_windows ADD COLUMN previous_session_id TEXT');
  const original = JSON.stringify({ type: 'message', id: 'same', text: 'original' });
  db.prepare('UPDATE transcript_events SET event_json=?, event_utf8_bytes=? WHERE session_id=? AND seq=1').run(original, Buffer.byteLength(original), id);
  db.prepare('INSERT INTO session_windows VALUES (?, ?, ?)').run(next, sessionKey, id);
  insertEvent(db, next, 1, { type: 'message', id: 'same', text: 'changed' });
  db.close();
  const nextScope = { ...scope, sessionId: next };
  assert.throws(() => readSqliteNativeSegments(nextScope, id), /partial overlap/);
  const edit = new DatabaseSync(filename);
  edit.prepare('DELETE FROM transcript_events WHERE session_id=?').run(next);
  edit.prepare('UPDATE session_windows SET session_key=? WHERE session_id=?').run('agent:main:foreign', id);
  assert.throws(() => readSqliteNativeSegments(nextScope, id), /another route/);
  edit.prepare('UPDATE session_windows SET session_key=? WHERE session_id=?').run(sessionKey, id);
  assert.throws(() => readSqliteNativeSegments(nextScope, '00000000-0000-4000-a000-000000000165'), /anchor changed/);
  edit.prepare('UPDATE session_windows SET previous_session_id=? WHERE session_id=?').run(next, id);
  assert.throws(() => readSqliteNativeSegments(nextScope), /cycle/);
  edit.close();
});

test('mixed storage preserves archive stats, records and native copied-prefix proof', async t => {
  const { scope, filename, records } = await fixture(t);
  const next = '00000000-0000-4000-a000-000000000109';
  const db = new DatabaseSync(filename);
  db.exec('ALTER TABLE session_windows ADD COLUMN previous_session_id TEXT');
  db.prepare('DELETE FROM transcript_events WHERE session_id=? AND seq=1').run(id);
  insertEvent(db, id, 1, records[1], true);
  db.prepare('INSERT INTO session_windows VALUES (?, ?, ?)').run(next, sessionKey, id);
  insertEvent(db, next, 0, { type: 'session', id: next }, true);
  insertEvent(db, next, 1, records[1]);
  db.close();
  const evidence = readSqliteArchiveEvidence(scope, true);
  assert.deepEqual(evidence.records, records.map((event, seq) => ({ seq, event })));
  assert.equal(evidence.stats.sizeBytes, records.reduce((n, r) => n + Buffer.byteLength(JSON.stringify(r)), 1));
  assert.deepEqual(readSqliteNativeSegments({ ...scope, sessionId: next }, id), []);
});

test('compressed native overlap is rejected and disjoint predecessor retained', async t => {
  const { scope, filename } = await fixture(t);
  const next = '00000000-0000-4000-a000-000000000109';
  const db = new DatabaseSync(filename);
  db.exec('ALTER TABLE session_windows ADD COLUMN previous_session_id TEXT');
  db.prepare('DELETE FROM transcript_events WHERE session_id=? AND seq=1').run(id);
  insertEvent(db, id, 1, { type: 'message', id: 'same', text: 'original' }, true);
  db.prepare('INSERT INTO session_windows VALUES (?, ?, ?)').run(next, sessionKey, id);
  insertEvent(db, next, 1, { type: 'message', id: 'same', text: 'changed' }, true);
  db.close();
  assert.throws(() => readSqliteNativeSegments({ ...scope, sessionId: next }, id), /partial overlap/);
  const edit = new DatabaseSync(filename);
  edit.prepare('DELETE FROM transcript_events WHERE session_id=?').run(next);
  insertEvent(edit, next, 0, { type: 'session', id: next }, true);
  edit.close();
  assert.deepEqual(readSqliteNativeSegments({ ...scope, sessionId: next }, id), [id]);
});

test('invalid decoded length or missing byte metadata fails closed', async t => {
  const { scope, filename } = await fixture(t);
  const db = new DatabaseSync(filename);
  const json = JSON.stringify({ type: 'message', text: '🦉 中文' });
  db.prepare('UPDATE transcript_events SET event_json=NULL, event_zstd=?, event_utf8_bytes=? WHERE session_id=? AND seq=1')
    .run(zstdCompressSync(Buffer.from(json)), Buffer.byteLength(json) + 1, id);
  assert.throws(() => readSqliteArchiveEvidence(scope, true), /invalid transcript event storage/);
  db.prepare('UPDATE transcript_events SET event_utf8_bytes=NULL WHERE session_id=? AND seq=1').run(id);
  assert.throws(() => readSqliteArchiveEvidence(scope), /invalid transcript event storage/);
  db.close();
});
