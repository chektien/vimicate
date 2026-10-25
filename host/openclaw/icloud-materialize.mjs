import { execFile } from 'node:child_process';

/**
 * Files synced from another Mac can still be iCloud placeholders here, and the
 * Gateway service cannot fault them in itself. Ask iCloud for that one
 * confined file, then retry the read without blocking the event loop.
 */
export async function readWithICloudMaterialization(read, {
  materialize = brctlDownload, waitMs = 12_000, stepMs = 400,
  sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms)), now = () => Date.now(),
} = {}) {
  try { return read(); }
  catch (error) {
    if (!error?.icloudPlaceholder || typeof error.icloudPath !== 'string') throw error;
    await materialize(error.icloudPath);
    const deadline = now() + waitMs;
    for (;;) {
      await sleep(stepMs);
      try { return read(); }
      catch (retry) { if (!retry?.icloudPlaceholder || now() >= deadline) throw retry; }
    }
  }
}

function brctlDownload(file) {
  return new Promise(resolve => execFile('/usr/bin/brctl', ['download', file], { timeout: 5_000 }, () => resolve()));
}
