import fs from 'node:fs';
import path from 'node:path';
import { TextDecoder } from 'node:util';
import { DIRECTORY_ENTRY_LIMIT, TEXT_LIMIT, IMAGE_LIMIT, check, failure, inside,
  openConfined, statFd, boundedBytes, relativePath, classified, isICloudPlaceholderError,
  ICLOUD_DOWNLOADING } from './project-file-primitives.mjs';

/** The same read-only, bounded filesystem owner runs locally and over SSH. */
export function createRootAccess(source, homeDir = process.env.HOME) {
  check(typeof source === 'string' && source.length <= 4096 && !/[\\\0]/u.test(source)
    && !source.split('/').some(part => part === '.' || part === '..'), 'invalid root path');
  check(typeof homeDir === 'string' && path.isAbsolute(homeDir), 'host home is unavailable');
  const expanded = source.startsWith('~/') ? path.join(homeDir, source.slice(2)) : source;
  check(path.isAbsolute(expanded), 'root must be absolute or home-relative');
  let root;
  try { root = fs.realpathSync(expanded); } catch { throw failure('registered folder is unavailable on its host'); }
  for (const prefix of ['/Users/', '/home/']) {
    if (root.startsWith(prefix)) check(inside(homeDir, root), 'root is outside the host home');
  }
  const fd = openConfined(root, fs.constants.O_RDONLY | fs.constants.O_DIRECTORY, 'unsafe root');
  try { const stat = statFd(fd, 'unsafe root'); check(stat.isDirectory() && stat.uid === process.getuid(), 'unsafe root'); }
  finally { fs.closeSync(fd); }
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
    check(params?.transferMode === undefined || params.transferMode === 'disk', 'invalid share transfer mode');
    const limit = params.transferMode === 'disk' ? Number.MAX_SAFE_INTEGER : 32 * 1024 * 1024, chunkBytes = 196608;
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
      check(before.isFile() && Number.isSafeInteger(before.size) && before.size <= limit, `share file exceeds ${limit} bytes`);
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
    list: params => listAt(root, params, params.location),
    read: params => readAt(root, params, params.location),
    exportChunk: params => exportChunkAt(root, params),
    resolve: params => {
      const sourcePath = params.sourcePath;
      check(typeof sourcePath === 'string' && sourcePath.length <= 4096 && !/[\\\0]/u.test(sourcePath)
        && !sourcePath.split('/').some(part => part === '.' || part === '..'), 'invalid file path');
      const absolute = sourcePath.startsWith('~/') ? path.join(homeDir, sourcePath.slice(2)) : sourcePath;
      check(path.isAbsolute(absolute) && (inside(expanded.replace(/\/$/u, ''), absolute) || inside(root, absolute)), 'file is outside the registered root');
      const relative = path.relative(expanded.replace(/\/$/u, ''), absolute);
      // Canonical-root aliases and the registered lexical alias are both confined.
      const resolved = target(root, inside(root, absolute) ? path.relative(root, absolute) : relative, true);
      const fd = openConfined(resolved.real, fs.constants.O_RDONLY, 'file is unavailable');
      try { const stat = statFd(fd, 'file is unavailable'); check(stat.isFile() || stat.isDirectory(), 'unsupported file type'); }
      finally { fs.closeSync(fd); }
      return { path: resolved.relative, rootPath: root };
    },
  };
}
