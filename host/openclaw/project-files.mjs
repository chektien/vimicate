import fs from 'node:fs';
import path from 'node:path';
import { TextDecoder } from 'node:util';

import { REGISTRY_LIMIT, DIRECTORY_ENTRY_LIMIT, TEXT_LIMIT, IMAGE_LIMIT,
  check, failure, inside, openConfined, statFd, boundedBytes, relativePath, classified, isICloudPlaceholderError, ICLOUD_DOWNLOADING,
  parseProjects } from './project-file-primitives.mjs';

/** Read-only registered projects, fixed Downloads, and assistant artifacts. */
export function createProjectFiles({ vimicateDir, homeDir = process.env.HOME }) {
  check(path.isAbsolute(vimicateDir), 'fixed registry directory required');
  let fixedRegistry;
  try { fixedRegistry = fs.realpathSync(vimicateDir); }
  catch { throw failure('fixed registry directory required'); }
  check(fixedRegistry === vimicateDir, 'fixed registry directory required');
  const registryFd = openConfined(vimicateDir, fs.constants.O_RDONLY | fs.constants.O_DIRECTORY,
    'unsafe registry directory');
  let registryRoot;
  try { registryRoot = statFd(registryFd, 'unsafe registry directory'); }
  finally { fs.closeSync(registryFd); }
  check(registryRoot.isDirectory() && registryRoot.uid === process.getuid(), 'unsafe registry directory');

  function registryProjects() {
    const filename = path.join(vimicateDir, 'projects.md');
    const fd = openConfined(filename, fs.constants.O_RDONLY, 'unsafe project registry');
    try {
      const before = statFd(fd, 'unsafe project registry');
      check(before.isFile() && before.nlink === 1 && before.uid === registryRoot.uid
        && before.size <= REGISTRY_LIMIT, 'unsafe project registry');
      const bytes = boundedBytes(fd, REGISTRY_LIMIT, 'project registry read failed');
      check(bytes.length <= REGISTRY_LIMIT, 'unsafe project registry');
      const after = statFd(fd, 'unsafe project registry');
      check(bytes.length === before.size && before.size === after.size
        && before.mtimeMs === after.mtimeMs, 'project registry changed during read');
      let markdown;
      try { markdown = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes); }
      catch { throw failure('project registry is not valid UTF-8'); }
      return parseProjects(markdown);
    } finally {
      fs.closeSync(fd);
    }
  }
  function projectRoot(projectId, projects = registryProjects()) {
    check(typeof projectId === 'string' && /^[A-Za-z0-9._-]{1,128}$/u.test(projectId), 'invalid project id');
    const matches = projects.filter(project => project.id === projectId);
    check(matches.length === 1, 'project id is unavailable or ambiguous');
    const configured = matches[0].repo;
    check(configured.startsWith('~/') || path.isAbsolute(configured), 'project root must be an absolute or home-relative registry path');
    const expanded = expandSource(configured.replace(/\/$/u, ''));
    let root;
    try { root = fs.realpathSync(expanded.replace(/\/$/u, '')); }
    catch { throw new Error('vimicate project files: project is unavailable on this Gateway host'); }
    expandSource(root);
    const fd = openConfined(root, fs.constants.O_RDONLY | fs.constants.O_DIRECTORY,
      'project is unavailable on this Gateway host');
    let stat;
    try { stat = statFd(fd, 'unsafe project root'); }
    finally { fs.closeSync(fd); }
    check(stat.isDirectory() && stat.uid === process.getuid(), 'unsafe project root');
    return root;
  }
  function expandSource(source) {
    check(typeof source === 'string' && source.length <= 4096 && !source.includes('\\')
      && !source.includes('\0'), 'invalid file path');
    check(typeof homeDir === 'string' && path.isAbsolute(homeDir), 'host home is unavailable');
    check(!source.split('/').some(part => part === '.' || part === '..'), 'file path traversal is not allowed');
    const expanded = source.startsWith('~/') ? path.join(homeDir, source.slice(2)) : source;
    check(path.isAbsolute(expanded), 'file path must be absolute or home-relative');
    // An absolute path from another Mac/account is not a valid local alias.
    for (const prefix of ['/Users/', '/home/']) {
      if (expanded.startsWith(prefix)) check(inside(homeDir, expanded), 'file is outside this Gateway host home');
    }
    return expanded;
  }
  function sharedRoot() {
    check(typeof homeDir === 'string' && path.isAbsolute(homeDir), 'shared Downloads location is unavailable');
    let root, cloud;
    try {
      cloud = fs.realpathSync(path.join(homeDir, 'icloud'));
      root = fs.realpathSync(path.join(homeDir, 'icloud', 'Downloads'));
    }
    catch { throw failure('shared Downloads location is unavailable on this Gateway host'); }
    check(cloud === path.join(homeDir, 'Library', 'Mobile Documents', 'com~apple~CloudDocs')
      && root === path.join(cloud, 'Downloads'), 'unsafe shared Downloads location');
    const fd = openConfined(root, fs.constants.O_RDONLY | fs.constants.O_DIRECTORY,
      'shared Downloads location is unavailable on this Gateway host');
    let stat;
    try { stat = statFd(fd, 'unsafe shared Downloads location'); }
    finally { fs.closeSync(fd); }
    check(stat.isDirectory() && stat.uid === process.getuid(), 'unsafe shared Downloads location');
    return root;
  }
  function resolveShared(params) {
    const source = params?.sourcePath;
    check(typeof source === 'string' && source.length <= 4096 && !source.includes('\\') && !source.includes('\0'), 'invalid shared file path');
    const root = sharedRoot();
    const expanded = source.startsWith('~/') ? path.join(homeDir, source.slice(2)) : source;
    check(path.isAbsolute(expanded) && !source.split('/').some(part => part === '.' || part === '..'), 'shared file path traversal is not allowed');
    const alias = path.join(homeDir, 'icloud', 'Downloads');
    check(inside(alias, expanded) || inside(root, expanded), 'file is outside the shared Downloads location');
    let real;
    try { real = fs.realpathSync(expanded); }
    catch { throw failure('shared file is unavailable'); }
    check(inside(root, real) && real !== root, 'symlink escapes the shared Downloads location');
    const relative = path.relative(root, real).split(path.sep).join('/');
    relativePath(relative, false);
    return { schemaVersion: 1, location: 'icloud-downloads', path: relative };
  }
  function artifactsRoot() {
    const root = path.join(vimicateDir, 'agent', 'artifacts');
    let real;
    try { real = fs.realpathSync(root); }
    catch { throw failure('assistant artifacts location is unavailable on this Gateway host'); }
    check(real === root, 'unsafe assistant artifacts location');
    const fd = openConfined(root, fs.constants.O_RDONLY | fs.constants.O_DIRECTORY,
      'unsafe assistant artifacts location');
    try {
      const stat = statFd(fd, 'unsafe assistant artifacts location');
      check(stat.isDirectory() && stat.uid === registryRoot.uid, 'unsafe assistant artifacts location');
    } finally { fs.closeSync(fd); }
    return root;
  }
  function locationRoot(params) {
    const { location, projectId } = params ?? {};
    relativePath(params?.path ?? '', true);
    if (location === 'project') return projectRoot(projectId);
    if (location === 'icloud-downloads') {
      check(projectId === 'shared-icloud-downloads', 'invalid shared Downloads project id');
      return sharedRoot();
    }
    check(location === 'assistant-artifacts', 'invalid file location');
    check(projectId === 'assistant-artifacts', 'invalid assistant artifacts project id');
    return artifactsRoot();
  }
  function resolve(params) {
    const expanded = expandSource(params?.sourcePath);
    const preferred = params?.projectId;
    check(preferred === undefined || (typeof preferred === 'string'
      && /^[A-Za-z0-9._-]{1,128}$/u.test(preferred)), 'invalid project id');
    let real;
    try { real = fs.realpathSync(expanded); }
    catch { throw failure('file is unavailable'); }
    const candidates = [];
    function candidate(location, projectId, root, aliases = []) {
      if (!inside(root, real) || ![root, ...aliases].some(alias => inside(alias, expanded))) return;
      const relative = path.relative(root, real).split(path.sep).join('/');
      relativePath(relative, true);
      candidates.push({ schemaVersion: 1, location, projectId, path: relative, rootPath: root });
    }
    const projects = registryProjects();
    for (const project of projects) {
      try {
        candidate('project', project.id, projectRoot(project.id, projects), [expandSource(project.repo.replace(/\/$/u, ''))]);
      } catch { /* Unavailable/ambiguous registrations are not local roots. */ }
    }
    try { candidate('icloud-downloads', 'shared-icloud-downloads', sharedRoot(), [path.join(homeDir, 'icloud', 'Downloads')]); }
    catch { /* Downloads need not exist on this host. */ }
    try { candidate('assistant-artifacts', 'assistant-artifacts', artifactsRoot()); }
    catch { /* Artifacts need not exist on this host. */ }
    candidates.sort((left, right) => right.rootPath.length - left.rootPath.length);
    check(candidates.length > 0, 'file is outside allowed locations or symlink escapes its location');
    const deepest = candidates.filter(entry => entry.rootPath.length === candidates[0].rootPath.length);
    const selected = deepest.length === 1 ? deepest[0] : deepest.find(entry => entry.projectId === preferred);
    check(selected, 'file location is ambiguous');
    const fd = openConfined(real, fs.constants.O_RDONLY, 'file is unavailable');
    try {
      const stat = statFd(fd, 'file is unavailable');
      check(stat.isFile() || stat.isDirectory(), 'unsupported file type');
    } finally { fs.closeSync(fd); }
    return selected;
  }
  function target(root, requestedPath, allowRoot) {
    const relative = relativePath(requestedPath, allowRoot);
    const lexical = path.resolve(root, ...relative.split('/').filter(Boolean));
    check(inside(root, lexical), 'path traversal is not allowed');
    let real;
    try { real = fs.realpathSync(lexical); }
    catch { throw new Error('vimicate project files: path is unavailable'); }
    check(inside(root, real), 'symlink escapes the project root');
    return { root, relative, real };
  }
  function listAt(root, params, location) {
    check(params?.includeUnsupported === undefined || typeof params.includeUnsupported === 'boolean', 'invalid listing option');
    check(params?.includeDocuments === undefined || typeof params.includeDocuments === 'boolean', 'invalid document option');
    const projectId = params?.projectId;
    check(typeof projectId === 'string' && /^[A-Za-z0-9._-]{1,128}$/u.test(projectId), 'invalid project id');
    const requestedPath = typeof params?.path === 'string' ? params.path : '';
    const resolved = target(root, requestedPath, true);
    const directoryFd = openConfined(resolved.real, fs.constants.O_RDONLY | fs.constants.O_DIRECTORY,
      'path is unavailable');
    try { check(statFd(directoryFd, 'path is unavailable').isDirectory(), 'path is not a directory'); }
    catch (error) { fs.closeSync(directoryFd); throw error; }
    const names = [];
    let directory;
    try {
      directory = fs.opendirSync(resolved.real);
      let entry;
      while ((entry = directory.readSync()) !== null) {
        names.push(entry.name);
        check(names.length <= DIRECTORY_ENTRY_LIMIT, 'directory entry limit exceeded');
      }
    } catch (error) {
      if (error instanceof Error && error.message.startsWith('vimicate project files:')) throw error;
      throw failure('directory read failed');
    } finally {
      try { directory?.closeSync(); } catch { /* preserve the scoped result */ }
      fs.closeSync(directoryFd);
    }
    const entries = [];
    for (const name of names) {
      const relative = resolved.relative ? `${resolved.relative}/${name}` : name;
      if (!name || name === '.' || name === '..' || name.length > 255
        || name.includes('/') || name.includes('\\') || name.includes('\0') || relative.length > 4096) continue;
      const childPath = path.join(resolved.real, name);
      let real, stat, fd;
      try {
        real = fs.realpathSync(childPath);
        if (!inside(resolved.root, real)) continue;
        fd = openConfined(real, fs.constants.O_RDONLY, 'path is unavailable');
        stat = statFd(fd, 'path is unavailable');
      } catch { continue; }
      finally { if (fd !== undefined) fs.closeSync(fd); }
      const type = classified(name, stat, params.includeDocuments);
      if (type.kind === 'unsupported' && (params.includeUnsupported !== true || !stat.isFile())) continue;
      entries.push({ name, path: relative,
        ...type, size: stat.isFile() ? stat.size : 0, mtimeMs: Math.trunc(stat.mtimeMs) });
    }
    entries.sort((left, right) => right.mtimeMs - left.mtimeMs
      || left.kind.localeCompare(right.kind)
      || left.name.localeCompare(right.name, 'en-US', { sensitivity: 'base', numeric: true }));
    return { schemaVersion: 1, projectId, path: resolved.relative, entries, ...(location ? { location } : {}) };
  }
  function readAt(root, params, location) {
    check(params?.includeDocuments === undefined || typeof params.includeDocuments === 'boolean', 'invalid document option');
    const projectId = params?.projectId;
    check(typeof projectId === 'string' && /^[A-Za-z0-9._-]{1,128}$/u.test(projectId), 'invalid project id');
    const resolved = target(root, params?.path, false);
    const filename = path.basename(resolved.relative);
    const fd = openConfined(resolved.real, fs.constants.O_RDONLY, 'path is unavailable');
    try {
      const before = statFd(fd, 'path is unavailable');
      const type = classified(filename, before, params.includeDocuments);
      check(['text', 'image', 'document'].includes(type.kind), 'unsupported file type');
      const limit = type.kind === 'text' ? TEXT_LIMIT : IMAGE_LIMIT;
      check(before.isFile() && before.size <= limit, `${type.kind} file exceeds ${limit} bytes`);
      let bytes;
      try { bytes = boundedBytes(fd, limit, 'file read failed'); }
      catch (error) { if (error?.icloudPlaceholder) error.icloudPath = resolved.real; throw error; }
      check(bytes.length <= limit, `${type.kind} file exceeds ${limit} bytes`);
      const after = statFd(fd, 'path is unavailable');
      check(bytes.length === before.size && before.size === after.size && before.mtimeMs === after.mtimeMs,
        'file changed during read');
      const common = { schemaVersion: 1, projectId, path: resolved.relative, kind: type.kind,
        ...(location ? { location } : {}),
        mimeType: type.mimeType, size: bytes.length, mtimeMs: Math.trunc(after.mtimeMs) };
      if (type.kind !== 'text') return { ...common, dataBase64: bytes.toString('base64') };
      check(!bytes.includes(0), 'text file contains unsupported NUL bytes');
      let text;
      try { text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes); }
      catch { throw new Error('vimicate project files: text file is not valid UTF-8'); }
      return { ...common, text };
    } finally {
      fs.closeSync(fd);
    }
  }
  function exportChunkAt(root, params) {
    // Explicit transfer is independent of rendering. Each response is at most
    // 256 KiB base64, without raising preview limits or Gateway frame limits.
    const limit = 32 * 1024 * 1024, chunkBytes = 196608;
    check(Number.isSafeInteger(params?.size) && params.size >= 0 && params.size <= limit,
      `share file exceeds ${limit} bytes`);
    check(Number.isSafeInteger(params?.mtimeMs) && params.mtimeMs >= 0, 'invalid share file timestamp');
    const offset = params?.offset;
    check(Number.isSafeInteger(offset) && offset >= 0 && offset % chunkBytes === 0
      && (offset < params.size || offset === 0), 'invalid share chunk offset');
    check(offset === 0 ? params.version === undefined
      : typeof params.version === 'string' && params.version.length <= 256, 'invalid share file version');
    const resolved = target(root, params.path, false);
    const fd = openConfined(resolved.real, fs.constants.O_RDONLY, 'path is unavailable');
    const versionOf = stat => [stat.dev, stat.ino, stat.size, stat.mtimeMs, stat.ctimeMs].join(':');
    try {
      const before = statFd(fd, 'path is unavailable');
      check(before.isFile() && before.size <= limit, `share file exceeds ${limit} bytes`);
      check(Number.isFinite(before.ctimeMs), 'invalid share file version');
      const version = versionOf(before);
      check(before.size === params.size && Math.trunc(before.mtimeMs) === params.mtimeMs
        && (offset === 0 || version === params.version), 'file changed before sharing');
      const bytes = Buffer.alloc(Math.min(chunkBytes, before.size - offset));
      let length = 0;
      while (length < bytes.length) {
        let count;
        try { count = fs.readSync(fd, bytes, length, bytes.length - length, offset + length); }
        catch (error) {
          if (isICloudPlaceholderError(error)) throw Object.assign(failure(ICLOUD_DOWNLOADING),
            { icloudPlaceholder: true, icloudPath: resolved.real });
          throw failure('file transfer read failed');
        }
        if (count === 0) break;
        length += count;
      }
      // No zero-filled placeholders are exported and no chunk can cross versions.
      check(length === bytes.length && versionOf(statFd(fd, 'path is unavailable')) === version,
        'file changed during sharing');
      return { schemaVersion: 1, location: params.location, projectId: params.projectId,
        path: resolved.relative, size: before.size, mtimeMs: Math.trunc(before.mtimeMs), offset, version,
        mimeType: classified(path.basename(resolved.relative), before, true).mimeType ?? 'application/octet-stream',
        dataBase64: bytes.toString('base64') };
    } finally { fs.closeSync(fd); }
  }
  return {
    list: (params) => listAt(projectRoot(params?.projectId), params),
    read: (params) => readAt(projectRoot(params?.projectId), params),
    resolveShared,
    sharedList: (params) => listAt(sharedRoot(), params, 'icloud-downloads'),
    sharedRead: (params) => readAt(sharedRoot(), params, 'icloud-downloads'),
    resolve,
    locationList: (params) => listAt(locationRoot(params), params, params.location),
    locationRead: (params) => readAt(locationRoot(params), params, params.location),
    locationExportChunk: (params) => exportChunkAt(locationRoot(params), params),
  };
}
