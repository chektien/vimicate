import { expect, it } from 'vitest';
import { type WorkspaceMessage } from '../workspace/workspaceTypes';
import { messagesFromPayload } from '../workspace/historyMessageProjection';
import { mergeLatestHistory } from '../gateway/historyPagination';
import { parsedTranscriptCache, serializedTranscriptCache } from '../gateway/persistentTranscriptCache';
import { hasRenderedAssistantFinalForRun } from '../gateway/runCompletionMessage';
const q: WorkspaceMessage = { id: 'saved-question', role: 'assistant', text: 'Which route?', source: 'history', sessionKey: 'session', runId: 'origin', asyncMessage: true, timestamp: '2000', asyncQuestion: { itemId: 'async-item', questions: [{ title: 'Which route?', options: ['One', 'Two'] }] } };
it('retains two async cards in a run and coalesces only the exact item across live/canonical refreshes', () => {
  const user: WorkspaceMessage = { id: 'prompt', role: 'user', text: 'work', source: 'history', sessionKey: 'session', runId: 'origin', timestamp: '1000' };
  const live: WorkspaceMessage = { ...q, id: 'live-async-origin-async-item', source: 'live', state: 'streaming' };
  const second: WorkspaceMessage = { ...q, id: 'second', timestamp: '3000', asyncQuestion: { ...q.asyncQuestion!, itemId: 'second-item' } };
  const final: WorkspaceMessage = { id: 'final', role: 'assistant', text: 'Which route?', source: 'history', sessionKey: 'session', runId: 'origin', timestamp: '4000', asyncQuestionRunOutcome: 'successful' };
  const merged = mergeLatestHistory([user, q, second, final], [user, live], 'session');
  expect(merged.filter(m => m.asyncQuestion).map(m => m.asyncQuestion?.itemId)).toEqual(['async-item', 'second-item']); expect(merged.some(m => m.id === 'final' && !m.asyncQuestion)).toBe(true);
  expect(hasRenderedAssistantFinalForRun([q], 'origin')).toBe(false); expect(hasRenderedAssistantFinalForRun([q, final], 'origin')).toBe(true);
});
it('restores validated async metadata from the bounded cache, including exact private outbound labels', () => {
  const rows = messagesFromPayload({ sessionKey: 'session', messages: [{ role: 'assistant', id: 'path', content: 'Use /Users/person/private/file?', openclawAsyncDelivery: { itemId: 'file', questions: [{ title: 'Use /Users/person/private/file?', options: ['/Users/person/a', '/Users/person/b'] }] } }] });
  const restored = parsedTranscriptCache(serializedTranscriptCache(rows)); expect(restored[0]?.asyncQuestion).toEqual(rows[0]?.asyncQuestion); expect(restored[0]?.text).not.toContain('/Users/person');
  const terminal = { ...q, asyncQuestionRunOutcome: 'successful' as const }; expect(parsedTranscriptCache(serializedTranscriptCache([terminal]))[0]?.asyncQuestionRunOutcome).toBe('successful');
});
