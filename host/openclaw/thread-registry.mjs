import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { registryFindThreadIndex, registryMergeThread, registryNormalizedRevision as revision } from './thread-registry-merge.mjs';

const MAX_BYTES = 4 * 1024 * 1024;
const text = value => typeof value === 'string' ? value.trim() : '';
const sha = value => crypto.createHash('sha256').update(value).digest('hex');
function check(value, message) { if (!value) throw new Error(`vimicate registry: ${message}`); }
function object(value) { return value && typeof value === 'object' && !Array.isArray(value); }

// Stock sessions.create can return before the initial run publishes its epoch.
// This exact authority error is raised during validation, before registry writes.
// Do not retry write conflicts, I/O errors, removals or arbitrary RPC failures.
export async function updateThreadRegistryWhenReady(registry, params, signal) {
  for (let attempt = 0; ; attempt++) {
    signal.throwIfAborted();
    try { return registry.update(params); }
    catch (error) {
      if (params?.mode !== 'upsert' || attempt >= 5
        || error?.message !== 'vimicate sqlite history: invalid current lifecycle metadata') throw error;
      await delay(100, undefined, { signal });
    }
  }
}

/** Existing host-current-v1 policy with injected native current-session
 * authority. Neither the plugin nor clients write OpenClaw session rows. */
