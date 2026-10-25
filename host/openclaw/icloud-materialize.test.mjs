import assert from 'node:assert/strict';
import test from 'node:test';
import { readWithICloudMaterialization } from './icloud-materialize.mjs';
import { isICloudPlaceholderError, ICLOUD_DOWNLOADING } from './project-file-primitives.mjs';

const placeholder = () => Object.assign(new Error(`vimicate project files: ${ICLOUD_DOWNLOADING}`), { icloudPlaceholder: true, icloudPath: '/confined/file.pdf' });

test('macOS EDEADLK on an iCloud placeholder is recognised, other read errors are not', () => {
  assert.equal(isICloudPlaceholderError({ code: 'EDEADLK' }), true);
  assert.equal(isICloudPlaceholderError({ errno: -11, code: 'Unknown system error -11' }), true);
  assert.equal(isICloudPlaceholderError({ code: 'EIO', errno: -5 }), false);
});

test('downloads the exact placeholder once, then returns the retried read', async () => {
  const requested = []; let reads = 0; let clock = 0;
  const result = await readWithICloudMaterialization(() => { reads += 1; if (reads < 3) throw placeholder(); return { ok: true }; },
    { materialize: async (file) => { requested.push(file); }, sleep: async (ms) => { clock += ms; }, now: () => clock });
  assert.deepEqual(result, { ok: true });
  assert.deepEqual(requested, ['/confined/file.pdf']);
  assert.equal(reads, 3);
});

test('gives up with the downloading message once the bounded wait is spent', async () => {
  let clock = 0;
  await assert.rejects(readWithICloudMaterialization(() => { throw placeholder(); },
    { materialize: async () => {}, waitMs: 1_000, stepMs: 400, sleep: async (ms) => { clock += ms; }, now: () => clock }),
    (error) => error.message.includes('still downloading from iCloud'));
});

test('other failures are not retried or downloaded', async () => {
  let materialized = false;
  await assert.rejects(readWithICloudMaterialization(() => { throw new Error('vimicate project files: unsupported file type'); },
    { materialize: async () => { materialized = true; } }), /unsupported file type/);
  assert.equal(materialized, false);
});
