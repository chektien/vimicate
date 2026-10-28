import type { WorkspaceMessage } from '../workspace/workspaceTypes';

/** Completed reads identify skills on tool activity, never on authored prose. */
export function transcriptReadSkills(messages: readonly WorkspaceMessage[], first: number, last: number): string[] {
  const names = new Set<string>();
  for (let index = first; index <= last; index++) {
    const row = messages[index];
    if (row?.role === 'tool' && row.state !== 'error' && row.state !== 'streaming'
      && row.tool?.resultSucceeded && row.tool.skillName) names.add(row.tool.skillName);
  }
  return [...names];
}

export function skillActivitySummary(summary: string, names: readonly string[], group = false): string {
  if (!names.length) return summary;
  return group ? `${summary} · ${names.length} ${names.length === 1 ? 'skill' : 'skills'}` : `Skill · ${names[0]}`;
}