export function createThreadRegistry({ vimicateDir, readCurrent, readCurrentGenerations, capabilities = () => ({}) }) {
  check(path.isAbsolute(vimicateDir) && fs.realpathSync(vimicateDir) === vimicateDir, 'fixed directory required');
  const root = fs.statSync(vimicateDir);
  check(root.isDirectory() && root.uid === process.getuid(), 'unsafe directory owner');
  let disposed = false;
  function active() {
    check(!disposed, 'service is stopped');
    const stat = fs.lstatSync(vimicateDir);
    check(stat.ino === root.ino && stat.dev === root.dev && !stat.isSymbolicLink(), 'directory replaced');
  }
  function readFile(name, required) {
    active();
    let fd;
    try {
      fd = fs.openSync(path.join(vimicateDir, name), fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
      const stat = fs.fstatSync(fd);
      check(stat.isFile() && stat.nlink === 1 && stat.uid === root.uid && stat.size <= MAX_BYTES, 'unsafe or oversized registry file');
      const body = fs.readFileSync(fd, 'utf8');
      const after = fs.fstatSync(fd);
      check(stat.mtimeMs === after.mtimeMs && stat.size === after.size && Buffer.byteLength(body) <= MAX_BYTES, 'file changed during read');
      return { body, exists: true, sha256: sha(body), mtimeMs: Math.trunc(stat.mtimeMs), byteCount: Buffer.byteLength(body) };
    } catch (error) {
      if (!required && error.code === 'ENOENT') return { body: '', exists: false, sha256: '', mtimeMs: null, byteCount: 0 };
      throw error;
    } finally { if (fd !== undefined) fs.closeSync(fd); }
  }
  function wire(name, field, value) {
    const { body, ...metadata } = value;
    return { path: `~/.vimicate/${name}`, [field]: body, ...metadata };
  }
  function parse(file) {
    const registry = file.exists ? JSON.parse(file.body) : { version: 1, threads: [] };
    check(object(registry) && Array.isArray(registry.threads) && registry.threads.length <= 4096, 'invalid thread registry');
    return registry;
  }
  function hostBinding(existing, key, stamp = true) {
    check(/^agent:[A-Za-z0-9_-]+:[^\r\n]+$/.test(key) && key.length <= 1024, 'invalid stable session key');
    const current = readCurrent(key);
    check(current?.sessionId && Number.isSafeInteger(current.sessionStartedAtMs) && current.sessionStartedAtMs > 0, 'current OpenClaw session is unavailable');
    return { ...(existing ?? { backend: 'openclaw', state: 'current' }), stableSessionKey: key,
      sessionID: current.sessionId, sessionStartedAtSeconds: current.sessionStartedAtMs / 1000,
      ...(stamp && existing?.sessionID !== current.sessionId ? { sessionIDUpdatedAtSeconds: Math.max(Date.now() / 1000, (revision(existing?.sessionIDUpdatedAtSeconds) ?? 0) + 0.000001), sessionIDRevisionTieBreaker: null } : {}) };
  }
  function withBinding(entry, binding) {
    const bindings = (entry.bindings ?? []).map(prior => prior.stableSessionKey === binding.stableSessionKey
      ? { ...binding } : prior.state === 'current' ? { ...prior, state: 'superseded' } : prior);
    if (!bindings.some(prior => prior.stableSessionKey === binding.stableSessionKey)) bindings.push({ ...binding });
    return { ...entry, currentBinding: binding, bindings };
  }
  function upsert(incoming, existing) {
    const proposed = incoming.currentBinding, prior = existing?.currentBinding;
    const newerRecreation = existing?.state === 'removed' && revision(incoming.explicitlyCreatedAtSeconds) !== null
      && incoming.explicitlyCreatedAtSeconds > Math.max(revision(existing.removedAtSeconds) ?? -Infinity, revision(existing.explicitlyCreatedAtSeconds) ?? -Infinity);
    check(proposed?.backend === 'openclaw' && text(proposed.stableSessionKey), 'upsert requires an exact OpenClaw current binding');
    check(prior?.backend !== 'openclaw' || newerRecreation || proposed.stableSessionKey === prior.stableSessionKey, 'upsert cannot reassign an existing OpenClaw binding');
    check(existing?.state !== 'removed' || newerRecreation, 'removed thread requires explicit newer recreation');
    const established = prior?.backend === 'openclaw' && !newerRecreation ? prior : proposed;
    return withBinding(incoming, hostBinding(established, text(established.stableSessionKey)));
  }
  function read(params = {}) {
    const projects = readFile('projects.md', true);
    let threads = null;
    if (params.includeThreads !== false) {
      const file = readFile('threads.json', false), registry = parse(file);
      // Read-time projection repairs no files and never revives removed entries.
      registry.threads = registry.threads.map(entry => {
        if (entry.state !== 'active' || entry.currentBinding?.backend !== 'openclaw') return entry;
        const key = text(entry.currentBinding.stableSessionKey);
        if (!readCurrent(key)) return entry;
        return withBinding(entry, hostBinding(entry.currentBinding, key, false));
      });
      const body = file.exists ? JSON.stringify(registry) : '';
      threads = wire('threads.json', 'json', { ...file, body, sha256: file.exists ? sha(body) : '', byteCount: Buffer.byteLength(body) });
    }
    return { schemaVersion: 2, capabilities: { threadSessionReconcile: 'host-current-v1', threadRegistryProbe: 'nonmutating-v1', ...capabilities() },
      projects: wire('projects.md', 'markdown', projects), threads,
      ...(readCurrentGenerations ? { currentSessionGenerations: readCurrentGenerations() } : {}) };
  }
  function update(params) {
    active();
    check(params?.contract === 'host-current-v1', 'contract must be host-current-v1');
    const { mode, entries } = params;
    check(['probe', 'remove', 'upsert', 'reconcileCurrentSession'].includes(mode) && Array.isArray(entries) && entries.length <= 128
      && (mode === 'probe' ? entries.length === 0 : entries.length > 0)
      && (mode !== 'reconcileCurrentSession' || entries.length === 1), 'invalid mutation mode or bounds');
    check(Buffer.byteLength(JSON.stringify(params)) <= MAX_BYTES, 'mutation is oversized');
    const file = readFile('threads.json', false), registry = parse(file);
    let changed = false;
    for (const entry of entries) {
      check(object(entry) && text(entry.threadID) && text(entry.threadID).length <= 1024
        && (!entry.bindings || Array.isArray(entry.bindings) && entry.bindings.length <= 128), 'invalid thread entry');
      if (mode === 'reconcileCurrentSession') {
        const index = registry.threads.findIndex(prior => prior.threadID === entry.threadID && prior.currentBinding?.stableSessionKey === entry.currentBinding?.stableSessionKey);
        check(index >= 0 && registry.threads[index].state === 'active', 'active thread binding not found');
        const prior = registry.threads[index];
        const next = withBinding(prior, hostBinding(prior.currentBinding, prior.currentBinding.stableSessionKey));
        changed = JSON.stringify(prior) !== JSON.stringify(next); registry.threads[index] = next;
      } else {
        let incoming = { ...entry, state: mode === 'remove' ? 'removed' : 'active' };
        const index = registryFindThreadIndex(registry.threads, incoming, mode), prior = index >= 0 ? registry.threads[index] : null;
        if (mode === 'upsert') incoming = upsert(incoming, prior);
        let merged = prior ? registryMergeThread(prior, incoming, mode) : incoming;
        if (mode === 'upsert') merged = withBinding(merged, incoming.currentBinding);
        if (index >= 0) registry.threads[index] = merged; else registry.threads.push(merged);
        changed = true;
      }
    }
    check(registry.threads.length <= 4096, 'thread registry count exceeded');
    const body = JSON.stringify(registry, null, 2) + '\n';
    check(Buffer.byteLength(body) <= MAX_BYTES, 'thread registry bytes exceeded');
    if (changed) {
      check(readFile('threads.json', false).sha256 === file.sha256, 'concurrent thread registry change');
      const destination = path.join(vimicateDir, 'threads.json');
      const temporary = destination + '.' + crypto.randomUUID() + '.tmp';
      try {
        const fd = fs.openSync(temporary, 'wx', 0o600);
        try { fs.writeFileSync(fd, body); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
        active(); fs.renameSync(temporary, destination);
        const fdDir = fs.openSync(vimicateDir, 'r'); try { fs.fsyncSync(fdDir); } finally { fs.closeSync(fdDir); }
      } finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
    }
    return { schemaVersion: 2, contract: 'host-current-v1', outcome: changed ? 'updated' : 'unchanged',
      threads: wire('threads.json', 'json', { body, exists: true, sha256: sha(body), byteCount: Buffer.byteLength(body) }) };
  }
  return { read, update, dispose() { disposed = true; } };
}
