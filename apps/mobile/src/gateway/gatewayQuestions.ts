import { z } from 'zod';
import { questionNeedsOtherSurface, type QuestionRecord } from '../questions/questionTypes';
import type { WorkspaceMessage } from '../workspace/workspaceTypes';
const identity = z.string().trim().min(1).max(512);
const questionId = z.string().regex(/^[a-z][a-z0-9_]*$/).max(128);
const answersSchema = z.object({ answers: z.record(questionId, z.array(z.string().max(65536)).max(4)) });
const questionSchema = z.object({
  questionId, header: z.string().max(12), question: z.string().min(1).max(65536),
  options: z.array(z.object({ label: z.string().min(1).max(65536), description: z.string().max(65536).optional() })).max(4),
  multiSelect: z.boolean().optional(), isOther: z.boolean().optional(), isSecret: z.boolean().optional(), url: z.string().min(1).max(2048).optional(),
  secretStore: z.object({ name: z.string().regex(/^[A-Z][A-Z0-9_]{0,127}$/), kind: z.enum(['secret', 'env']), allowedHosts: z.array(z.string().min(1).max(253)).max(128).optional(), reason: z.string().max(200).optional() }).optional(),
});
const recordSchema = z.object({
  id: identity, sessionKey: identity, runId: identity.optional(), agentId: identity.optional(),
  questions: z.array(questionSchema).min(1).max(3), createdAtMs: z.number().int().nonnegative(), expiresAtMs: z.number().int().nonnegative(),
  status: z.enum(['pending', 'answered', 'cancelled', 'expired']), answers: answersSchema.optional(), resolvedBy: identity.optional(),
});
const resolvedSchema = z.discriminatedUnion('status', [
  z.object({ id: identity, status: z.literal('answered'), answers: answersSchema }),
  z.object({ id: identity, status: z.literal('cancelled') }), z.object({ id: identity, status: z.literal('expired') }),
]);
export function questionRecordFromPayload(value: unknown): QuestionRecord | null {
  const result = recordSchema.safeParse(value);
  if (!result.success) return null;
  const record = result.data;
  if (new Set(record.questions.map(q => q.questionId)).size !== record.questions.length || record.expiresAtMs < record.createdAtMs) return null;
  if (record.status === 'answered' && !record.answers || record.status !== 'answered' && record.answers) return null;
  return record.status === 'answered' && questionNeedsOtherSurface(record) ? { ...record, answers: { answers: {} } } : record;
}
/** One connection-owned bounded registry; resolved events have no session field. */
export class GatewayQuestionOwner {
  private records = new Map<string, { record: QuestionRecord; revision: number }>();
  revision = 0; epoch = 0;
  ids() { return new Set(this.records.keys()); }
  clear() { this.records.clear(); this.epoch++; this.revision++; }
  forSession(sessionKey: string) { return [...this.records.values()].map(v => v.record).filter(q => q.sessionKey === sessionKey); }
  pendingSessions() { return new Set([...this.records.values()].filter(v => v.record.status === 'pending').map(v => v.record.sessionKey)); }
  get(id: string, sessionKey: string) { return this.forSession(sessionKey).find(q => q.id === id); }
  private put(record: QuestionRecord) {
    this.records.set(record.id, { record, revision: ++this.revision });
    while (this.records.size > 128) {
      const oldest = [...this.records].find(([, value]) => value.record.status !== 'pending')?.[0] ?? this.records.keys().next().value;
      if (oldest) this.records.delete(oldest); else break;
    }
  }
  event(frame: { event?: unknown; payload?: unknown }) {
    if (frame.event === 'question.requested') {
      const record = questionRecordFromPayload(frame.payload); if (!record) return false;
      const previous = this.records.get(record.id)?.record;
      if (previous && (previous.sessionKey !== record.sessionKey || previous.status !== 'pending')) return false;
      this.put(record); return true;
    }
    if (frame.event !== 'question.resolved') return false;
    const result = resolvedSchema.safeParse(frame.payload); if (!result.success) return false;
    const previous = this.records.get(result.data.id)?.record; if (!previous) return false;
    this.put({ ...previous, ...result.data, ...(result.data.status === 'answered' && questionNeedsOtherSurface(previous) ? { answers: { answers: {} } } : {}) }); return true;
  }
  hydrate(payload: unknown, startedRevision: number) {
    const parsed = z.object({ questions: z.array(z.unknown()).max(1024) }).safeParse(payload);
    if (!parsed.success) throw new Error('Invalid Gateway question.list response');
    const records = parsed.data.questions.map(questionRecordFromPayload).filter((q): q is QuestionRecord => Boolean(q));
    const found = new Set(records.map(q => q.id));
    for (const record of records) {
      const previous = this.records.get(record.id);
      if (previous && (previous.revision > startedRevision || previous.record.sessionKey !== record.sessionKey
        || previous.record.status !== 'pending' && record.status === 'pending')) continue;
      this.put(record);
    }
    for (const [id, previous] of this.records) {
      if (previous.revision <= startedRevision && previous.record.status === 'pending' && !found.has(id)) this.put({ ...previous.record, status: 'cancelled', recoveredElsewhere: true });
    }
  }
  expire(now: number) {
    let changed = false;
    for (const value of this.records.values()) if (value.record.status === 'pending' && value.record.expiresAtMs <= now) { this.put({ ...value.record, status: 'expired' }); changed = true; }
    return changed;
  }
}
export function questionMessages(messages: WorkspaceMessage[], records: QuestionRecord[]) {
  if (!records.length) return messages;
  const base = messages.filter(message => !message.question);
  const slots = new Map<number, WorkspaceMessage[]>();
  const ordered = [...records].sort((a, b) => a.createdAtMs - b.createdAtMs || a.sessionKey.localeCompare(b.sessionKey) || a.id.localeCompare(b.id));
  for (const question of ordered) {
    const answer = !questionNeedsOtherSurface(question) && question.answers ? Object.values(question.answers.answers).map(values => values.join(', ')).join(' · ') : '';
    const text = question.status === 'pending' ? 'Waiting for your answer' : question.recoveredElsewhere ? 'Question resolved elsewhere' : `Question ${question.status}${answer ? ` · ${answer}` : ''}`;
    const row: WorkspaceMessage = { id: `question:${question.sessionKey}:${question.id}`, role: 'approval', text, sessionKey: question.sessionKey, ...(question.runId ? { runId: question.runId } : {}), timestamp: String(question.createdAtMs), source: 'live', state: question.status === 'pending' ? 'streaming' : 'complete', question };
    const index = questionInsertionIndex(base, question);
    const slot = slots.get(index) ?? [];
    slot.push(row); slots.set(index, slot);
  }
  return base.flatMap((message, index) => [...(slots.get(index) ?? []), message]).concat(slots.get(base.length) ?? []);
}

