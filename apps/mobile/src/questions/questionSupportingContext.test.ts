import { describe, expect, it } from 'vitest';
import fixture from '../../../../fixtures/openclaw/question-support-context.json';
import { messagesFromPayload } from '../workspace/historyMessageProjection';
import { mergeLatestHistory } from '../gateway/historyPagination';
import { GatewayQuestionOwner, questionMessages, questionRecordFromPayload } from '../gateway/gatewayQuestions';
import { projectGatewayEvent } from '../gateway/gatewayEventProjection';
import { flushBufferedLiveMessages, liveMessagePublicationMode, LiveMessagePublicationBuffer } from '../gateway/liveMessagePublication';
import { parsedTranscriptCache, serializedTranscriptCache } from '../gateway/persistentTranscriptCache';
import { AsyncQuestionOwner } from './asyncQuestionOwner';
import { formatAsyncAnswer, parseAsyncQuestion } from './asyncQuestionContract';
import { asyncQuestionHistory } from './asyncQuestionHistory';
import type { WorkspaceMessage } from '../workspace/workspaceTypes';

const { sessionKey, sessionId, runId, epoch } = fixture;
const wire = (id: string, seq: number, time = seq, question = false) => ({
  role: 'assistant', timestamp: epoch + time, content: question ? 'Use the synthetic review?' : 'Synthetic review material',
  ...(question ? { openclawAsyncDelivery: fixture.async } : {}),
  __openclaw: { id, runId, transcriptPosition: { source: 'native', rawSeq: seq } },
});
const history = (rows: unknown[]) => messagesFromPayload({ sessionKey, sessionId, messages: rows });
const ids = (rows: WorkspaceMessage[]) => rows.map(row => row.id);
const restored = (rows: WorkspaceMessage[]) => parsedTranscriptCache(serializedTranscriptCache(rows));
const registry = () => questionRecordFromPayload(fixture.registry)!;
const qid = `question:${sessionKey}:decision`;

