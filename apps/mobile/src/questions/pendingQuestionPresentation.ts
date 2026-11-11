import type { QuestionRecord } from './questionTypes';
import type { WorkspaceProject } from '../workspace/workspaceTypes';

/** The broker and observed async items retain separate lifecycle authority. */
export function brokerPendingQuestionCounts(records: readonly QuestionRecord[]): ReadonlyMap<string, number> {
  const counts = new Map<string, number>();
  const seen = new Set<string>();
  for (const record of records) {
    if (record.status !== 'pending' || record.answerDelivery || record.pendingOmitted || !record.sessionKey) continue;
    const key = JSON.stringify([record.sessionKey, record.id]);
    if (seen.has(key)) continue;
    seen.add(key);
    counts.set(record.sessionKey, (counts.get(record.sessionKey) ?? 0) + 1);
  }
  return counts;
}

export function combinedPendingQuestionCounts(...sources: ReadonlyMap<string, number>[]): ReadonlyMap<string, number> {
  const counts = new Map<string, number>();
  for (const source of sources) for (const [key, count] of source) counts.set(key, (counts.get(key) ?? 0) + count);
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

export type QuestionDeliveryCounts = { sending: number; unconfirmed: number; failed: number };
export function brokerQuestionDeliveryCounts(records: readonly QuestionRecord[]): ReadonlyMap<string, QuestionDeliveryCounts> {
  const result = new Map<string, QuestionDeliveryCounts>();
  for (const record of records) {
    if (record.status !== 'pending' || !record.answerDelivery) continue;
    const counts = result.get(record.sessionKey) ?? { sending: 0, unconfirmed: 0, failed: 0 };
    counts[record.answerDelivery]++; result.set(record.sessionKey, counts);
  }
  return result;
}
export function projectsWithQuestionDelivery(projects: WorkspaceProject[], ...sources: ReadonlyMap<string, QuestionDeliveryCounts>[]): WorkspaceProject[] {
  const counts = new Map<string, QuestionDeliveryCounts>();
  for (const source of sources) for (const [key, value] of source) {
    const old = counts.get(key) ?? { sending: 0, unconfirmed: 0, failed: 0 };
    counts.set(key, { sending: old.sending + value.sending, unconfirmed: old.unconfirmed + value.unconfirmed, failed: old.failed + value.failed });
  }
  return projects.map(project => {
    const own = counts.get(project.sessionKey) ?? { sending: 0, unconfirmed: 0, failed: 0 };
    const children = project.kind === 'thread' ? [] : [...new Map(projects.filter(child => child.kind === 'thread' && child.rootSessionKey === project.sessionKey && child.sessionKey !== project.sessionKey).map(child => [child.sessionKey, child])).values()].flatMap(child => counts.get(child.sessionKey) ?? []);
    const total = children.reduce((a, b) => ({ sending: a.sending + b.sending, unconfirmed: a.unconfirmed + b.unconfirmed, failed: a.failed + b.failed }), own);
    if (!total.sending && !total.unconfirmed && !total.failed) { if (!project.questionDelivery) return project; const { questionDelivery: _previous, ...rest } = project; return rest; }
    return { ...project, questionDelivery: { ...total, threads: children.filter(count => count.sending + count.unconfirmed + count.failed > 0).length } };
  });
}
export function questionDeliveryLabel(project: WorkspaceProject) {
  const delivery = project.questionDelivery;
  if (delivery?.failed) return `${delivery.failed} answer${delivery.failed === 1 ? '' : 's'} not confirmed. Open to retry`;
  if (delivery?.sending) return 'Sending answer';
  return delivery?.unconfirmed ? 'Answer awaiting confirmation' : '';
}
