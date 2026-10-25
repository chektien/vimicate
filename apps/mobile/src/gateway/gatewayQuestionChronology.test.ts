import { describe, expect, it } from 'vitest';
import { GatewayQuestionOwner, questionMessages } from './gatewayQuestions';
import type { QuestionRecord } from '../questions/questionTypes';
import type { WorkspaceMessage } from '../workspace/workspaceTypes';

const at = Date.parse('2026-10-22T15:50:00Z');
const question = (extra: Partial<QuestionRecord> = {}): QuestionRecord => ({
  id: 'decision', sessionKey: 'synthetic-review', runId: 'review-run',
  createdAtMs: at, expiresAtMs: at + 86400000, status: 'answered',
  answers: { answers: { choice: ['Accept'] } },
  questions: [{ questionId: 'choice', header: 'Review', question: 'Use this synthetic review?', options: [{ label: 'Accept' }, { label: 'Revise' }] }], ...extra,
});
const row = (id: string, timestamp?: string, extra: Partial<WorkspaceMessage> = {}): WorkspaceMessage => ({
  id, role: 'assistant', text: 'Synthetic review content', sessionKey: 'synthetic-review',
  ...(timestamp === undefined ? {} : { timestamp }), source: 'history', ...extra,
});
const qid = 'question:synthetic-review:decision';
const ids = (messages: WorkspaceMessage[], records = [question()]) => questionMessages(messages, records).map(m => m.id);

describe('Gateway question placement chronology', () => {
  it('places an unmatched ISO question between prior context and the next day', () => {
    expect(ids([row('review', new Date(at - 1000).toISOString()), row('next-day', '2026-10-22T16:02:00Z')]))
      .toEqual(['review', qid, 'next-day']);
  });
  it('places an older numeric question before the entire loaded window', () => {
    expect(ids([row('next-day', String(at + 720000))])).toEqual([qid, 'next-day']);
  });
  it('does not move a question after later continuation of its own run', () => {
    expect(ids([row('review', String(at - 1000), { runId: 'review-run' }), row('continuation', String(at + 720000), { runId: 'review-run' })]))
      .toEqual(['review', qid, 'continuation']);
  });
});


