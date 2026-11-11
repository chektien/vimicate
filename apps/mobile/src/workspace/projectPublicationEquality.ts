import type { WorkspaceProject } from './workspaceTypes';

// Fixed project schema only, never recursive workspace/payload comparison.
// Record completeness makes a new scalar field a compile-time policy decision.
const scalarFields: Record<keyof Omit<WorkspaceProject, 'pendingQuestions' | 'questionDelivery'>, true> = {
  id: true, sessionKey: true, name: true, path: true, branch: true,
  starred: true, threadCount: true, state: true, runPhase: true, group: true,
  updatedAt: true, kind: true, parentSessionKey: true, rootSessionKey: true,
  projectName: true, unread: true, markedUnreadAt: true, modelProvider: true,
  model: true, agentRuntime: true, thinkingLevel: true, fastMode: true,
  totalTokens: true, contextTokens: true, estimatedCostUsd: true,
  sessionId: true, sessionStartedAtMs: true, backendLabel: true,
};
const keys = Object.keys(scalarFields) as (keyof typeof scalarFields)[];

/** One ordered scan of the already projected census, with no serialization. */
export function sameProjectPublication(left: readonly WorkspaceProject[], right: readonly WorkspaceProject[]) {
  return left === right || (left.length === right.length && left.every((project, index) => {
    const next = right[index]!;
    return project === next || (keys.every(key => project[key] === next[key])
      && project.questionDelivery?.sending === next.questionDelivery?.sending
      && project.questionDelivery?.unconfirmed === next.questionDelivery?.unconfirmed
      && project.questionDelivery?.failed === next.questionDelivery?.failed
      && project.questionDelivery?.threads === next.questionDelivery?.threads
      && project.pendingQuestions?.own === next.pendingQuestions?.own
      && project.pendingQuestions?.total === next.pendingQuestions?.total
      && project.pendingQuestions?.threads === next.pendingQuestions?.threads);
  }));
}
