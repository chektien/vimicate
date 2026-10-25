import type { QuestionAnswers, QuestionRecord } from './questionTypes';
export type AsyncQuestion = { itemId: string; questions: { title: string; wireTitle?: string; options?: string[]; wireOptions?: string[]; multiSelect?: boolean; isSecret?: boolean }[] };
export type AsyncQuestionMetadata = { asyncQuestion?: AsyncQuestion; asyncMessage?: boolean; asyncQuestionPrivate?: boolean; asyncQuestionAnswerText?: string; asyncQuestionRunOutcome?: 'settled' | 'successful'; asyncQuestionRestartRecovery?: boolean; asyncQuestionReplyToId?: string };
const record = (value: unknown): Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const text = (value: unknown, limit: number): value is string => typeof value === 'string' && value.length <= limit && Boolean(value.trim());
/** Installed Control UI Qm boundary, extended only to fail closed for private input. */
export function parseAsyncQuestion(value: unknown): AsyncQuestion | undefined {
  const row = record(value);
  if (!text(row.itemId, 256) || !Array.isArray(row.questions) || row.questions.length < 1 || row.questions.length > 12) return;
  const questions: AsyncQuestion['questions'] = [];
  for (const value of row.questions) {
    const q = record(value);
    if (!text(q.title, 4096) || q.options !== undefined && (!Array.isArray(q.options) || q.options.length < 1 || q.options.length > 4 || !q.options.every(o => text(o, 256)))) return;
    if (q.multiSelect !== undefined && typeof q.multiSelect !== 'boolean' || q.isSecret !== undefined && typeof q.isSecret !== 'boolean') return;
    const secret = q.isSecret === true || q.secretStore !== undefined;
    questions.push(secret ? { title: 'Private input · Answer elsewhere in OpenClaw', isSecret: true } : {
      title: privateQuestionText(q.title), ...(privateQuestionText(q.title) !== q.title ? { wireTitle: q.title } : {}), ...(q.options ? safeOptions(q.options as string[]) : {}), ...(q.multiSelect === true ? { multiSelect: true } : {}),
    });
  }
  return { itemId: row.itemId, questions };
}
export function asyncQuestionMetadata(raw: Record<string, unknown>): AsyncQuestionMetadata {
  const native = record(raw.__openclaw); const provenance = record(raw.provenance);
  const privateInput = Array.isArray(record(raw.openclawAsyncDelivery).questions) && (record(raw.openclawAsyncDelivery).questions as unknown[]).some(value => { const q = record(value); return q.isSecret === true || q.secretStore !== undefined; });
  const asyncQuestion = raw.role === 'assistant' ? parseAsyncQuestion(raw.openclawAsyncDelivery) : undefined;
  const stop = typeof raw.stopReason === 'string' ? raw.stopReason.toLowerCase() : '';
  const channel = raw.channel ?? record(raw.openclawStreamFallback).channel;
  const failed = record(raw.openclawAbort).aborted === true || ['aborted', 'cancelled', 'canceled', 'timeout', 'timed_out', 'error'].includes(stop) || raw.isError === true;
  const terminal = raw.role === 'assistant' && !raw.openclawAsyncDelivery && !raw.openclawStreamFallback && provenance.kind !== 'inter_session' && stop !== 'tooluse' && stop !== 'tool_use'
    && (native.runTerminal === true || native.mirrorOrigin !== 'codex-app-server' && (channel === 'final_answer' || stop === 'stop' || failed));
  return { ...(raw.role === 'assistant' && raw.openclawAsyncDelivery ? { asyncMessage: true, ...(privateInput ? { asyncQuestionPrivate: true } : {}) } : {}), ...(asyncQuestion ? { asyncQuestion } : {}), ...(terminal ? { asyncQuestionRunOutcome: failed || channel === 'commentary' ? 'settled' as const : 'successful' as const } : {}),
    ...(provenance.kind === 'internal_system' && provenance.sourceTool === 'main_session_restart_recovery' ? { asyncQuestionRestartRecovery: true } : {}),
    ...(raw.role === 'user' && text(native.replyToId, 512) ? { asyncQuestionReplyToId: native.replyToId } : {}) };
}
/** Never surface host paths/obvious credentials in question labels or their readable fallback. */
export function privateQuestionText(value: string): string {
  return value.replace(/(?:file:\/\/)?(?:\/(?:Users|home|tmp|private|var|opt|etc|Volumes)\/|~\/|[A-Za-z]:\\)[^\s<>"'`]+/g, '[local file]')
    .replace(/\b(?:sk-[A-Za-z0-9_-]{12,}|Bearer\s+[A-Za-z0-9._-]{12,})\b/g, '[private value]');
}
/** Control UI Wm: clip at 512 UTF-8 bytes before replacing CR/LF, not 512 characters. */
export function asyncQuestionQuote(title: string) {
  let clipped = ''; let bytes = 0;
  for (const char of title) {
    const code = char.codePointAt(0)!; bytes += code <= 0x7f ? 1 : code <= 0x7ff ? 2 : code <= 0xffff ? 3 : 4;
    if (bytes > 512) break; clipped += char;
  }
  return `> ${clipped.replace(/[\r\n]/g, ' ')}`;
}
export function formatAsyncAnswer(question: AsyncQuestion, answers: QuestionAnswers) {
  return question.questions.map((q, i) => `${asyncQuestionQuote(q.wireTitle ?? q.title)}\n\n${answers.answers[String(i)]?.map(value => q.wireOptions && q.options?.includes(value) ? q.wireOptions[q.options.indexOf(value)]! : value).join(', ') ?? ''}`).join('\n\n');
}
/** Conservative Control UI Um parser. Ambiguous quoted headings stay unsplit. */
export function matchesAsyncAnswer(question: AsyncQuestion, value: string) {
  let offset = 0;
  for (let i = 0; i < question.questions.length; i++) {
    const heading = `${asyncQuestionQuote(question.questions[i]!.wireTitle ?? question.questions[i]!.title)}\n\n`;
    if (!value.startsWith(heading, offset)) return false; offset += heading.length;
    const next = question.questions[i + 1];
    if (!next) return Boolean(value.slice(offset).trim());
    const separator = `\n\n${asyncQuestionQuote(next.wireTitle ?? next.title)}\n\n`; const end = value.indexOf(separator, offset);
    if (end < offset || value.includes(separator, end + separator.length) || !value.slice(offset, end).trim()) return false;
    offset = end + 2;
  }
  return false;
}
export function asyncQuestionRecord(question: AsyncQuestion, sessionKey: string, runId?: string): QuestionRecord {
  return { id: JSON.stringify([sessionKey, question.itemId]), sessionKey, ...(runId ? { runId } : {}), status: 'pending', createdAtMs: 0, expiresAtMs: Number.MAX_SAFE_INTEGER,
    questions: question.questions.map((q, i) => ({ questionId: String(i), header: '', question: q.title, options: (q.options ?? []).map(label => ({ label })), isOther: true, ...(q.multiSelect ? { multiSelect: true } : {}), ...(q.isSecret ? { isSecret: true } : {}) })) };
}

function safeOptions(options: string[]) {
  const safe = options.map(privateQuestionText);
  return safe.some((s, i) => s !== options[i]) ? { options: safe.map((s, i) => safe.filter(o => o === s).length > 1 ? `${s} (choice ${i + 1})` : s), wireOptions: options } : { options: safe };
}
/** Cache stores only these validated projection facts, not a raw Gateway record. */
export function persistedAsyncMetadata(value: Record<string, unknown>): AsyncQuestionMetadata {
  const candidate = record(value.asyncQuestion);
  const questions = Array.isArray(candidate.questions) ? candidate.questions.map(value => { const q = record(value); return { ...q, title: text(q.wireTitle, 4096) && privateQuestionText(q.wireTitle) === q.title ? q.wireTitle : q.title, options: Array.isArray(q.wireOptions) && q.wireOptions.every(o => text(o, 256)) ? q.wireOptions : q.options }; }) : undefined;
  const question = value.role === 'assistant' ? parseAsyncQuestion({ ...candidate, questions }) : undefined;
  return { ...(question ? { asyncQuestion: question } : {}), ...(value.role === 'assistant' && value.asyncMessage === true ? { asyncMessage: true, ...(value.asyncQuestionPrivate === true ? { asyncQuestionPrivate: true } : {}) } : {}),
    ...(value.asyncQuestionRunOutcome === 'successful' || value.asyncQuestionRunOutcome === 'settled' ? { asyncQuestionRunOutcome: value.asyncQuestionRunOutcome } : {}),
    ...(value.asyncQuestionRestartRecovery === true ? { asyncQuestionRestartRecovery: true } : {}),
    ...(value.role === 'user' && text(value.asyncQuestionAnswerText, 64000) ? { asyncQuestionAnswerText: value.asyncQuestionAnswerText } : {}),
    ...(value.role === 'user' && text(value.asyncQuestionReplyToId, 512) ? { asyncQuestionReplyToId: value.asyncQuestionReplyToId } : {}) };
}

export function sameAsyncQuestion(left: AsyncQuestion | undefined, right: AsyncQuestion | undefined): boolean {
  return left === right || Boolean(left && right && left.itemId === right.itemId && left.questions.length === right.questions.length && left.questions.every((q, i) => { const other = right.questions[i]!; return q.title === other.title && q.wireTitle === other.wireTitle && q.multiSelect === other.multiSelect && q.isSecret === other.isSecret && sameOptions(q.options, other.options) && sameOptions(q.wireOptions, other.wireOptions); }));
}
function sameOptions(left: string[] | undefined, right: string[] | undefined) { return left === right || Boolean(left && right && left.length === right.length && left.every((option, i) => option === right[i])); }
