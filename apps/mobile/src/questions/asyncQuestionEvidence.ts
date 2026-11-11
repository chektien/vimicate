import type { WorkspaceMessage } from '../workspace/workspaceTypes';
export type QuestionRunEvidence = { id: string; first: number; last: number; start?: number; settled?: number; successful?: number; terminalId?: string; recovery?: number };
export type QuestionCausalEvidence = { sessionKey: string; generation: string; source: string; coordinate: number; origin: string; runs: QuestionRunEvidence[] };
export function questionCausalEvidence(message: WorkspaceMessage): QuestionCausalEvidence | undefined {
  const p = message.displayPosition;
  if (!message.sessionKey || !message.transcriptSessionId || !message.runId || !p || p.activity) return;
  return { sessionKey: message.sessionKey, generation: message.transcriptSessionId, source: p.source, coordinate: p.rawSeq, origin: message.runId, runs: [] };
}
/** Retain causal witnesses, not page rows or a fabricated coordinate-only tail. */
export function reconcileQuestionEvidence(evidence: QuestionCausalEvidence, messages: WorkspaceMessage[]): string | undefined {
  for (const message of messages) {
    const p = message.displayPosition;
    if (message.sessionKey !== evidence.sessionKey || message.transcriptSessionId !== evidence.generation || !message.runId || !p || p.activity || p.source !== evidence.source) continue;
    let run = evidence.runs.find(run => run.id === message.runId);
    if (!run) { run = { id: message.runId, first: p.rawSeq, last: p.rawSeq }; evidence.runs.push(run); }
    run.first = Math.min(run.first, p.rawSeq); run.last = Math.max(run.last, p.rawSeq);
    if (message.role === 'user' && !message.id.startsWith('pending-input:')) run.start = Math.min(run.start ?? p.rawSeq, p.rawSeq);
    if (message.asyncQuestionRestartRecovery) run.recovery = Math.min(run.recovery ?? p.rawSeq, p.rawSeq);
    if (message.asyncQuestionRunOutcome && p.rawSeq >= (run.settled ?? -1)) { run.settled = p.rawSeq; if (message.asyncQuestionRunOutcome === 'successful') { run.successful = p.rawSeq; run.terminalId = message.id; } else { delete run.successful; delete run.terminalId; } }
  }
  const origin = evidence.runs.find(run => run.id === evidence.origin);
  const boundary = evidence.runs.filter(run => run.successful !== undefined && run.successful > evidence.coordinate && run.id !== evidence.origin && (
    run.recovery !== undefined && run.recovery > evidence.coordinate && run.recovery < run.successful
    || origin?.settled !== undefined && origin.settled > evidence.coordinate && run.start !== undefined && run.first > origin.last && run.start < run.successful
  )).sort((a, b) => a.successful! - b.successful!).at(-1);
  // Keep the proof that already retires this question, not only recent runs.
  // Later unrelated failures must not resurrect an unanswered marker.
  const retained = new Set([evidence.origin, boundary?.id]);
  evidence.runs.sort((a, b) => Number(retained.has(b.id)) - Number(retained.has(a.id)) || b.last - a.last);
  evidence.runs = evidence.runs.slice(0, 16);
  return boundary ? JSON.stringify([boundary.id, boundary.terminalId]) : undefined;
}
export function restoredQuestionEvidence(value: unknown): QuestionCausalEvidence | undefined {
  if (!value || typeof value !== 'object') return;
  const e = value as QuestionCausalEvidence;
  const key = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length <= 512;
  const seq = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
  if (![e.sessionKey, e.generation, e.source, e.origin].every(key) || !seq(e.coordinate) || !Array.isArray(e.runs) || e.runs.length > 16) return;
  if (!e.runs.every(r => r && key(r.id) && seq(r.first) && seq(r.last) && r.first <= r.last && [r.start, r.settled, r.successful, r.recovery].every(v => v === undefined || seq(v)) && (r.terminalId === undefined || key(r.terminalId)))) return;
  if (!e.runs.every(r => [r.start, r.settled, r.successful, r.recovery].every(v => v === undefined || v >= r.first && v <= r.last) && (r.successful === undefined || r.settled !== undefined && r.successful <= r.settled && r.terminalId !== undefined))) return;
  return e;
}
