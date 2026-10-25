import type { WorkspaceMessage } from '../workspace/workspaceTypes';
import { projectGatewayEvent, upsertLiveMessage } from '../gateway/gatewayEventProjection';
import { mergeLatestHistory, mergeOlderHistory } from '../gateway/historyPagination';
import { parsedTranscriptCache, serializedTranscriptCache } from '../gateway/persistentTranscriptCache';

/** Explicit simulator fixture; exercises real publication owners in Hermes. */
export function lateFinalReplayFixture(order: 'live-first' | 'canonical-first' = 'live-first'): WorkspaceMessage[] {
  const sessionKey = 'fixture-final-replay';
  const prompt: WorkspaceMessage = {
    id: 'replay-prompt', role: 'user', text: order === 'canonical-first'
      ? 'History arrived first. Show its delayed live reply once.'
      : 'Show the latest review PDF once.',
    sessionKey, source: 'history', timestamp: '2026-08-30T19:31:00+08:00',
    idempotencyKey: 'fixture-replay-run:user',
  };
  const final: WorkspaceMessage = {
    id: 'replay-canonical-final', role: 'assistant',
    text: '[Review the latest paper PDF](https://example.test/review.pdf)\n\nBuilt from the reviewed commit.',
    sessionKey, source: 'history', timestamp: '2026-08-30T19:31:04+08:00',
    idempotencyKey: 'replay-mirror:assistant',
  };
  const live = projectGatewayEvent({ event: 'chat', payload: {
    sessionKey, runId: 'fixture-replay-run', state: 'final',
    message: { content: final.text, timestamp: Date.parse('2026-08-30T19:31:03+08:00') },
  } }, sessionKey)!.message;
  if (order === 'canonical-first') {
    const canonical = mergeLatestHistory([prompt, final], [], sessionKey);
    const delivered = upsertLiveMessage(canonical, live);
    const restored = parsedTranscriptCache(serializedTranscriptCache(delivered));
    // No later canonical refresh may hide a doubled first publication here.
    return upsertLiveMessage(restored, live);
  }
  const canonical = mergeLatestHistory([prompt, final], [prompt, live], sessionKey);
  const replayed = upsertLiveMessage(canonical, live);
  const refreshed = mergeLatestHistory([prompt, final], replayed, sessionKey);
  const restored = parsedTranscriptCache(serializedTranscriptCache(refreshed));
  const paged = mergeOlderHistory([prompt, final], restored, sessionKey);
  return upsertLiveMessage(upsertLiveMessage(paged, { ...live, state: 'streaming', text: final.text.slice(0, 12) }), live);
}
