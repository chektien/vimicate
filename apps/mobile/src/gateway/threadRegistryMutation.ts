import type { WorkspaceProject } from '../workspace/workspaceTypes';

export type CreatedGatewaySession = {
  sessionKey: string;
  sessionId?: string;
  label?: string;
  runId?: string;
  runStarted: boolean;
};

export type ThreadRegistryWireBinding = {
  backend: 'openclaw';
  stableSessionKey: string;
  sessionID?: string;
  parentSessionKey?: string;
  state: 'current' | 'superseded';
  firstSeenAtSeconds?: number;
  lastSeenAtSeconds?: number;
};

export type ThreadRegistryWireEntry = {
  threadID: string;
  parentProjectID?: string;
  label?: string;
  order: number;
  state: 'active' | 'removed';
  firstSeenAtSeconds?: number;
  explicitlyCreatedAtSeconds?: number;
  removedAtSeconds?: number;
  currentBinding?: ThreadRegistryWireBinding;
  bindings: ThreadRegistryWireBinding[];
};

export function createdGatewaySession(payload: Record<string, unknown>): CreatedGatewaySession {
  const entry = record(payload.entry);
  const session = record(payload.session);
  const sessionKey = text(payload.key) || text(payload.sessionKey) || text(payload.stableSessionKey)
    || text(entry.key) || text(entry.sessionKey) || text(entry.stableSessionKey)
    || text(session.key) || text(session.sessionKey) || text(session.stableSessionKey);
  if (!sessionKey) throw new Error('OpenClaw created a session without returning its session key.');
  const sessionId = text(payload.sessionId) || text(payload.sessionID) || text(payload.id);
  const label = text(payload.label) || text(payload.title) || text(payload.displayName);
  const runId = text(payload.runId);
  return { sessionKey, ...(sessionId ? { sessionId } : {}), ...(label ? { label } : {}), ...(runId ? { runId } : {}), runStarted: payload.runStarted === true || Boolean(runId) };
}

export function rootProjectForSelection(projects: WorkspaceProject[], selectedKey: string) {
  const selected = projects.find((project) => project.sessionKey === selectedKey);
  if (!selected) return undefined;
  return selected.kind === 'thread'
    ? projects.find((project) => project.sessionKey === selected.rootSessionKey && project.kind !== 'thread')
    : selected;
}

