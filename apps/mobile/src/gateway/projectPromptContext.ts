import type { WorkspaceProject } from '../workspace/workspaceTypes';

export function promptWithProjectContext(message: string, project: WorkspaceProject | undefined) {
  if (!project || project.rootSessionKey === 'agent:main:direct:vimicate-ios' || project.id === 'vimicate' || !project.path.trim()) return message;
  const projectName = project.projectName || (project.kind === 'thread' ? 'project' : project.name);
  const lines = [
    'Vimicate project context:',
    `- Project: ${projectName}`,
    `- Workspace root: ${project.path.trim()}`,
    ...(project.kind === 'thread' ? [`- Thread: ${project.name}`] : []),
    '- Before working, read and follow the nearest AGENTS.md instructions for this workspace.',
    '',
    'User prompt:',
    message,
  ];
  return lines.join('\n');
}
