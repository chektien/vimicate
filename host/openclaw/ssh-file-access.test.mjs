import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createSshFileAccess } from './ssh-file-access.mjs';

function fixture(t, launch) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.homedir(), '.vimicate-ssh-files-')));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const access = createSshFileAccess({ launch }); t.after(() => access.dispose());
  return { root, access };
}

test('executes the exact packaged remote program with request data only on stdin', async t => {
  let received;
  const f = fixture(t, (command, args, options, callback) => {
    received = { command, args, options };
    return execFile(process.execPath, ['--input-type=module'], options, callback);
  });
  const filename = 'literal $(touch injection).md'; fs.writeFileSync(path.join(f.root, filename), 'exact remote bytes');
  const result = await f.access.run('work-mac', f.root, 'read', { projectId: 'example', path: filename });
  assert.equal(result.text, 'exact remote bytes');
  assert.equal(received.command, 'ssh');
  assert.ok(received.args.includes('StrictHostKeyChecking=yes'));
  assert.ok(received.args.includes('BatchMode=yes'));
  assert.equal(received.args.at(-2), 'work-mac');
  assert.equal(received.args.at(-1), 'PATH=/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin node --input-type=module');
  assert.ok(!received.args.some(arg => arg.includes('literal') || arg.includes(f.root)));
  assert.equal(received.options.maxBuffer, 12 * 1024 * 1024);
});

test('remote program preserves confinement and returns no partial result', async t => {
  const f = fixture(t, (_command, _args, options, callback) => execFile(process.execPath, ['--input-type=module'], options, callback));
  fs.symlinkSync('/etc/passwd', path.join(f.root, 'outside.md'));
  await assert.rejects(f.access.run('work-mac', f.root, 'read', { projectId: 'example', path: 'outside.md' }), /escapes/u);
  assert.throws(() => f.access.run('-oProxyCommand=bad', f.root, 'list', {}), /invalid registered host/u);
  assert.throws(() => f.access.run('work-mac', f.root, 'write', {}), /invalid file operation/u);
});

test('limits remote concurrency, kills on disposal and refuses later work', async t => {
  const children = [];
  const f = fixture(t, (_command, _args, options, callback) => {
    const child = execFile(process.execPath, ['-e', 'setTimeout(() => {}, 30000)'], options, callback);
    children.push(child); return child;
  });
  const requests = [f.access.run('work-mac', f.root, 'list', {}), f.access.run('work-mac', f.root, 'list', {})];
  const rejected = requests.map(request => assert.rejects(request, /stopped/u));
  assert.throws(() => f.access.run('work-mac', f.root, 'list', {}), /busy/u);
  f.access.dispose(); await Promise.all(rejected);
  assert.ok(children.every(child => child.killed));
  assert.throws(() => f.access.run('work-mac', f.root, 'list', {}), /stopped/u);
});

test('timeouts report host unavailability without SSH diagnostics or fallback', async t => {
  const access = createSshFileAccess({ timeoutMs: 50,
    launch: (_command, _args, options, callback) => execFile(process.execPath, ['-e', 'setTimeout(() => {}, 30000)'], options, callback) });
  t.after(() => access.dispose());
  await assert.rejects(access.run('work-mac', '/tmp', 'list', {}), /host work-mac is unavailable/u);
});
