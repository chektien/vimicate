import type { WorkspaceProject } from './workspaceTypes';

export function projectParentLabel(project: WorkspaceProject, projects: readonly WorkspaceProject[]) {
  if (project.kind !== 'thread' && (!project.rootSessionKey || project.rootSessionKey === project.sessionKey)) return '';
  const explicit = project.projectName?.trim(); if (explicit) return explicit;
  const root = projects.find((candidate) => candidate.sessionKey === project.rootSessionKey);
  return root?.name.trim() || 'project';
}

export function projectHierarchyMeta(project: WorkspaceProject, projects: readonly WorkspaceProject[]) {
  const parent = projectParentLabel(project, projects);
  return parent ? `↳ ${parent.toLowerCase()}` : 'root';
}