describe('question placement controls and restoration', () => {
  it.each(['pending', 'answered', 'cancelled', 'expired'] as const)('retains creation placement when %s', status => {
    const q = question({ status, ...(status === 'answered' ? {} : { answers: undefined }) });
    for (const stamp of [(n: number) => String(n), (n: number) => new Date(n).toISOString()]) {
      const base = [row('review', stamp(at - 1), { runId: 'review-run' }), row('later', stamp(at + 1), { runId: 'review-run' })];
      const projected = questionMessages(base, [q]);
      expect(projected.map(m => m.id)).toEqual(['review', qid, 'later']);
      expect(projected[1]).toMatchObject({ timestamp: String(at), state: status === 'pending' ? 'streaming' : 'complete', question: q });
      expect(projected.filter(m => !m.question)).toEqual(base);
    }
  });
  it('keeps numeric fallback context and a distinct owning run before a newer run', () => {
    expect(ids([row('review', String(at - 1)), row('newer', String(at + 1))])).toEqual(['review', qid, 'newer']);
    // Run authority beats a skewed timestamp on a different run.
    expect(ids([row('review', String(at - 1), { runId: 'review-run' }), row('newer', String(at - 10), { runId: 'new-run' })]))
      .toEqual(['review', qid, 'newer']);
  });
  it('does not sort native base records, even when their clocks run backwards', () => {
    const base = [row('review', String(at - 1), { runId: 'review-run', displayPosition: { source: 'native', rawSeq: 1 } }),
      row('newer-run', String(at + 3), { runId: 'new-run', displayPosition: { source: 'native', rawSeq: 2 } }),
      row('skewed-tail', String(at - 3), { runId: 'new-run', displayPosition: { source: 'native', rawSeq: 3 } })];
    const before = JSON.stringify(base);
    expect(ids(base)).toEqual(['review', qid, 'newer-run', 'skewed-tail']);
    expect(JSON.stringify(base)).toBe(before);
  });
  it('keeps untimestamped owning context before the question without crossing into a newer run', () => {
    expect(ids([row('review', undefined, { runId: 'review-run' }), row('tool', 'invalid', { role: 'tool', runId: 'review-run' }),
      row('newer', undefined, { role: 'user', runId: 'new-run' })])).toEqual(['review', 'tool', qid, 'newer']);
  });
  it('leaves unknown-time supporting context in place before the first known later row', () => {
    expect(ids([row('review'), row('later', String(at + 1))])).toEqual(['review', qid, 'later']);
    expect(ids([row('review'), row('tool', 'invalid')])).toEqual(['review', 'tool', qid]);
    expect(ids([])).toEqual([qid]);
  });
  it('handles loaded windows before, around and after question creation', () => {
    for (const runId of [undefined, 'review-run']) {
      expect(ids([row('earlier', String(at - 1), runId ? { runId } : {})])).toEqual(['earlier', qid]);
      expect(ids([row('later', String(at + 1), runId ? { runId } : {})])).toEqual([qid, 'later']);
      expect(ids([row('equal', String(at), runId ? { runId } : {}), row('later', String(at + 1), runId ? { runId } : {})])).toEqual(['equal', qid, 'later']);
    }
  });
  it('never uses a foreign session run or clock as question placement authority', () => {
    const foreign = row('foreign', String(at + 1), { sessionKey: 'foreign', runId: 'review-run' });
    expect(ids([row('review', String(at - 1)), foreign, row('later', String(at + 2))])).toEqual(['review', 'foreign', qid, 'later']);
    expect(ids([row('review', String(at - 1), { runId: 'review-run' }), foreign])).toEqual(['review', qid, 'foreign']);
  });
  it('orders multiple questions independently of input order and keeps repeated equal-text identities', () => {
    const first = question({ id: 'first', createdAtMs: at - 1 }); const second = question({ id: 'second', createdAtMs: at + 1 });
    const base = [row('review', String(at - 2), { runId: 'review-run' }), row('between', String(at), { runId: 'review-run' }), row('later', String(at + 2), { runId: 'review-run' })];
    const expected = ['review', 'question:synthetic-review:first', 'between', 'question:synthetic-review:second', 'later'];
    expect(ids(base, [second, first])).toEqual(expected);
    expect(ids(questionMessages(base, [first, second]), [second, first])).toEqual(expected);
    const sameTime = question({ id: 'another' });
    expect(ids([row('review', String(at - 2))], [question(), sameTime])).toEqual(['review', 'question:synthetic-review:another', qid]);
  });
  it('orders questions sharing one slot by creation time, not identity', () => {
    // Identity order is the reverse of creation order, and both share the tail slot.
    const older = question({ id: 'zeta', createdAtMs: at - 1 }); const newer = question({ id: 'alpha', createdAtMs: at + 1 });
    expect(ids([row('review', String(at - 2), { runId: 'review-run' })], [newer, older]))
      .toEqual(['review', 'question:synthetic-review:zeta', 'question:synthetic-review:alpha']);
  });
  it('does not treat a later return to the same run as authority to cross a newer run', () => {
    expect(ids([row('review', String(at - 1), { runId: 'review-run' }), row('newer', undefined, { runId: 'new-run' }),
      row('replay', String(at + 1), { runId: 'review-run' })])).toEqual(['review', qid, 'newer', 'replay']);
  });
  it.each(['answered', 'cancelled', 'expired'] as const)('does not resurrect %s on stale reconnect snapshots or duplicate requests', status => {
    const owner = new GatewayQuestionOwner();
    const pending = question({ status: 'pending', answers: undefined });
    owner.event({ event: 'question.requested', payload: pending });
    owner.event({ event: 'question.resolved', payload: { id: pending.id, status, ...(status === 'answered' ? { answers: question().answers } : {}) } });
    owner.hydrate({ questions: [pending, pending] }, owner.revision);
    owner.event({ event: 'question.requested', payload: pending });
    const records = owner.forSession(pending.sessionKey);
    expect(records).toHaveLength(1); expect(records[0]?.status).toBe(status);
    const base = [row('review', String(at - 1)), row('later', String(at + 1))];
    const displayed = questionMessages(base, records);
    expect(displayed.map(m => m.id)).toEqual(['review', qid, 'later']);
    expect(questionMessages(displayed, records)).toEqual(displayed);
    expect(owner.pendingSessions().size).toBe(0);
  });
});


it('keeps unresolved supporting tool context after the last explicitly run-owned row', () => {
  expect(ids([row('review', String(at - 1), { runId: 'review-run' }), row('tool', undefined, { role: 'tool' }),
    row('newer', String(at + 1), { role: 'user', runId: 'new-run' })])).toEqual(['review', 'tool', qid, 'newer']);
});
it('does not cross a generation boundary to follow a replayed run', () => {
  expect(ids([row('review', undefined, { runId: 'review-run' }), row('reset', undefined, { role: 'boundary' }),
    row('replay', undefined, { runId: 'review-run' })])).toEqual(['review', qid, 'reset', 'replay']);
});
it('keeps the owning prompt before its question despite a skewed prompt clock', () => {
  expect(ids([row('prompt', String(at + 10), { role: 'user', runId: 'review-run' }),
    row('review', String(at - 1), { runId: 'review-run' }), row('later', String(at + 100), { runId: 'review-run' })]))
    .toEqual(['prompt', 'review', qid, 'later']);
});
