import path from 'node:path';
import { createHash } from 'node:crypto';
import { createProjectFiles } from './project-files.mjs';
import { createRootAccess } from './project-file-access.mjs';
import { check, inside, relativePath } from './project-file-primitives.mjs';
import { createSshFileAccess } from './ssh-file-access.mjs';

function rootsFor(project) {
  const roots = project.fileRoots;
  if (roots === undefined) return null;
  check(roots.length > 0 && roots.length <= 16, 'file-roots must contain 1 to 16 folders');
  check(new Set(roots.map(root => root.name)).size === roots.length, 'ambiguous registered file root');
  for (const root of roots) {
    check((root.rootPath.startsWith('~/') || path.isAbsolute(root.rootPath))
      && root.rootPath.length <= 4096 && !/[\\\0]/u.test(root.rootPath)
      && !root.rootPath.split('/').some(part => part === '.' || part === '..'), 'invalid registered root path');
  }
  return roots;
}
const fingerprint = root => createHash('sha256').update(JSON.stringify(root)).digest('hex');

/** Host roots are virtual directories inside the existing project-relative contract.
 * Their first path component binds navigation, preview and chunk transfer to one
 * registered host/root. An explicit set replaces, never supplements, repo fallback.
 */
export function createHostedProjectFiles(options) {
  const local = createProjectFiles(options), remote = options.remote ?? createSshFileAccess();
  const homeDir = options.homeDir ?? process.env.HOME;
  function projectById(id, projects = local.registeredProjects()) {
    check(typeof id === 'string' && /^[A-Za-z0-9._-]{1,128}$/u.test(id), 'invalid project id');
    const matches = projects.filter(project => project.id === id);
    check(matches.length === 1, 'project id is unavailable or ambiguous');
    return matches[0];
  }
  async function access(project, root, method, params) {
    const stamp = fingerprint(root);
    const input = { ...params };
    if (method === 'exportChunk' && input.offset !== 0) {
      check(typeof input.version === 'string' && input.version.startsWith(stamp + ':'), 'registered file root changed before sharing');
      input.version = input.version.slice(stamp.length + 1);
    }
    const value = root.host === 'gateway'
      ? createRootAccess(root.rootPath, homeDir)[method](input)
      : await remote.run(root.host, root.rootPath, method, input);
    // Do not admit a reply after the project/host mapping was edited or removed.
    const current = rootsFor(projectById(project.id));
    check(current?.some(candidate => fingerprint(candidate) === stamp), 'registered file root changed during request');
    check(value && typeof value === 'object', 'invalid hosted file response');
    if (method === 'exportChunk') return { ...value, version: `${stamp}:${value.version}` };
    return value;
  }
  async function projectOperation(method, params) {
    const project = projectById(params?.projectId), roots = rootsFor(project);
    if (!roots) {
      const original = { list: 'list', read: 'read', exportChunk: 'locationExportChunk' }[method];
      return local[original](params);
    }
    const requested = relativePath(params?.path ?? '', method === 'list');
    const [name, ...parts] = requested.split('/'), root = roots.find(root => root.name === name);
    if (method === 'list' && !root) {
      check(params?.includeUnsupported === undefined || typeof params.includeUnsupported === 'boolean', 'invalid listing option');
      check(params?.includeDocuments === undefined || typeof params.includeDocuments === 'boolean', 'invalid document option');
      // Metadata-only redirection. Never issue an unqualified read against a primary
      // alias whose meaning could change between listing and preview/transfer.
      return { schemaVersion: 1, projectId: project.id, path: requested, ...(params.location ? { location: params.location } : {}),
        primaryRoot: roots[0].name, directoryLabel: 'Project folders',
        entries: requested ? [] : roots.map(root => ({ name: root.name, path: root.name,
          kind: 'directory', size: 0, mtimeMs: 0 })) };
    }
    check(root, 'path is outside registered file roots');
    const relative = parts.join('/');
    const value = await access(project, root, method, { ...params, path: relative });
    check(value.projectId === project.id && value.path === relative && value.location === params.location, 'invalid hosted file identity');
    if (method === 'list') {
      check(Array.isArray(value.entries) && value.entries.length <= 4096, 'invalid hosted listing');
      return { ...value, path: requested, directoryLabel: `${root.host}:${root.rootPath.replace(/\/$/u, '')}${relative ? '/' + relative : ''}`,
        entries: value.entries.map(entry => ({ ...entry, path: `${name}/${relativePath(entry.path, false)}` })) };
    }
    return { ...value, path: requested };
  }
  async function resolve(params) {
    const source = params?.sourcePath;
    check(typeof source === 'string' && source.length <= 4096 && !/[\\\0]/u.test(source)
      && !source.split('/').some(part => part === '.' || part === '..'), 'invalid file path');
    const expanded = source.startsWith('~/') ? path.join(homeDir, source.slice(2)) : source;
    check(path.isAbsolute(expanded), 'file path must be absolute or home-relative');
    if (params.projectId !== undefined) projectById(params.projectId);
    const candidates = [];
    try {
      for (const value of local.resolutionCandidates(params)) candidates.push({ project: { id: value.projectId }, value, depth: value.rootPath.length });
    } catch { /* A local path need not exist for a registered remote source. */ }
    for (const project of local.registeredProjects()) {
      for (const root of rootsFor(project) ?? []) {
        const absolute = path.resolve(root.rootPath.startsWith('~/') ? path.join(homeDir, root.rootPath.slice(2)) : root.rootPath);
        if (inside(absolute, expanded)) candidates.push({ project, root, depth: absolute.length });
      }
    }
    if (!candidates.length) return local.resolve(params);
    candidates.sort((a, b) => b.depth - a.depth);
    const deepest = candidates.filter(candidate => candidate.depth === candidates[0].depth);
    const preferred = deepest.filter(candidate => candidate.project.id === params.projectId);
    const matches = preferred.length ? preferred : deepest;
    check(matches.length === 1, 'file host is ambiguous; open the registered folder in Files');
    if (matches[0].value) return matches[0].value;
    const { project, root } = matches[0];
    const value = await access(project, root, 'resolve', params);
    const relative = relativePath(value.path, true);
    return { schemaVersion: 1, location: 'project', projectId: project.id, rootPath: project.repo,
      path: root.name + (relative ? '/' + relative : '') };
  }
  return { ...local, resolve,
    list: params => projectOperation('list', params), read: params => projectOperation('read', params),
    locationList: params => params?.location === 'project' ? projectOperation('list', params) : local.locationList(params),
    locationRead: params => params?.location === 'project' ? projectOperation('read', params) : local.locationRead(params),
    locationExportChunk: params => params?.location === 'project' ? projectOperation('exportChunk', params) : local.locationExportChunk(params),
    dispose: () => remote.dispose(),
  };
}
