import { contentIsOnlyToolActivity } from '../tooling/toolActivity';
import type { WorkspaceMessageRole } from './workspaceTypes';

/**
 * A message whose content is only tool activity is machine evidence whatever
 * role its producer declared. Some runtimes return tool results on the `user`
 * turn; projecting those as authored prompts would give raw payloads the most
 * prominent chrome in the transcript.
 */
export function semanticWorkspaceRole(declaredRole: WorkspaceMessageRole, content: unknown): WorkspaceMessageRole {
  return contentIsOnlyToolActivity(content) ? 'tool' : declaredRole;
}

export function workspaceRole(value: string): WorkspaceMessageRole {
  const normalized = value.trim().toLowerCase();
  const exact: WorkspaceMessageRole[] = ['user', 'assistant', 'narration', 'tool', 'run', 'approval', 'media', 'error', 'openclaw', 'session', 'workspace', 'command', 'boundary', 'config', 'system', 'vimicate', 'operator'];
  if (exact.includes(normalized as WorkspaceMessageRole)) return normalized as WorkspaceMessageRole;
  if (normalized.includes('user') || normalized === 'you') return 'user';
  if (normalized.includes('tool')) return 'tool';
  if (normalized.includes('error')) return 'error';
  return normalized ? 'system' : 'assistant';
}
