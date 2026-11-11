import type { WorkspaceMessage } from '../workspace/workspaceTypes';
/** Producer role suffixes do not change the original submission identity. */
export function normalizedSubmissionIdentity(value: string | undefined) { return value?.replace(/:(?:user|assistant)$/i, ''); }
export function compatibleQuestionGeneration(question: { sessionKey?: string | undefined; transcriptSessionId?: string | undefined }, reply: { sessionKey?: string | undefined; transcriptSessionId?: string | undefined }) {
  return Boolean(question.sessionKey && question.sessionKey === reply.sessionKey && (question.transcriptSessionId ? question.transcriptSessionId === reply.transcriptSessionId : !reply.transcriptSessionId));
}
export function canonicalQuestionReply(message: WorkspaceMessage) { return message.role === 'user' && message.source === 'history' && !message.id.startsWith('pending-input:'); }
