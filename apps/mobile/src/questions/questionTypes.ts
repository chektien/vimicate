export type QuestionAnswers = { answers: Record<string, string[]> };
export type AgentQuestion = {
  questionId: string; header: string; question: string;
  options: { label: string; description?: string | undefined }[];
  multiSelect?: boolean | undefined; isOther?: boolean | undefined; isSecret?: boolean | undefined; url?: string | undefined;
  secretStore?: { name: string; kind: 'secret' | 'env'; allowedHosts?: string[] | undefined; reason?: string | undefined } | undefined;
};
export type QuestionRecord = {
  id: string; sessionKey: string; runId?: string | undefined; agentId?: string | undefined;
  createdAtMs: number; expiresAtMs: number;
  status: 'pending' | 'answered' | 'cancelled' | 'expired';
  questions: AgentQuestion[]; answers?: QuestionAnswers | undefined; resolvedBy?: string | undefined;
  recoveredElsewhere?: boolean | undefined;
};
export function questionNeedsOtherSurface(record: QuestionRecord) {
  return record.questions.some(question => question.isSecret || question.secretStore);
}
