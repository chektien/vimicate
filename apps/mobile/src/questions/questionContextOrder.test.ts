import { expect, it } from 'vitest';
import { messagesFromPayload, authoritativeHistoryChronology } from '../workspace/historyMessageProjection';
import { projectGatewayEvent } from '../gateway/gatewayEventProjection';
import { flushBufferedLiveMessages, LiveMessagePublicationBuffer } from '../gateway/liveMessagePublication';
import type { WorkspaceMessage } from '../workspace/workspaceTypes';

const sessionKey = 'synthetic-review';
const epoch = 1_760_000_000_000;
const wire = (id: string, timestamp: number, rawSeq?: number, question = false) => ({
  role: 'assistant', timestamp: epoch + timestamp, content: question ? 'Decision?' : 'Synthetic review basis',
  ...(question ? { openclawAsyncDelivery: { itemId: id, questions: [{ title: 'Decision?', options: ['Accept', 'Revise'] }] } } : {}),
  __openclaw: { id, runId: 'review-run', ...(rawSeq === undefined ? {} : { transcriptPosition: { source: 'native', rawSeq } }) },
});
const history = (messages: unknown[]) => messagesFromPayload({ sessionKey, messages });

it('keeps published review before its decision across live buffering and canonical refresh', () => {
  const content = wire('review', 100); const question = wire('question', 101, undefined, true);
  const review = projectGatewayEvent({ event: 'chat', payload: { sessionKey, runId: 'review-run', state: 'final', message: content, timestamp: epoch + 100 } }, sessionKey)!.message;
  const decision = projectGatewayEvent({ event: 'session.message', payload: { sessionKey, message: question } }, sessionKey)!.message;
  const buffer = new LiveMessagePublicationBuffer(); buffer.enqueue(review); buffer.enqueue(decision);
  let displayed: WorkspaceMessage[] = [];
  flushBufferedLiveMessages(buffer, (_key, update) => { displayed = update(displayed); });
  expect(displayed.map(row => Boolean(row.asyncQuestion))).toEqual([false, true]);
  const canonical = history([content, question]);
  expect(canonical.map(row => row.id)).toEqual(['review', 'question']);
  expect(authoritativeHistoryChronology(canonical).map(row => row.id)).toEqual(['review', 'question']);
});

it('native causal order beats reversed timestamps, including a later tool activity group', () => {
  const rows = history([wire('review', 500, 1), wire('question', 100, 2, true), {
    role: 'toolResult', timestamp: epoch + 90, content: [{ type: 'toolResult', toolCallId: 'call', name: 'synthetic', content: 'tool completed' }],
    __openclaw: { id: 'tool', runId: 'review-run', transcriptPosition: { source: 'native', rawSeq: 3, activity: { afterRawSeq: 1, scopeId: 'review-run', startOrder: 0 } } },
  }]);
  expect(rows.some(row => row.id === 'tool' && row.role === 'tool')).toBe(true);
  expect(rows.findIndex(row => row.id === 'review')).toBeLessThan(rows.findIndex(row => row.asyncQuestion));
  expect(authoritativeHistoryChronology(rows)).toEqual(rows);
});

it('does not invent a context association to move a source-first question after later content or another run', () => {
  const question = wire('question', 100, 1, true);
  const review = wire('review', 90, 2);
  const later = { ...wire('later', 200, 3), __openclaw: { id: 'later', runId: 'different-run', transcriptPosition: { source: 'native', rawSeq: 3 } } };
  const rows = history([question, review, later]);
  expect(rows.map(row => row.id)).toEqual(['question', 'review', 'later']);
  expect(authoritativeHistoryChronology(rows).map(row => row.id)).toEqual(['question', 'review', 'later']);
});