/** Questions have creation time but no native position. Insert into the base
 * vector without sorting it or allowing other question rows to become anchors. */
function questionInsertionIndex(messages: WorkspaceMessage[], question: QuestionRecord) {
  const compatible = (message: WorkspaceMessage) => !message.sessionKey || message.sessionKey === question.sessionKey;
  const owns = (message: WorkspaceMessage) => compatible(message) && Boolean(question.runId) && message.runId === question.runId;
  const start = messages.findIndex(owns);
  let end = messages.length;
  if (start >= 0) {
    for (let i = start + 1; i < messages.length; i++) {
      const message = messages[i]!;
      if (!compatible(message)) continue;
      // A later replay of this run cannot pull an old question past a new turn
      // or across a generation boundary, even with missing/skewed clocks.
      if (message.role === 'boundary' || message.runId && message.runId !== question.runId) { end = i; break; }
    }
  }
  // The explicit owning prompt is a causal floor, not a clock comparison.
  const from = start < 0 ? 0 : start + (messages[start]?.role === 'user' ? 1 : 0);
  let after = start < 0 ? messages.length : from;
  for (let i = from; i < end; i++) {
    const message = messages[i]!;
    if (!compatible(message)) continue;
    const time = questionPlacementTime(message.timestamp);
    if (time !== null && time > question.createdAtMs) return i;
    // Unknown timestamps stay in native order as potential supporting context.
    after = i + 1;
  }
  return after;
}
function questionPlacementTime(value: string | undefined) {
  if (!value?.trim()) return null;
  const numeric = Number(value);
  const time = Number.isFinite(numeric) ? numeric : Date.parse(value);
  return Number.isFinite(time) ? time : null;
}