export function projectRegistryID(project: WorkspaceProject) {
  if (project.id && !project.id.startsWith('agent:')) return project.id;
  if (project.sessionKey === 'agent:main:direct:vimicate-ios') return 'vimicate';
  return project.sessionKey.match(/:direct:vimicate-ios:project:([^:]+)$/)?.[1] || project.name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

export function threadBootstrapMessage(label: string, project: WorkspaceProject) {
  const root = project.path.trim();
  return [
    `Open a Vimicate project thread named "${label}" for project "${project.name}".`,
    root ? `Use ${root} as the working project.` : '',
    root ? `Before project work, read and follow the nearest AGENTS.md under ${root}.` : 'Before project work, resolve the project folder and follow its nearest AGENTS.md.',
    'Keep this thread scoped to that project and confirm readiness with exactly: thread ready',
  ].filter(Boolean).join('\n');
}

export function activeThreadEntry(created: CreatedGatewaySession, parent: WorkspaceProject, label: string, registryPayload: Record<string, unknown>, nowSeconds: number): ThreadRegistryWireEntry {
  const binding: ThreadRegistryWireBinding = {
    backend: 'openclaw', stableSessionKey: created.sessionKey,
    ...(created.sessionId ? { sessionID: created.sessionId } : {}),
    parentSessionKey: parent.sessionKey, state: 'current',
    firstSeenAtSeconds: nowSeconds, lastSeenAtSeconds: nowSeconds,
  };
  return {
    threadID: created.sessionKey,
    parentProjectID: projectRegistryID(parent),
    label: created.label || label,
    order: nextThreadOrder(registryPayload),
    state: 'active', firstSeenAtSeconds: nowSeconds,
    explicitlyCreatedAtSeconds: nowSeconds,
    currentBinding: binding, bindings: [binding],
  };
}

/** Native labels are unique across retained sessions, unlike project-local names. */
export function retiredThreadSessionKeys(payload: Record<string, unknown>, parent: WorkspaceProject, label: string): Set<string> {
  const retired = parsedThreadEntries(payload).filter((entry) => entry.state === 'removed'
    && entry.parentProjectID === projectRegistryID(parent)
    && entry.label?.trim().toLocaleLowerCase() === label.trim().toLocaleLowerCase());
  return new Set(retired.flatMap((entry) => [entry.threadID, entry.currentBinding?.stableSessionKey,
    ...entry.bindings.map((binding) => binding.stableSessionKey)].filter((key): key is string => Boolean(key))));
}

export function removedThreadEntries(registryPayload: Record<string, unknown>, projects: WorkspaceProject[], selectedKey: string, nowSeconds: number): ThreadRegistryWireEntry[] {
  const selected = projects.find((project) => project.sessionKey === selectedKey);
  if (!selected || selected.kind !== 'thread') return [];
  const descendants = descendantSessionKeys(projects, selectedKey);
  const stored = parsedThreadEntries(registryPayload);
  return [...descendants].map((sessionKey, index) => {
    const existing = stored.find((entry) => entry.threadID === sessionKey || entry.currentBinding?.stableSessionKey === sessionKey || entry.bindings.some((binding) => binding.stableSessionKey === sessionKey));
    const live = projects.find((project) => project.sessionKey === sessionKey);
    const binding: ThreadRegistryWireBinding = existing?.currentBinding ?? {
      backend: 'openclaw', stableSessionKey: sessionKey,
      ...(live?.sessionId ? { sessionID: live.sessionId } : {}),
      ...(live?.parentSessionKey ? { parentSessionKey: live.parentSessionKey } : {}),
      state: 'current', firstSeenAtSeconds: nowSeconds, lastSeenAtSeconds: nowSeconds,
    };
    return {
      ...(existing ?? { threadID: sessionKey, order: nextThreadOrder(registryPayload) + index, state: 'active' as const, bindings: [binding] }),
      state: 'removed', removedAtSeconds: nowSeconds,
      currentBinding: binding,
      bindings: existing?.bindings.length ? existing.bindings : [binding],
    };
  });
}

export function assertThreadRegistryUpdate(payload: unknown) {
  const accepted = record(payload);
  const threads = record(accepted.threads);
  // byteCount describes the wire body, including the host's final newline.
  const json = typeof threads.json === 'string' ? threads.json : '';
  const bytes = typeof threads.byteCount === 'number' ? threads.byteCount : -1;
  if (accepted.schemaVersion !== 2 || accepted.contract !== 'host-current-v1' || !['updated', 'unchanged'].includes(text(accepted.outcome)) || threads.exists !== true || !json || new TextEncoder().encode(json).length !== bytes) {
    throw new Error('OpenClaw did not return a complete atomic thread-registry update.');
  }
  return accepted;
}

export function assertThreadRegistryRemoval(payload: unknown, requested: ThreadRegistryWireEntry[]) {
  const accepted = assertThreadRegistryUpdate(payload);
  const retained = parsedThreadEntries(accepted).filter((entry) => entry.state === 'removed');
  const everyRemovalRetained = requested.every((entry) => retained.some((candidate) => threadEntriesShareIdentity(entry, candidate)));
  if (!everyRemovalRetained) throw new Error('OpenClaw accepted :close-thread but did not retain every removal tombstone. Refresh and retry; if the thread remains, its registry binding shape is unsupported.');
  return accepted;
}

function nextThreadOrder(payload: Record<string, unknown>) {
  return parsedThreadEntries(payload).reduce((highest, entry) => Math.max(highest, entry.order), -1) + 1;
}

function parsedThreadEntries(payload: Record<string, unknown>): ThreadRegistryWireEntry[] {
  try {
    const threads = record(payload.threads);
    const parsed = JSON.parse(text(threads.json)) as unknown;
    const rows = record(parsed).threads;
    if (!Array.isArray(rows)) return [];
    return rows.flatMap((row) => {
      const value = record(row); const threadID = text(value.threadID);
      if (!threadID) return [];
      const currentBinding = wireBinding(value.currentBinding);
      const bindings = Array.isArray(value.bindings) ? value.bindings.map(wireBinding).filter((binding): binding is ThreadRegistryWireBinding => Boolean(binding)) : [];
      return [{
        threadID,
        ...(text(value.parentProjectID) ? { parentProjectID: text(value.parentProjectID) } : {}),
        ...(text(value.label) ? { label: text(value.label) } : {}),
        order: numeric(value.order), state: value.state === 'removed' ? 'removed' : 'active',
        ...(numeric(value.firstSeenAtSeconds) ? { firstSeenAtSeconds: numeric(value.firstSeenAtSeconds) } : {}),
        ...(numeric(value.explicitlyCreatedAtSeconds) ? { explicitlyCreatedAtSeconds: numeric(value.explicitlyCreatedAtSeconds) } : {}),
        ...(numeric(value.removedAtSeconds) ? { removedAtSeconds: numeric(value.removedAtSeconds) } : {}),
        ...(currentBinding ? { currentBinding } : {}), bindings,
      }];
    });
  } catch { return []; }
}

function wireBinding(value: unknown): ThreadRegistryWireBinding | undefined {
  const binding = record(value); const stableSessionKey = text(binding.stableSessionKey);
  if (!stableSessionKey) return undefined;
  return {
    backend: 'openclaw', stableSessionKey,
    ...(text(binding.sessionID) ? { sessionID: text(binding.sessionID) } : {}),
    ...(text(binding.parentSessionKey) ? { parentSessionKey: text(binding.parentSessionKey) } : {}),
    state: binding.state === 'superseded' ? 'superseded' : 'current',
    ...(numeric(binding.firstSeenAtSeconds) ? { firstSeenAtSeconds: numeric(binding.firstSeenAtSeconds) } : {}),
    ...(numeric(binding.lastSeenAtSeconds) ? { lastSeenAtSeconds: numeric(binding.lastSeenAtSeconds) } : {}),
  };
}

function descendantSessionKeys(projects: WorkspaceProject[], selectedKey: string) {
  const result = new Set([selectedKey]); let changed = true;
  while (changed) {
    changed = false;
    for (const project of projects) if (project.parentSessionKey && result.has(project.parentSessionKey) && !result.has(project.sessionKey)) { result.add(project.sessionKey); changed = true; }
  }
  return result;
}

function threadEntriesShareIdentity(left: ThreadRegistryWireEntry, right: ThreadRegistryWireEntry) {
  const leftKeys = new Set([left.threadID, left.currentBinding?.stableSessionKey, ...left.bindings.map((binding) => binding.stableSessionKey)].filter(Boolean));
  return [right.threadID, right.currentBinding?.stableSessionKey, ...right.bindings.map((binding) => binding.stableSessionKey)].some((key) => Boolean(key && leftKeys.has(key)));
}

function record(value: unknown): Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
function text(value: unknown) { return typeof value === 'string' ? value.trim() : ''; }
function numeric(value: unknown) { return typeof value === 'number' && Number.isFinite(value) ? value : 0; }
