import { describe, expect, it } from 'vitest';
import type { WorkspaceMessage } from '../workspace/workspaceTypes';
import { projectGatewayEvent, upsertLiveMessage } from './gatewayEventProjection';
import { mergeLatestHistory } from './historyPagination';
import { parsedTranscriptCache, serializedTranscriptCache } from './persistentTranscriptCache';
import { latestPresentationWindow } from './historyWindow';
import { LiveMessagePublicationBuffer, flushBufferedLiveMessages } from './liveMessagePublication';

const sessionKey = 'owned-session';
const runId = 'owned-run';
const text = 'One completed answer.\n\nThe retained reply is singular.';
const prompt: WorkspaceMessage = {
  id: 'history-prompt', role: 'user', text: 'Request the answer', source: 'history',
  sessionKey, timestamp: '1700000001000', idempotencyKey: `${runId}:user`,
};
const final: WorkspaceMessage = {
  id: 'history-final', role: 'assistant', text, source: 'history', sessionKey,
  timestamp: '1700000004000', idempotencyKey: 'provider:thread:turn:assistant',
};
const live = projectGatewayEvent({ event: 'chat', payload: {
  sessionKey, runId, state: 'final', message: { content: text, timestamp: 1700000004115 },
} }, sessionKey)!.message;
const assistants = (messages: WorkspaceMessage[]) => messages.filter((message) => message.role === 'assistant');

describe('canonical history preceding the first live answer', () => {
  it('publishes one answer without needing another canonical refresh', () => {
    const history = mergeLatestHistory([prompt, final], [], sessionKey);
    expect(assistants(history)).toHaveLength(1);
    expect(history.at(-1)?.absorbedLiveIdentity).toBeUndefined();
    const published = upsertLiveMessage(history, live);
    // A later refresh already repairs this duplicate: the first publication must too.
    expect(assistants(mergeLatestHistory([prompt, final], published, sessionKey))).toHaveLength(1);
    expect(assistants(published)).toHaveLength(1);
    expect(published.at(-1)).toMatchObject({
      id: final.id, source: 'history', timestamp: final.timestamp, runId, state: 'complete',
      absorbedLiveIdentity: { messageId: live.id, runId },
    });
  });

  it('converges the real buffered publication path before persistence', () => {
    let published = [prompt, final];
    const buffer = new LiveMessagePublicationBuffer();
    buffer.enqueue(live);
    flushBufferedLiveMessages(buffer, (session, action) => {
      expect(session).toBe(sessionKey);
      published = action(published);
    });
    expect(assistants(parsedTranscriptCache(serializedTranscriptCache(published)))).toHaveLength(1);
  });

  it('repairs the captured retained pair when the same terminal frame returns', () => {
    const restored = parsedTranscriptCache(serializedTranscriptCache([prompt, final, live]));
    expect(assistants(upsertLiveMessage(restored, live))).toHaveLength(1);
  });

  it('does not regress or duplicate the converged answer on another late prefix/final', () => {
    let rows = latestPresentationWindow(upsertLiveMessage([prompt, final], live));
    for (const message of [
      { ...live, state: 'streaming' as const, text: 'One completed' }, live, live,
    ]) rows = upsertLiveMessage(rows, message);
    expect(assistants(rows)).toHaveLength(1);
    expect(rows.at(-1)).toMatchObject({ id: final.id, text, state: 'complete' });
  });

  it.each([
    { runId: 'other-run', id: 'live-chat-other-run' },
    { sessionKey: 'another-session' },
    { id: 'different-message-in-same-run' },
    { role: 'narration' as const },
  ])('does not conflate equal content with an unproven incoming identity: %j', (change) => {
    expect(upsertLiveMessage([prompt, final], { ...live, ...change })).toHaveLength(3);
  });

  it.each([
    { idempotencyKey: 'unrelated:user' },
    { sessionKey: 'another-session' },
    { role: 'boundary' as const },
  ])('requires the preceding prompt to prove the run and session: %j', (change) => {
    expect(assistants(upsertLiveMessage([{ ...prompt, ...change }, final], live))).toHaveLength(2);
  });

  it('does not infer a run for a prompt with no binding metadata', () => {
    const { idempotencyKey: _key, ...unbound } = prompt;
    expect(assistants(upsertLiveMessage([unbound, final], live))).toHaveLength(2);
  });

  it('does not absorb a second distinct canonical answer even with equal text', () => {
    const second = { ...final, id: 'another-final', idempotencyKey: 'another:assistant' };
    expect(assistants(upsertLiveMessage([prompt, final, second], live))).toHaveLength(3);
  });

  it('does not bind a live answer to canonical content from another run', () => {
    expect(assistants(upsertLiveMessage([prompt, { ...final, runId: 'other-run' }], live))).toHaveLength(2);
  });

  it('does not cross a later user turn or generation boundary', () => {
    for (const boundary of [
      { ...prompt, id: 'next-prompt', idempotencyKey: 'next-run:user' },
      { ...prompt, id: 'generation', role: 'boundary' as const },
    ]) expect(assistants(upsertLiveMessage([prompt, boundary, final], live))).toHaveLength(2);
  });

  it('retains the old answer slot when its late final arrives after a newer turn', () => {
    const nextPrompt = { ...prompt, id: 'next-prompt', idempotencyKey: 'next-run:user' };
    const nextAnswer = { ...final, id: 'next-answer', idempotencyKey: 'next:assistant' };
    const rows = upsertLiveMessage([prompt, final, nextPrompt, nextAnswer], live);
    expect(rows.map((row) => row.id)).toEqual([prompt.id, final.id, nextPrompt.id, nextAnswer.id]);
    expect(rows[1]?.absorbedLiveIdentity?.runId).toBe(runId);
    expect(rows[3]?.absorbedLiveIdentity).toBeUndefined();
  });

  it('accepts an explicit prompt run binding without inferring it from answer text', () => {
    const ownedPrompt = { ...prompt, runId, idempotencyKey: 'different-submission:user' };
    expect(assistants(upsertLiveMessage([ownedPrompt, final], live))).toHaveLength(1);
    expect(assistants(upsertLiveMessage([{ ...ownedPrompt, runId: 'conflicting-run' }, final], live))).toHaveLength(2);
  });

  it('does not take terminal authority from incomplete canonical or live representations', () => {
    expect(assistants(upsertLiveMessage([prompt, { ...final, state: 'streaming' }], live))).toHaveLength(2);
    expect(assistants(upsertLiveMessage([prompt, final], { ...live, state: 'streaming' }))).toHaveLength(2);
    expect(assistants(upsertLiveMessage([prompt, final], { ...live, text: 'A separate reply.' }))).toHaveLength(2);
  });

  it('preserves canonical media authority and the proven alias through cache and refresh', () => {
    const image = { id: 'image', filename: 'answer.png', mimeType: 'image/png', uri: 'https://example.test/answer.png' };
    const canonical = { ...final, attachments: [image] };
    const first = upsertLiveMessage([prompt, canonical], { ...live, attachments: [] });
    const restored = parsedTranscriptCache(serializedTranscriptCache(first));
    const refreshed = mergeLatestHistory([prompt, canonical], restored, sessionKey);
    const replayed = upsertLiveMessage(refreshed, live);
    expect(assistants(replayed)).toHaveLength(1);
    expect(replayed.at(-1)).toMatchObject({ id: final.id, attachments: [image], absorbedLiveIdentity: { messageId: live.id, runId } });
  });
});
