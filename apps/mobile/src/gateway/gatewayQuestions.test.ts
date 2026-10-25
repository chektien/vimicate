import { describe, expect, it } from 'vitest';
import { GatewayQuestionOwner, questionRecordFromPayload, questionMessages } from './gatewayQuestions';
export const record = { id: 'qa-question', sessionKey: 'qa-one', runId: 'qa-run', createdAtMs: 1, expiresAtMs: 1000, status: 'pending', questions: [{ questionId: 'choice', header: 'Choose', question: 'Which path?', options: [{ label: 'One', description: 'First path' }, { label: 'Two' }], isOther: true }] };
describe('Gateway question authority', () => {
  it('rejects absent session authority and malformed records', () => {
    expect(questionRecordFromPayload({ ...record, sessionKey: undefined })).toBeNull();
    expect(questionRecordFromPayload({ ...record, questions: [{ ...record.questions[0], questionId: 'bad-id' }] })).toBeNull();
    expect(questionRecordFromPayload({ ...record, expiresAtMs: NaN })).toBeNull();
  });
  it('binds scope-less resolved events only to a previously registered question', () => {
    const owner = new GatewayQuestionOwner();
    expect(owner.event({ event: 'question.resolved', payload: { id: record.id, status: 'cancelled' } })).toBe(false);
    owner.event({ event: 'question.requested', payload: record });
    owner.event({ event: 'question.resolved', payload: { id: record.id, status: 'answered', answers: { answers: { choice: ['Two'] } } } });
    expect(owner.forSession('qa-two')).toEqual([]);
    expect(owner.forSession('qa-one')[0]).toMatchObject({ status: 'answered', answers: { answers: { choice: ['Two'] } } });
  });
  it('does not resurrect a question settled while reconnect hydration was in flight', () => {
    const owner = new GatewayQuestionOwner(); owner.event({ event: 'question.requested', payload: record });
    const revision = owner.revision;
    owner.event({ event: 'question.resolved', payload: { id: record.id, status: 'cancelled' } });
    owner.hydrate({ questions: [record] }, revision);
    expect(owner.forSession('qa-one')[0]?.status).toBe('cancelled');
  });
  it('never retains or displays secret answers returned by another surface', () => {
    const owner = new GatewayQuestionOwner(); const secret = { ...record, questions: [{ ...record.questions[0], isSecret: true }] };
    owner.event({ event: 'question.requested', payload: secret });
    owner.event({ event: 'question.resolved', payload: { id: record.id, status: 'answered', answers: { answers: { choice: ['must-never-display'] } } } });
    expect(JSON.stringify(owner.forSession(record.sessionKey))).not.toContain('must-never-display');
    expect(questionRecordFromPayload({ ...secret, status: 'answered', answers: { answers: { choice: ['must-never-display'] } } })?.answers).toEqual({ answers: {} });
    expect(questionMessages([], owner.forSession(record.sessionKey))[0]?.text).toBe('Question answered');
  });
  it('expires locally and preserves run placement', () => {
    const owner = new GatewayQuestionOwner(); owner.hydrate({ questions: [record] }, owner.revision);
    const messages = questionMessages([{ id: 'tool', sessionKey: 'qa-one', role: 'tool', text: 'call', runId: 'qa-run' }, { id: 'newer', role: 'user', text: 'next', runId: 'next-run' }], owner.forSession('qa-one'));
    expect(messages.map(m => m.id)).toEqual(['tool', 'question:qa-one:qa-question', 'newer']);
    expect(owner.expire(1001)).toBe(true);
    expect(owner.forSession('qa-one')[0]?.status).toBe('expired');
  });
});