// Characterization of actual owners, not an oracle that infers supporting prose.
describe('supporting context causality boundary', () => {
  it('recovers an earlier native review delivered only after the question, through refresh and cache reopen', () => {
    const review = wire('review', 1); const question = wire('question', 2, 2, true);
    const live = projectGatewayEvent({ event: 'session.message', payload: { sessionKey, sessionId, message: question } }, sessionKey)!.message;
    const buffer = new LiveMessagePublicationBuffer(); buffer.enqueue(live);
    let displayed: WorkspaceMessage[] = [];
    flushBufferedLiveMessages(buffer, (_key, update) => { displayed = update(displayed); });
    expect(ids(displayed)).toEqual(['question']); // Missing content cannot be conjured at first publication.
    const latest = history([review, question, wire('unrelated', 3)]);
    const merged = mergeLatestHistory(latest, displayed, sessionKey);
    expect(ids(merged)).toEqual(['review', 'question', 'unrelated']);
    expect(ids(restored(merged))).toEqual(ids(merged));
    expect(merged.filter(row => row.asyncQuestion)).toHaveLength(1);
  });

  it('does not move a genuinely source-first native question behind later same-run material', () => {
    // Equal prose and reversed clocks cannot supply the missing semantic edge.
    const rows = history([wire('question', 1, 20, true), wire('review', 2, 10), wire('unrelated', 3, 5)]);
    expect(ids(rows)).toEqual(['question', 'review', 'unrelated']);
    expect(ids(mergeLatestHistory(rows, [], sessionKey))).toEqual(ids(rows));
    expect(ids(restored(rows))).toEqual(ids(rows));
  });

  it.each([true, false])('keeps source chronology when review-first is %s and a later answer decorates the question', reviewFirst => {
    // A producer may emit a decision before its final review summary. Answer
    // confirmation links to that decision, not to the later summary as context.
    const basis = wire('review', reviewFirst ? 1 : 2);
    const decision = wire('question', reviewFirst ? 2 : 1, reviewFirst ? 2 : 1, true);
    const expected = reviewFirst ? ['review', 'question', 'final', 'answer'] : ['question', 'review', 'final', 'answer'];
    const final = { ...wire('final', 3), stopReason: 'stop', __openclaw: { ...wire('final', 3).__openclaw, runTerminal: true } };
    const answerText = formatAsyncAnswer(fixture.async, { answers: { '0': ['Accept'] } });
    const answer = { role: 'user', content: answerText, timestamp: epoch + 4,
      __openclaw: { id: 'answer', runId: 'answer-run', replyToId: 'question', transcriptPosition: { source: 'native', rawSeq: 4 } } };
    const rows = history([...(reviewFirst ? [basis, decision] : [decision, basis]), final, answer]);
    for (const displayed of [rows, mergeLatestHistory(rows, [rows[reviewFirst ? 1 : 0]!], sessionKey), restored(rows)]) {
      expect(ids(displayed)).toEqual(expected);
      const entries = asyncQuestionHistory(displayed);
      expect(entries).toHaveLength(1);
      expect(entries[0]?.message.id).toBe('question');
      expect(entries[0]?.confirmedText).toBe(answerText);
      expect(ids(displayed)).toEqual(expected);
    }
  });

  it('distinguishes authoritative native order from legacy timestamp placement under clock skew', () => {
    const native = [wire('review', 1, 200), wire('question', 2, 100, true)];
    expect(ids(history(native))).toEqual(['review', 'question']);
    const legacy = native.map(({ __openclaw, ...row }) => ({ ...row, __openclaw: { id: __openclaw.id, runId } }));
    expect(ids(history(legacy))).toEqual(['question', 'review']);
    // This is the existing legacy clock policy, not proof of the reported incident.
  });

  it('flushes already-buffered supporting prose with an urgent inline question', () => {
    const review = projectGatewayEvent({ event: 'chat', payload: { sessionKey, runId, state: 'delta', timestamp: epoch + 1, message: { content: 'Synthetic review material' } } }, sessionKey)!.message;
    const decision = projectGatewayEvent({ event: 'session.message', payload: { sessionKey, sessionId, message: wire('question', 2, 2, true) } }, sessionKey)!.message;
    expect(liveMessagePublicationMode(review, false)).toBe('schedule');
    expect(liveMessagePublicationMode(decision, false)).toBe('flush');
    const buffer = new LiveMessagePublicationBuffer(); buffer.enqueue(review); buffer.enqueue(decision);
    let displayed: WorkspaceMessage[] = [];
    flushBufferedLiveMessages(buffer, (_key, update) => { displayed = update(displayed); });
    expect(ids(displayed)).toEqual([`live-chat-${runId}`, 'question']);
  });

  it('cannot distinguish delayed support from unrelated later output using the registry record', () => {
    const prompt: WorkspaceMessage = { id: 'prompt', role: 'user', text: 'Synthetic task', source: 'history', sessionKey, runId, timestamp: String(epoch) };
    const tail = history([wire('review-or-unrelated', 1, 200)]);
    // Two possible meanings have identical public inputs. No field says which world applies.
    const observed = questionMessages([prompt, ...tail], [registry()]);
    expect(ids(observed)).toEqual(['prompt', qid, 'review-or-unrelated']);
    expect(observed.filter(row => !row.question)).toEqual([prompt, ...tail]);
    const unknown = tail.map(({ timestamp: _time, ...row }) => row);
    expect(ids(questionMessages([prompt, ...unknown], [registry()]))).toEqual(['prompt', 'review-or-unrelated', qid]);
  });

  it('keeps a delayed tool cohort in its native gap without moving unrelated same-run output', () => {
    const tool = { role: 'toolResult', timestamp: epoch + 500,
      content: [{ type: 'toolResult', toolCallId: 'review-tool', name: 'synthetic', content: 'Synthetic tool detail' }],
      __openclaw: { id: 'tool', runId, transcriptPosition: { source: 'native', rawSeq: 4,
        activity: { afterRawSeq: 1, scopeId: runId, startOrder: 0 } } } };
    const rows = history([wire('review', 1), wire('question', 2, 2, true), wire('unrelated', 3), tool]);
    expect(ids(rows)).toEqual(['review', 'tool', 'question', 'unrelated']);
    expect(ids(restored(rows))).toEqual(ids(rows));
  });

  it('keeps two equal-text native questions distinct across a newer run and stale-clock content', () => {
    const second = { ...wire('second-question', 4, 0, true), openclawAsyncDelivery: { ...fixture.async, itemId: 'second-item' } };
    const newer = { ...wire('newer-run', 5, -10), __openclaw: { ...wire('newer-run', 5).__openclaw, runId: 'new-run' } };
    const rows = history([wire('review', 1), wire('question', 2, 2, true), wire('unrelated', 3), second, newer]);
    expect(ids(rows)).toEqual(['review', 'question', 'unrelated', 'second-question', 'newer-run']);
    expect(restored(rows).flatMap(row => row.asyncQuestion?.itemId ?? [])).toEqual(['decision-item', 'second-item']);
  });

  it('does not pull a registry question across a generation boundary to chase delayed content', () => {
    const first = history([wire('prompt', 1, 0)])[0]!;
    const boundary: WorkspaceMessage = { id: 'reset', role: 'boundary', text: 'New generation', source: 'history', sessionKey };
    const delayed = { ...history([wire('delayed', 1, -10)])[0]!, transcriptSessionId: '22222222-2222-4222-8222-222222222222' };
    const base = [first, boundary, delayed];
    const rows = questionMessages(base, [registry()]);
    expect(ids(rows)).toEqual(['prompt', qid, 'reset', 'delayed']);
    expect(rows.filter(row => !row.question)).toEqual(base);
  });

  it('does not promote unknown content-reference fields into causal authority', () => {
    const reference = fixture.hypotheticalContentReference;
    expect(questionRecordFromPayload({ ...fixture.registry, supportingContent: reference })).toEqual(registry());
    expect(parseAsyncQuestion({ ...fixture.async, supportingContent: reference })).toEqual(fixture.async);
    expect(parseAsyncQuestion({ ...fixture.async, questions: fixture.async.questions.map(q => ({ ...q, supportingContent: reference })) })).toEqual(fixture.async);
  });

  it('does not attribute an unscoped or foreign inline question to the selected session', () => {
    const message = wire('question', 2, 2, true);
    for (const payload of [{ message }, { sessionKey: 'foreign', sessionId, message }]) {
      expect(projectGatewayEvent({ event: 'session.message', payload }, sessionKey)).toBeNull();
    }
  });

  it.each(['answered', 'cancelled', 'expired'] as const)('keeps a %s registry decision settled when delayed context and stale pending hydration arrive', status => {
    const owner = new GatewayQuestionOwner(); const pending = registry();
    owner.event({ event: 'question.requested', payload: pending });
    owner.event({ event: 'question.resolved', payload: { id: pending.id, status, ...(status === 'answered' ? { answers: { answers: { choice: ['Accept'] } } } : {}) } });
    owner.hydrate({ questions: [pending] }, owner.revision);
    owner.event({ event: 'question.requested', payload: pending });
    const base = history([wire('review', 1, 50), wire('unrelated', 2, 200)]);
    const displayed = questionMessages(base, owner.forSession(sessionKey));
    expect(ids(displayed)).toEqual(['review', qid, 'unrelated']);
    expect(displayed.find(row => row.question)?.question?.status).toBe(status);
    expect(displayed.filter(row => !row.question)).toEqual(base);
  });

  it.each(['skip', 'answer'] as const)('retains %s state across delayed review insertion and persisted restoration', action => {
    const question = history([wire('question', 2, 2, true)])[0]!;
    const owner = new AsyncQuestionOwner(); owner.observe([question]);
    const id = owner.view(question)!.record.id;
    if (action === 'skip') owner.skip(id);
    else expect(owner.admit(question, 'synthetic-answer-id')).not.toBeNull();
    const reopened = new AsyncQuestionOwner(); reopened.restore(owner.serialize());
    const rows = history([wire('review', 1), wire('question', 2, 2, true), wire('unrelated', 3)]);
    reopened.observe(restored(rows));
    expect(reopened.view(rows[1]!)?.state).toBe(action === 'skip' ? 'skipped' : 'queued');
    expect(ids(rows)).toEqual(['review', 'question', 'unrelated']);
    expect(reopened.view({ ...question, sessionKey: 'foreign' })).toBeUndefined();
  });
});
