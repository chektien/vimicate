import type { WorkspaceMessage } from '../workspace/workspaceTypes';
import { asyncQuestionHistory, type AsyncQuestionHistoryEntry } from './asyncQuestionHistory';
import { asyncQuestionRecord, formatAsyncAnswer, parseAsyncQuestion } from './asyncQuestionContract';
import { chooseQuestionOther, chooseQuestionOption, emptyQuestionDraft, questionDraftAnswers, type QuestionDraft } from './questionDraft';
import { questionNeedsOtherSurface, type QuestionRecord } from './questionTypes';
export type AsyncAnswerDeliveryState = 'queued' | 'sending' | 'failed' | 'unconfirmed' | 'confirmed';
export type AsyncAnswerDelivery = { id: string; text: string; sessionKey: string; sourceMessageId?: string; state: AsyncAnswerDeliveryState };
type Fact = { id: string; signature: string; draft: QuestionDraft; edited?: boolean; collapsed?: boolean; skipped?: boolean; reopenedBoundary?: string; boundary?: string; confirmedText?: string; delivery?: AsyncAnswerDelivery };
export type AsyncQuestionView = { record: QuestionRecord; collapsed: boolean; state: AsyncAnswerDeliveryState | 'pending' | 'history' | 'skipped'; delivery?: AsyncAnswerDelivery; confirmedText?: string; error?: string };
const LIMIT = 128; const BYTE_LIMIT = 512_000;
export class AsyncQuestionOwner {
  private facts = new Map<string, Fact>();
  private history = new Map<string, AsyncQuestionHistoryEntry>();
  revision = 0; epoch = 0;
  clear() { this.facts.clear(); this.history.clear(); this.revision++; this.epoch++; }
  observe(messages: WorkspaceMessage[]) {
    for (const entry of asyncQuestionHistory(messages)) {
      const record = asyncQuestionRecord(entry.question, entry.message.sessionKey!, entry.message.runId);
      let fact = this.facts.get(record.id); const signature = JSON.stringify(entry.question);
      if (fact && fact.signature !== signature && !fact.delivery) { this.facts.delete(record.id); fact = undefined; }
      if (!fact) {
        if (this.facts.size >= LIMIT) {
          const disposable = [...this.facts.values()].find(f => !f.delivery || f.delivery.state === 'confirmed');
          if (!disposable) continue;
          this.facts.delete(disposable.id); this.history.delete(disposable.id);
        }
        fact = { id: record.id, signature, draft: { ...emptyQuestionDraft(), selected: Object.fromEntries(record.questions.map(q => [q.questionId, q.options.slice(0, 1).map(o => o.label)])) } };
        this.facts.set(record.id, fact); this.revision++;
      }
      this.history.set(record.id, entry);
      if (entry.boundary && fact.boundary !== entry.boundary) { fact.boundary = entry.boundary; this.revision++; }
      const saved = entry.confirmedText ?? (fact.delivery ? messages.find(m => m.role === 'user' && m.source === 'history' && !m.id.startsWith('pending-input:') && m.sessionKey === fact!.delivery!.sessionKey && m.idempotencyKey === fact!.delivery!.id)?.text : undefined);
      if (saved && fact.confirmedText !== saved) { fact.confirmedText = saved; if (fact.delivery) fact.delivery.state = 'confirmed'; this.revision++; }
    }
  }
  view(message: WorkspaceMessage): AsyncQuestionView | undefined {
    if (!message.asyncQuestion || !message.sessionKey) return;
    const record = asyncQuestionRecord(message.asyncQuestion, message.sessionKey, message.runId); const fact = this.facts.get(record.id); if (!fact) return;
    const state = fact.confirmedText ? 'confirmed' : fact.delivery?.state ?? (fact.skipped ? 'skipped' : fact.boundary && !fact.edited && fact.reopenedBoundary !== fact.boundary ? 'history' : 'pending');
    return { record, collapsed: Boolean(fact.collapsed), state, ...(fact.delivery ? { delivery: fact.delivery } : {}), ...(fact.confirmedText ? { confirmedText: fact.confirmedText } : {}) };
  }
  message(id: string) { return this.history.get(id)?.message; }
  queued(): [string, AsyncAnswerDelivery][] { return [...this.facts.values()].flatMap(f => f.delivery?.state === 'queued' ? [[f.id, f.delivery] as [string, AsyncAnswerDelivery]] : []); }
  ownsDelivery(id: string, delivery: AsyncAnswerDelivery) { const fact = this.facts.get(id); return fact?.delivery === delivery && !fact.confirmedText; }
  draft(record: QuestionRecord) { return this.facts.get(record.id)?.draft ?? emptyQuestionDraft(); }
  update(record: QuestionRecord, draft: QuestionDraft) { const fact = this.facts.get(record.id); if (!fact || fact.delivery || fact.confirmedText || questionNeedsOtherSurface(record)) return; if (JSON.stringify(fact.draft.selected) !== JSON.stringify(draft.selected) || JSON.stringify(fact.draft.text) !== JSON.stringify(draft.text) || JSON.stringify(fact.draft.other) !== JSON.stringify(draft.other)) fact.edited = true; fact.draft = draft; this.revision++; }
  choose(record: QuestionRecord, question: number, option: number) { this.update(record, chooseQuestionOption(record, this.draft(record), option, question)); }
  text(record: QuestionRecord, index: number, text: string) { const q = record.questions[index]; if (q) this.update(record, { ...chooseQuestionOther(record, this.draft(record), index), text: { ...this.draft(record).text, [q.questionId]: text.slice(0, 4096) } }); }
  collapse(id: string) { const fact = this.facts.get(id); if (fact) { fact.collapsed = true; this.revision++; } }
  expand(id: string) { const fact = this.facts.get(id); if (fact) { fact.collapsed = false; this.revision++; } }
  skip(id: string) { const fact = this.facts.get(id); if (fact && !fact.delivery) { fact.skipped = true; this.revision++; } }
  reopen(id: string) { const fact = this.facts.get(id); if (!fact || fact.delivery || fact.confirmedText) return; fact.skipped = false; fact.collapsed = false; fact.edited = false; if (fact.boundary) fact.reopenedBoundary = fact.boundary; this.revision++; }
  admit(message: WorkspaceMessage, id: string): AsyncAnswerDelivery | null {
    const view = this.view(message); if (!view || view.state !== 'pending' || questionNeedsOtherSurface(view.record)) return null;
    const fact = this.facts.get(view.record.id)!; if (fact.delivery) return null;
    const answers = questionDraftAnswers(view.record, fact.draft); if (!answers) return null;
    const entry = this.history.get(view.record.id);
    const sourceMessageId = entry?.message.source === 'history' ? entry.message.id : undefined;
    fact.delivery = { id, sessionKey: view.record.sessionKey, text: formatAsyncAnswer(message.asyncQuestion!, answers), state: 'queued', ...(sourceMessageId ? { sourceMessageId } : {}) };
    if ([...this.facts.values()].filter(f => f.delivery && f.delivery.state !== 'confirmed').reduce((size, f) => size + JSON.stringify(f).length + 1, 2) > BYTE_LIMIT) { delete fact.delivery; return null; }
    this.revision++; return fact.delivery;
  }
  delivery(id: string, state: AsyncAnswerDeliveryState | 'accepted') { const fact = this.facts.get(id); if (!fact?.delivery || fact.confirmedText) return; fact.delivery.state = state === 'accepted' ? 'unconfirmed' : state; this.revision++; }
  retry(id: string): AsyncAnswerDelivery | null { const fact = this.facts.get(id); if (!fact?.delivery || fact.confirmedText || !['failed', 'unconfirmed', 'queued'].includes(fact.delivery.state)) return null; fact.delivery.state = 'queued'; if ([...this.facts.values()].filter(f => f.delivery && f.delivery.state !== 'confirmed').reduce((size, f) => size + JSON.stringify(f).length + 1, 2) > BYTE_LIMIT) { delete fact.delivery; return null; }
    this.revision++; return fact.delivery; }
  discard(id: string) { const fact = this.facts.get(id); if (!fact?.delivery || fact.confirmedText || fact.delivery.state === 'sending') return; delete fact.delivery; fact.skipped = false; fact.collapsed = false; if (fact.boundary) fact.reopenedBoundary = fact.boundary; this.revision++; }
  serialize() {
    const retained: Fact[] = []; let bytes = 2;
    const all = [...this.facts.values()].reverse(); const ordered = [...all.filter(f => f.delivery && f.delivery.state !== 'confirmed'), ...all.filter(f => !f.delivery || f.delivery.state === 'confirmed')];
    for (const fact of ordered) { const size = JSON.stringify(fact).length + 1; if (bytes + size > BYTE_LIMIT) continue; retained.push(fact); bytes += size; }
    return JSON.stringify(retained.reverse());
  }
  restore(payload: string | null) {
    if (!payload || payload.length > BYTE_LIMIT) return;
    try { const raw: unknown = JSON.parse(payload); if (!Array.isArray(raw)) return;
      for (const value of raw.slice(-LIMIT)) {
        const fact = restoredFact(value); if (!fact) continue; const current = this.facts.get(fact.id); if (current?.edited || current?.delivery || current?.confirmedText || current && current.signature !== fact.signature) continue; if (current?.boundary) fact.boundary = current.boundary;
        if (fact.delivery?.state === 'sending') fact.delivery.state = 'unconfirmed';
        this.facts.set(fact.id, fact); this.revision++;
      }
    } catch { /* Invalid storage never authorizes delivery. */ }
  }
}
function restoredFact(value: unknown): Fact | null {
  if (!value || typeof value !== 'object') return null;
  const f = value as Fact;
  if (typeof f.id !== 'string' || f.id.length > 2048 || typeof f.signature !== 'string' || f.signature.length > 64000 || !f.draft || !Number.isInteger(f.draft.active) || f.draft.active < 0 || f.draft.active > 12 || !Number.isInteger(f.draft.cursor) || f.draft.cursor < 0 || f.draft.cursor > 4) return null;
  let signature: ReturnType<typeof parseAsyncQuestion>;
  try { signature = parseAsyncQuestion(JSON.parse(f.signature)); } catch { return null; }
  if (!signature || f.draft.active > signature.questions.length
    || f.draft.cursor > (f.draft.active === signature.questions.length ? 2 : signature.questions[f.draft.active]!.options?.length ?? 0)) return null;
  const selected = f.draft.selected; const text = f.draft.text;
  if (!selected || !text || typeof selected !== 'object' || typeof text !== 'object' || Object.keys(selected).length > 12 || Object.keys(text).length > 12
    || !Object.entries(selected).every(([k, v]) => /^\d{1,2}$/.test(k) && Array.isArray(v) && v.length <= 4 && v.every(s => typeof s === 'string' && s.length <= 256))
    || !Object.entries(text).every(([k, v]) => /^\d{1,2}$/.test(k) && typeof v === 'string' && v.length <= 4096)) return null;
  const other = f.draft.other;
  if (other !== undefined && (!other || typeof other !== 'object' || Array.isArray(other) || Object.keys(other).length > 12 || !Object.entries(other).every(([k, v]) => /^\d{1,2}$/.test(k) && Number(k) < signature.questions.length && typeof v === 'boolean'))) return null;
  let identity: unknown; try { identity = JSON.parse(f.id); } catch { return null; }
  if (!Array.isArray(identity) || identity.length !== 2 || !identity.every(i => typeof i === 'string' && i.length > 0)) return null;
  if (f.delivery && (typeof f.delivery.id !== 'string' || f.delivery.id.length > 256 || typeof f.delivery.text !== 'string' || f.delivery.text.length > 64000 || f.delivery.sessionKey !== identity[0] || f.delivery.sourceMessageId !== undefined && (typeof f.delivery.sourceMessageId !== 'string' || f.delivery.sourceMessageId.length > 512) || !['queued', 'sending', 'failed', 'unconfirmed', 'confirmed'].includes(f.delivery.state))) return null;
  return { id: f.id, signature: f.signature, draft: { active: f.draft.active, cursor: f.draft.cursor, selected: { ...selected }, text: { ...text }, ...(other ? { other: { ...other } } : {}) },
    ...(f.edited === true ? { edited: true } : {}), ...(f.collapsed === true ? { collapsed: true } : {}), ...(f.skipped === true ? { skipped: true } : {}),
    ...(typeof f.boundary === 'string' && f.boundary.length <= 1024 ? { boundary: f.boundary } : {}), ...(typeof f.reopenedBoundary === 'string' && f.reopenedBoundary.length <= 1024 ? { reopenedBoundary: f.reopenedBoundary } : {}),
    ...(typeof f.confirmedText === 'string' && f.confirmedText.length <= 64000 ? { confirmedText: f.confirmedText } : {}), ...(f.delivery ? { delivery: { ...f.delivery } } : {}) };
}
