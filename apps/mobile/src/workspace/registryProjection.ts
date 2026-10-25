import type { WorkspaceProject } from './workspaceTypes';

type RegistryProject = { id: string; name: string; group: string; path: string; backend: string; sessionKey: string };
type RegistryThread = {
  threadID: string;
  label: string;
  parentProjectID: string;
  state: string;
  order: number;
  stableSessionKey: string;
  lastSeenAtSeconds: number;
  explicitlyCreatedAtSeconds: number;
  removedAtSeconds: number;
  bindingKeys: string[];
};

export function reconcileRegistryPayload(sessionProjection: WorkspaceProject[], payload: Record<string, unknown>, allLiveSessions: WorkspaceProject[] = sessionProjection): WorkspaceProject[] {
  const projectsRecord = record(payload.projects);
  const threadsRecord = record(payload.threads);
  const registryProjects = parseProjectRegistry(typeof projectsRecord.markdown === 'string' ? projectsRecord.markdown : '');
  if (!registryProjects.length) return sessionProjection;
  const registryThreads = parseThreadRegistry(typeof threadsRecord.json === 'string' ? threadsRecord.json : '');
  const liveRoots = sessionProjection.filter((project) => project.kind !== 'thread');
  const liveThreads = sessionProjection.filter((project) => project.kind === 'thread');
  const liveByKey = new Map(allLiveSessions.map((project) => [project.sessionKey, project]));
  const tombstones = registryThreads.filter((thread) => thread.state === 'removed');
  // Registry-owned historical bindings must not reappear as adopted live children
  // when a same-name recreation replaces a tombstone with an active entry.
  const registeredBindings = new Set(registryThreads.flatMap((thread) => thread.bindingKeys));
  const visibleRegistryThreads = registryThreads.filter((thread) => thread.state !== 'removed' && thread.stableSessionKey && !threadBlockedByTombstone(thread, tombstones));
  const consumedThreads = new Set<string>();

  const projected = uniqueRegistryProjects(registryProjects.filter((project) => !project.backend || project.backend === 'openclaw')).flatMap((registryProject) => {
    const root = liveRoots.find((candidate) => candidate.sessionKey === registryProject.sessionKey || projectID(candidate) === registryProject.id);
    const sessionKey = root?.sessionKey || registryProject.sessionKey || inferredRootKey(registryProject.id);
    const base = root ?? emptyProject(sessionKey, registryProject.id);
    const registryChildren = visibleRegistryThreads.filter((thread) => thread.parentProjectID === registryProject.id)
      .sort((left, right) => left.order - right.order)
      .map((thread) => {
        const live = liveByKey.get(thread.stableSessionKey);
        if (live) consumedThreads.add(live.sessionKey);
        // The registry owns durable identity, order and parentage. The exact
        // bound live session owns its current explicit display label: OpenClaw
        // rename updates can reach sessions.list before the registry writer.
        // A missing/derived live label still falls back to the registry.
        return { ...(live ?? emptyThread(thread.stableSessionKey, thread.label)), id: thread.threadID || thread.stableSessionKey, name: live?.backendLabel || thread.label || live?.name || 'thread', kind: 'thread' as const, rootSessionKey: sessionKey, parentSessionKey: sessionKey, projectName: registryProject.name, path: registryProject.path, group: registryProject.group, threadCount: 0, ...(live?.updatedAt ? {} : thread.lastSeenAtSeconds ? { updatedAt: thread.lastSeenAtSeconds * 1000 } : {}) };
      });
    const adoptedChildren = liveThreads.filter((thread) => thread.rootSessionKey === base.sessionKey
      && !consumedThreads.has(thread.sessionKey)
      && !registeredBindings.has(thread.sessionKey)
      && !liveThreadBlockedByTombstone(thread, registryProject.id, tombstones))
      .map((thread) => ({ ...thread, rootSessionKey: sessionKey, projectName: registryProject.name, path: registryProject.path, group: registryProject.group }));
    adoptedChildren.forEach((thread) => consumedThreads.add(thread.sessionKey));
    const children = [...registryChildren, ...adoptedChildren];
    return [{ ...base, id: registryProject.id, sessionKey, name: registryProject.name, path: registryProject.path, group: registryProject.group, kind: 'project' as const, rootSessionKey: sessionKey, threadCount: children.length + 1 }, ...children];
  });

  // Once a valid projects.md snapshot exists it is the top-level authority.
  // Unregistered live roots remain backend sessions, not surprise project
  // cards. Their sessions can become visible only after a registry update.
  return projected;
}

