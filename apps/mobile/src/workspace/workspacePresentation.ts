import type { WorkspaceProject } from './workspaceTypes';

export type StarOverrides = Record<string, boolean>;

export function parseStarOverrides(value: string | null): StarOverrides {
  if (!value) return {};
  try {
    const parsed: unknown = JSON.parse(value);
    if (Array.isArray(parsed)) {
      return Object.fromEntries(parsed.filter((key): key is string => typeof key === 'string').map((key) => [key, true]));
    }
    if (!isRecord(parsed)) return {};
    return Object.fromEntries(Object.entries(parsed).filter((entry): entry is [string, boolean] => typeof entry[1] === 'boolean'));
  } catch {
    return {};
  }
}

export function applyStarOverrides(projects: WorkspaceProject[], overrides: StarOverrides): WorkspaceProject[] {
  return projects.map((project) => {
    if (project.kind === 'thread' || !Object.prototype.hasOwnProperty.call(overrides, project.sessionKey)) return project;
    return { ...project, starred: overrides[project.sessionKey] ?? project.starred };
  });
}

export function updatedStarOverrides(overrides: StarOverrides, project: WorkspaceProject): StarOverrides {
  const rootKey = project.rootSessionKey || project.sessionKey;
  return { ...overrides, [rootKey]: !project.starred };
}

export function presentWorkspaceProjects(projects: WorkspaceProject[], mode: 'manual' | 'activity'): WorkspaceProject[] {
  if (mode === 'manual') {
    // Match native's two exclusive sections. A starred root and every child
    // thread move together above all unstarred project families while source
    // order remains stable within each section.
    const starredRoots = new Set(projects.filter((project) => project.kind !== 'thread' && project.starred).map((project) => project.sessionKey));
    const inStarredSection = (project: WorkspaceProject) => project.kind === 'thread'
      ? starredRoots.has(project.rootSessionKey || '')
      : starredRoots.has(project.sessionKey);
    return [...projects.filter(inStarredSection), ...projects.filter((project) => !inStarredSection(project))];
  }
  return projects
    .map((project, order) => ({ project, order }))
    .sort((left, right) => compareActivity(left.project, right.project) || left.order - right.order)
    .map(({ project }) => project);
}

export function visibleWorkspaceProjects(projects: WorkspaceProject[], mode: 'manual' | 'activity', collapsedRootKeys: ReadonlySet<string>) {
  if (mode === 'activity' || collapsedRootKeys.size === 0) return projects;
  return projects.filter((project) => project.kind !== 'thread' || !collapsedRootKeys.has(project.rootSessionKey || ''));
}

function compareActivity(left: WorkspaceProject, right: WorkspaceProject) {
  return (right.updatedAt ?? 0) - (left.updatedAt ?? 0);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
