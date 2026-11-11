import fs from 'node:fs';
import path from 'node:path';
import { TextDecoder } from 'node:util';

import { createRootAccess } from './project-file-access.mjs';
import { REGISTRY_LIMIT,
  check, failure, inside, openConfined, statFd, boundedBytes, relativePath,
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
    check(matches[0].fileRoots === undefined, 'host-aware file access required for this project');
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
  function resolutionCandidates(params) {
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
    check(candidates.length > 0, 'file is outside allowed locations or symlink escapes its location');
    const fd = openConfined(real, fs.constants.O_RDONLY, 'file is unavailable');
    try {
      const stat = statFd(fd, 'file is unavailable');
      check(stat.isFile() || stat.isDirectory(), 'unsupported file type');
    } finally { fs.closeSync(fd); }
    return candidates;
  }
  function resolve(params) {
    const candidates = resolutionCandidates(params).sort((left, right) => right.rootPath.length - left.rootPath.length);
    const deepest = candidates.filter(entry => entry.rootPath.length === candidates[0].rootPath.length);
    const selected = deepest.length === 1 ? deepest[0] : deepest.find(entry => entry.projectId === params?.projectId);
    check(selected, 'file location is ambiguous');
    return selected;
  }
  return {
    registeredProjects: registryProjects, resolutionCandidates,
    list: (params) => createRootAccess(projectRoot(params?.projectId), homeDir).list(params),
    read: (params) => createRootAccess(projectRoot(params?.projectId), homeDir).read(params),
    resolveShared,
    sharedList: (params) => createRootAccess(sharedRoot(), homeDir).list({ ...params, location: 'icloud-downloads' }),
    sharedRead: (params) => createRootAccess(sharedRoot(), homeDir).read({ ...params, location: 'icloud-downloads' }),
    resolve,
    locationList: (params) => createRootAccess(locationRoot(params), homeDir).list(params),
    locationRead: (params) => createRootAccess(locationRoot(params), homeDir).read(params),
    locationExportChunk: (params) => createRootAccess(locationRoot(params), homeDir).exportChunk(params),
  };
}
