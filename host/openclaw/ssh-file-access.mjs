import fs from 'node:fs';
import { execFile } from 'node:child_process';
import { check, failure } from './project-file-primitives.mjs';

const encodedModule = source => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;

/** Only owner-registered SSH aliases and packaged, read-only code reach the remote shell.
 * Requests are JS string literals on stdin, never shell command interpolation.
 * No remote install, mount, service, credentials or source cache is created.
 */
export function createSshFileAccess({ launch = execFile, timeoutMs = 18000 } = {}) {
  const primitives = encodedModule(fs.readFileSync(new URL('./project-file-primitives.mjs', import.meta.url), 'utf8'));
  const access = encodedModule(fs.readFileSync(new URL('./project-file-access.mjs', import.meta.url), 'utf8')
    .replace("'./project-file-primitives.mjs'", JSON.stringify(primitives)));
  const materialize = encodedModule(fs.readFileSync(new URL('./icloud-materialize.mjs', import.meta.url), 'utf8'));
  const children = new Set();
  let disposed = false;
  return {
    run(host, rootPath, method, params) {
      check(!disposed, 'file access stopped');
      check(typeof host === 'string' && /^[A-Za-z0-9][A-Za-z0-9.-]{0,63}$/u.test(host), 'invalid registered host');
      check(['list', 'read', 'resolve', 'exportChunk'].includes(method), 'invalid file operation');
      check(children.size < 2, 'remote file access is busy; try again');
      const input = JSON.stringify({ rootPath, method, params });
      const script = `import { createRootAccess } from ${JSON.stringify(access)};
import { readWithICloudMaterialization } from ${JSON.stringify(materialize)};
try {
  const request = JSON.parse(${JSON.stringify(input)});
  const read = () => createRootAccess(request.rootPath)[request.method](request.params);
  const value = ['read', 'exportChunk'].includes(request.method) ? await readWithICloudMaterialization(read, { waitMs: 6000 }) : read();
  process.stdout.write(JSON.stringify({ ok: true, value }));
} catch (error) {
  process.stdout.write(JSON.stringify({ ok: false, message: error.message }));
}
`;
      return new Promise((resolve, reject) => {
        const child = launch('ssh', ['-T', '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes',
          '-o', 'ConnectTimeout=5', '-o', 'ConnectionAttempts=1', '--', host,
          'PATH=/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin node --input-type=module'],
        { encoding: 'utf8', timeout: timeoutMs, maxBuffer: 12 * 1024 * 1024, killSignal: 'SIGKILL' },
        (error, stdout) => {
          children.delete(child);
          if (disposed) return reject(failure('file access stopped'));
          if (error) return reject(failure(`host ${host} is unavailable or the file request timed out`));
          try {
            const result = JSON.parse(stdout);
            check(result?.ok === true || result?.ok === false, 'invalid remote file response');
            if (!result.ok) throw failure(`host ${host}: ${typeof result.message === 'string' ? result.message.slice(0, 512) : 'file access failed'}`);
            resolve(result.value);
          } catch (error) { reject(error); }
        });
        children.add(child);
        child.stdin.on('error', () => { /* completion reports a closed remote pipe */ });
        child.stdin.end(script);
      });
    },
    dispose() { disposed = true; for (const child of children) child.kill('SIGKILL'); children.clear(); },
  };
}
