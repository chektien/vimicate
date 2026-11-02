import assert from 'node:assert/strict';
import test from 'node:test';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { Worker } from 'node:worker_threads';
import { fork } from 'node:child_process';
import { awaitArchiveFixture } from './test-support/archive-fixture-lifecycle.mjs';

function fixture(t) {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  let stops = 0;
  const result = awaitArchiveFixture(child, { label: 'fixture', startupMs: 200,
    operationMs: 30, closedEvent: 'close', stop: () => { stops++; } });
  return { child, result, stops: () => stops };
}

test('slow initialization receives its own bound, then paging/disposal gets a fresh bound', async t => {
  const { child, result, stops } = fixture(t);
  // Exceeds the former combined 90-unit budget, without extending read latency.
  t.mock.timers.tick(120);
  assert.equal(stops(), 0);
  child.emit('message', { type: 'archive-reader-ready' });
  t.mock.timers.tick(29);
  child.stdout.write('fixture result');
  child.emit('close', 0, null);
  assert.equal((await result).stdout, 'fixture result');
  t.mock.timers.tick(500);
  assert.equal(stops(), 0, 'terminal success retires its timer');
});

test('initialization timeout retains diagnostics and waits for actual child exit', async t => {
  const { child, result, stops } = fixture(t);
  let settled = false;
  const checked = assert.rejects(result, /initialization timed out.*\nlast startup stage/s).finally(() => { settled = true; });
  child.stderr.write('last startup stage');
  t.mock.timers.tick(200);
  await Promise.resolve();
  assert.equal(stops(), 1);
  assert.equal(settled, false, 'termination request is not disposal');
  child.emit('message', { type: 'archive-reader-ready' });
  child.emit('close', null, 'SIGKILL');
  await checked;
});

test('paging/disposal stalls fail even after successful initialization', async t => {
  const { child, result, stops } = fixture(t);
  const checked = assert.rejects(result, /paging\/disposal timed out after 30ms/);
  child.emit('message', { type: 'archive-reader-ready' });
  t.mock.timers.tick(30);
  assert.equal(stops(), 1);
  child.emit('close', 1, null);
  await checked;
});

test('duplicate readiness cannot renew the operation deadline', async t => {
  const { child, result, stops } = fixture(t);
  const checked = assert.rejects(result, /duplicate reader readiness/);
  child.emit('message', { type: 'archive-reader-ready' });
  t.mock.timers.tick(20);
  child.emit('message', { type: 'archive-reader-ready' });
  assert.equal(stops(), 1);
  child.emit('close', 1, null);
  await checked;
});

test('zero exit without reader readiness is not acceptance', async t => {
  const { child, result } = fixture(t);
  child.emit('close', 0, null);
  await assert.rejects(result, /ready=false/);
});

test('real process and worker stalls are terminated before rejection', async t => {
  for (const mode of ['process', 'worker']) await t.test(mode, async () => {
    const url = new URL('./test-support/archive-fixture-stall.mjs', import.meta.url);
    const child = mode === 'worker' ? new Worker(url, { stdout: true, stderr: true })
      : fork(url, [], { execArgv: [], stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
    const result = awaitArchiveFixture(child, { label: mode, startupMs: 5000, operationMs: 20,
      closedEvent: mode === 'worker' ? 'exit' : 'close',
      stop: () => mode === 'worker' ? child.terminate() : child.kill('SIGKILL') });
    await assert.rejects(result, /paging\/disposal timed out/);
    if (mode === 'worker') assert.equal(child.threadId, -1);
    else assert.equal(child.signalCode, 'SIGKILL');
  });
});