export function parseProjectRegistry(markdown: string): RegistryProject[] {
  const result: RegistryProject[] = [];
  let current: Partial<RegistryProject> | null = null;
  const finish = () => {
    if (current?.id && current.name) result.push({ id: current.id, name: current.name, group: current.group ?? '', path: current.path ?? '', backend: current.backend ?? '', sessionKey: current.sessionKey ?? '' });
  };
  for (const rawLine of markdown.split(/\r?\n/)) {
    const heading = rawLine.match(/^##\s+(.+?)\s*$/);
    if (heading) { finish(); current = { name: heading[1]?.trim() ?? '' }; continue; }
    if (!current) continue;
    const field = rawLine.match(/^\s*-\s+(id|group|repo|backend|session):\s*(.*?)\s*$/i);
    if (!field) continue;
    const key = field[1]?.toLowerCase(); const value = field[2]?.trim() ?? '';
    if (key === 'id') current.id = value;
    if (key === 'group') current.group = value;
    if (key === 'repo') current.path = value.replace(/\/$/, '');
    if (key === 'backend') current.backend = value;
    if (key === 'session') current.sessionKey = value;
  }
  finish();
  return result;
}

export function parseThreadRegistry(json: string): RegistryThread[] {
  try {
    const root = JSON.parse(json) as unknown;
    const rows = Array.isArray(record(root).threads) ? record(root).threads as unknown[] : [];
    return rows.flatMap((value) => {
      const thread = record(value); const currentBinding = record(thread.currentBinding);
      const bindings = Array.isArray(thread.bindings) ? thread.bindings.map(record) : [];
      const binding = text(currentBinding.stableSessionKey)
        ? currentBinding
        : bindings.find((item) => text(item.state) === 'current' && text(item.stableSessionKey)) ?? {};
      const stableSessionKey = text(binding.stableSessionKey);
      const threadID = text(thread.threadID);
      if (!threadID && !stableSessionKey) return [];
      const bindingKeys = [...new Set([stableSessionKey, ...bindings.map((item) => text(item.stableSessionKey))].filter(Boolean))];
      return [{
        threadID,
        label: text(thread.label),
        parentProjectID: text(thread.parentProjectID),
        state: text(thread.state) || 'active',
        order: number(thread.order),
        stableSessionKey,
        lastSeenAtSeconds: number(binding.lastSeenAtSeconds) || number(thread.firstSeenAtSeconds),
        explicitlyCreatedAtSeconds: number(thread.explicitlyCreatedAtSeconds),
        removedAtSeconds: number(thread.removedAtSeconds),
        bindingKeys,
      }];
    });
  } catch { return []; }
}

function uniqueRegistryProjects(projects: RegistryProject[]) {
  const ids = new Set<string>();
  const sessionKeys = new Set<string>();
  return projects.filter((project) => {
    const id = project.id.toLocaleLowerCase();
    const sessionKey = project.sessionKey.toLocaleLowerCase();
    if (ids.has(id) || (sessionKey && sessionKeys.has(sessionKey))) return false;
    ids.add(id);
    if (sessionKey) sessionKeys.add(sessionKey);
    return true;
  });
}

function threadBlockedByTombstone(thread: RegistryThread, tombstones: RegistryThread[]) {
  return tombstones.some((tombstone) => {
    const sameBinding = thread.bindingKeys.some((key) => tombstone.bindingKeys.includes(key));
    const sameParentAndLabel = tombstone.parentProjectID === thread.parentProjectID
      && normalizedLabel(tombstone.label) === normalizedLabel(thread.label);
    if (!sameBinding && !sameParentAndLabel) return false;
    return !thread.explicitlyCreatedAtSeconds || thread.explicitlyCreatedAtSeconds <= tombstone.removedAtSeconds;
  });
}

function liveThreadBlockedByTombstone(thread: WorkspaceProject, parentProjectID: string, tombstones: RegistryThread[]) {
  return tombstones.some((tombstone) => tombstone.parentProjectID === parentProjectID
    && normalizedLabel(tombstone.label) === normalizedLabel(thread.name));
}

function normalizedLabel(value: string) { return value.trim().toLocaleLowerCase().replace(/\s+/g, ' '); }

function projectID(project: WorkspaceProject) { return project.sessionKey.match(/:direct:vimicate-ios:project:([^:]+)$/)?.[1] || (project.sessionKey === 'agent:main:direct:vimicate-ios' ? 'vimicate' : project.name.toLowerCase()); }
function inferredRootKey(id: string) { return id === 'vimicate' ? 'agent:main:direct:vimicate-ios' : `agent:main:direct:vimicate-ios:project:${id}`; }
function emptyProject(sessionKey: string, name: string): WorkspaceProject { return { id: sessionKey, sessionKey, name, path: '', branch: '—', starred: false, threadCount: 1, state: 'idle', kind: 'project', rootSessionKey: sessionKey }; }
function emptyThread(sessionKey: string, name: string): WorkspaceProject { return { id: sessionKey, sessionKey, name, path: '', branch: '—', starred: false, threadCount: 0, state: 'idle', kind: 'thread' }; }
function record(value: unknown): Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
function text(value: unknown) { return typeof value === 'string' ? value.trim() : ''; }
function number(value: unknown) { return typeof value === 'number' && Number.isFinite(value) ? value : 0; }
