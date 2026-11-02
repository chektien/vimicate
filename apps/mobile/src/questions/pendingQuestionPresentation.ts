import type { QuestionRecord } from './questionTypes';
import type { WorkspaceProject } from '../workspace/workspaceTypes';

/** Broker records only. Async history is not an authoritative background feed. */
export function brokerPendingQuestionCounts(records: readonly QuestionRecord[]): ReadonlyMap<string, number> {
  const counts = new Map<string, number>();
  const seen = new Set<string>();
  for (const record of records) {
    if (record.status !== 'pending' || !record.sessionKey) continue;
    const key = JSON.stringify([record.sessionKey, record.id]);
    if (seen.has(key)) continue;
    seen.add(key);
    counts.set(record.sessionKey, (counts.get(record.sessionKey) ?? 0) + 1);
  }
  return counts;
}

/** Derive against the full registry before rail sorting, searching or folding. */
export function projectsWithPendingQuestions(projects: WorkspaceProject[], counts: ReadonlyMap<string, number>): WorkspaceProject[] {
  const roots = new Set(projects.filter(project => project.kind !== 'thread').map(project => project.sessionKey));
  const children = new Map<string, { total: number; threads: number }>();
  const seen = new Set<string>();
  for (const project of projects) {
    const root = project.rootSessionKey;
    if (project.kind !== 'thread' || !root || !roots.has(root) || root === project.sessionKey || seen.has(project.sessionKey)) continue;
    seen.add(project.sessionKey);
    const count = counts.get(project.sessionKey) ?? 0;
    if (!count) continue;
    const previous = children.get(root) ?? { total: 0, threads: 0 };
    children.set(root, { total: previous.total + count, threads: previous.threads + 1 });
  }
  return projects.map(project => {
    const own = counts.get(project.sessionKey) ?? 0;
    const child = project.kind === 'thread' ? undefined : children.get(project.sessionKey);
    const total = own + (child?.total ?? 0);
    if (!total) {
      if (!project.pendingQuestions) return project;
      const { pendingQuestions: _previous, ...rest } = project;
      return rest;
    }
    const threads = child?.threads ?? 0;
    const previous = project.pendingQuestions;
    return previous?.own === own && previous.total === total && previous.threads === threads
      ? project : { ...project, pendingQuestions: { own, total, threads } };
  });
}

export function pendingQuestionLabel(project: WorkspaceProject): string {
  const pending = project.pendingQuestions;
  if (!pending?.total) return '';
  if (!pending.own && pending.threads) return `Question pending in ${pending.threads} thread${pending.threads === 1 ? '' : 's'}`;
  return pending.total === 1 ? 'Question pending' : `${pending.total} questions pending`;
}
