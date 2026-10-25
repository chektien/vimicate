import type { WorkspaceMessage } from '../workspace/workspaceTypes';
import { matchesAsyncAnswer, type AsyncQuestion } from './asyncQuestionContract';
export type AsyncQuestionHistoryEntry = { question: AsyncQuestion; message: WorkspaceMessage; boundary?: string; confirmedText?: string };
/** Same chronology policy as installed Control UI Jm. Never treat prose or a
 * transport acknowledgement as successful run or saved-answer authority. */
export function asyncQuestionHistory(messages: WorkspaceMessage[]): AsyncQuestionHistoryEntry[] {
  const sessions = new Map<string, WorkspaceMessage[]>();
  for (const message of messages) { if (!message.sessionKey) continue; const rows = sessions.get(message.sessionKey) ?? []; rows.push(message); sessions.set(message.sessionKey, rows); }
  return [...sessions.values()].flatMap(historyForSession);
}
function historyForSession(messages: WorkspaceMessage[]): AsyncQuestionHistoryEntry[] {
  const runs = new Map<string, { first: number; last: number; settled?: number }>();
  const starts = new Map<string, number>(); const recoveries = new Map<string, number>();
  const entries = new Map<string, { entry: AsyncQuestionHistoryEntry; index: number; origin?: string | undefined; run?: string }>();
  const success: { index: number; start: number; run?: string; key: string }[] = [];
  let lastUser = -1; let lastUserRun: string | undefined;
  for (const [index, message] of messages.entries()) {
    const run = message.runId;
    if (message.role === 'user') { lastUser = index; lastUserRun = run; if (run && !starts.has(run)) starts.set(run, index); }
    if (run && message.asyncQuestionRestartRecovery) recoveries.set(run, index);
    const outcome = message.asyncQuestionRunOutcome;
    if (run) { const prior = runs.get(run); runs.set(run, { first: prior?.first ?? index, last: index, ...(outcome ? { settled: index } : prior?.settled !== undefined ? { settled: prior.settled } : {}) }); }
    if (message.asyncQuestion && message.sessionKey) entries.set(message.asyncQuestion.itemId, { entry: { question: message.asyncQuestion, message }, index, ...(run ?? lastUserRun ? { origin: run ?? lastUserRun } : {}), ...(run ? { run } : {}) });
    if (message.role === 'user' && message.source === 'history' && !message.id.startsWith('pending-input:')) {
      const reply = message.asyncQuestionAnswerText ?? message.text;
      const candidates = [...entries.values()].filter(({ entry }) => !entry.confirmedText && (!message.sessionKey || message.sessionKey === entry.message.sessionKey) && (!message.asyncQuestionReplyToId || message.asyncQuestionReplyToId === entry.message.id))
        .filter(({ entry }) => matchesAsyncAnswer(entry.question, reply) || Boolean(message.asyncQuestionReplyToId && reply.trim()));
      if (candidates.length === 1) candidates[0]!.entry.confirmedText = reply;
    }
    if (outcome === 'successful') success.push({ index, start: run ? starts.get(run) ?? -1 : lastUser, ...(run ? { run } : {}), key: JSON.stringify([run, message.id]) });
  }
  return [...entries.values()].map(({ entry, index, origin, run }) => {
    const owning = origin ? runs.get(origin) : undefined;
    const boundary = success.filter(s => {
      // A restarted turn may retire an unsettled pre-restart reminder only
      // after recovery succeeds. Starting/recovering by itself is not enough.
      const recoveredAt = s.run ? recoveries.get(s.run) : undefined;
      if (recoveredAt !== undefined && recoveredAt > index && recoveredAt < s.index) return true;
      if (owning) {
        if (owning.settled === undefined || owning.settled <= index) return false;
        return run ? Boolean(s.run && runs.get(s.run)!.first > owning.last) : s.start > owning.last;
      }
      return run ? Boolean(s.run && runs.get(s.run)!.first > index) : s.start > index;
    }).at(-1);
    return { ...entry, ...(boundary ? { boundary: boundary.key } : {}) };
  });
}
