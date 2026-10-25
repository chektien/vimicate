import { describe, expect, it } from 'vitest';
import type { WorkspaceMessage } from '../workspace/workspaceTypes';
import { projectGatewayEvent, upsertLiveMessage } from './gatewayEventProjection';
import { mergeLatestHistory, mergeOlderHistory } from './historyPagination';
import { parsedTranscriptCache, serializedTranscriptCache } from './persistentTranscriptCache';
import { sameTranscriptPublication } from './transcriptPublicationEquality';

const sessionKey = 'one';
const text = '[Review the latest paper PDF](/tmp/review.pdf)\n\nBuilt from the reviewed commit.';
const prompt: WorkspaceMessage = {
  id: 'canonical-prompt', role: 'user', text: 'show the latest review file',
  sessionKey, source: 'history', timestamp: '1700000001000', idempotencyKey: 'request:user',
};
const final: WorkspaceMessage = {
  id: 'canonical-final', role: 'assistant', text, sessionKey,
  source: 'history', timestamp: '1700000004000', idempotencyKey: 'mirror:assistant',
};
const live = projectGatewayEvent({ event: 'chat', payload: {
  sessionKey, runId: 'run-one', state: 'final',
  message: { content: text, timestamp: 1700000003500 },
} }, sessionKey)!.message;
const canonicalized = () => mergeLatestHistory([prompt, final], [prompt, live], sessionKey);
const assistants = (rows: WorkspaceMessage[]) => rows.filter((row) => row.role === 'assistant');

describe('late live replay after canonical identity migration', () => {
  it('does not require a project round trip to remove a replayed final', () => {
    const canonical = canonicalized();
    expect(assistants(canonical)).toHaveLength(1);
    expect(canonical.at(-1)).toMatchObject({ id: final.id, source: 'history', runId: live.runId });
    const replayed = upsertLiveMessage(canonical, live);
    expect(assistants(mergeLatestHistory([prompt, final], replayed, sessionKey))).toHaveLength(1);
    expect(assistants(replayed)).toHaveLength(1);
    expect(replayed.at(-1)).toMatchObject({ id: final.id, timestamp: final.timestamp, state: 'complete' });
  });

  it.each(['latest refresh', 'older overlap', 'persistent cache'] as const)(
    'retains the migration through %s before the late final', (path) => {
      const canonical = canonicalized();
      const restored = path === 'latest refresh' ? mergeLatestHistory([prompt, final], canonical, sessionKey)
        : path === 'older overlap' ? mergeOlderHistory([prompt, final], canonical, sessionKey)
          : parsedTranscriptCache(serializedTranscriptCache(canonical));
      expect(assistants(upsertLiveMessage(restored, live))).toHaveLength(1);
    },
  );

  it('does not regress changed canonical text or media when an older frame returns', () => {
    const updated: WorkspaceMessage = {
      ...final, text: 'Corrected review file.', timestamp: '1700000005000',
      attachments: [{ id: 'new-image', filename: 'new.png', mimeType: 'image/png', uri: 'https://example.test/new.png' }],
    };
    const refreshed = mergeLatestHistory([prompt, updated], canonicalized(), sessionKey);
    const replayed = upsertLiveMessage(refreshed, { ...live, attachments: [] });
    expect(assistants(replayed)).toHaveLength(1);
    expect(replayed.at(-1)).toMatchObject({ id: updated.id, text: updated.text, timestamp: updated.timestamp, attachments: updated.attachments });
  });

  it('does not let a delayed cumulative prefix reopen the canonical final', () => {
    const replayed = upsertLiveMessage(canonicalized(), { ...live, state: 'streaming', text: text.slice(0, 12) });
    expect(assistants(replayed)).toHaveLength(1);
    expect(replayed.at(-1)).toMatchObject({ id: final.id, text, source: 'history', state: 'complete' });
  });

  it.each([
    { id: 'live-chat-run-two', runId: 'run-two' },
    { sessionKey: 'another-session' },
    { id: 'a-separate-message-in-the-same-run' },
  ])('does not deduplicate an unproven identity with equal text: %j', (change) => {
    expect(assistants(upsertLiveMessage(canonicalized(), { ...live, ...change }))).toHaveLength(2);
  });

  it('keeps two explicit canonical replies in one turn distinct', () => {
    const second = { ...final, id: 'another-canonical-final', idempotencyKey: 'another-mirror:assistant' };
    const canonical = mergeLatestHistory([prompt, final, second], [prompt, live], sessionKey);
    expect(assistants(upsertLiveMessage(canonical, live)).map((row) => row.id)).toEqual([final.id, second.id]);
  });

  it('does not treat an in-progress history overlap as a terminal replay', () => {
    const delta = { ...live, text: 'Draft', state: 'streaming' as const };
    const partial = { ...final, text: delta.text };
    const merged = mergeLatestHistory([prompt, partial], [prompt, delta], sessionKey);
    expect(merged.at(-1)?.absorbedLiveIdentity).toBeUndefined();
    const continued = upsertLiveMessage(merged, { ...delta, text: 'Draft continues' });
    expect(continued.find((message) => message.id === delta.id))
      .toMatchObject({ text: 'Draft continues', state: 'streaming' });
    expect(continued.every((message) => message.absorbedLiveIdentity === undefined)).toBe(true);
  });

  it('does not resurrect media that a newer canonical final explicitly cleared', () => {
    const image = { id: 'old-image', filename: 'old.png', mimeType: 'image/png', uri: 'https://example.test/old.png' };
    const withMedia = mergeLatestHistory([prompt, { ...final, attachments: [image] }], [prompt, { ...live, attachments: [image] }], sessionKey);
    const cleared = mergeLatestHistory([prompt, final], withMedia, sessionKey);
    const replayed = upsertLiveMessage(cleared, { ...live, attachments: [image] });
    expect(assistants(replayed)).toHaveLength(1);
    expect(replayed.at(-1)?.attachments).toBeUndefined();
  });

  it('publishes migrated identity changes but keeps repeated final replays visually stable', () => {
    const canonical = canonicalized();
    const withoutIdentity = canonical.map(({ absorbedLiveIdentity: _identity, ...message }) => message);
    expect(sameTranscriptPublication(canonical, withoutIdentity)).toBe(false);
    for (let index = 0; index < 20; index += 1) {
      expect(sameTranscriptPublication(canonical, upsertLiveMessage(canonical, { ...live }))).toBe(true);
    }
  });

  it('removes an already queued exact live copy beside its proven canonical replacement', () => {
    const canonical = canonicalized();
    expect(assistants(upsertLiveMessage([...canonical, live], live)).map((message) => message.id)).toEqual([final.id]);
  });

  it.each([
    { role: 'tool' }, { source: 'local' }, { source: null }, { state: 'streaming' },
    { sessionKey: null }, { runId: 'different-run' },
    { absorbedLiveIdentity: null },
    { absorbedLiveIdentity: { messageId: '', runId: live.runId } },
    { absorbedLiveIdentity: { messageId: live.id, runId: '' } },
    { absorbedLiveIdentity: { messageId: 17, runId: live.runId } },
    { absorbedLiveIdentity: { messageId: 'x'.repeat(513), runId: live.runId } },
  ])('rejects malformed or ineligible cached migration %j', (change) => {
    const cached = parsedTranscriptCache(JSON.stringify([{ ...canonicalized().at(-1)!, ...change }]));
    expect(cached.every((message) => message.absorbedLiveIdentity === undefined)).toBe(true);
  });

  it('does not carry a migration into a newly scoped canonical row', () => {
    const newRun = { ...final, runId: 'different-run' };
    const refreshed = mergeLatestHistory([prompt, newRun], canonicalized(), sessionKey);
    expect(refreshed.at(-1)?.absorbedLiveIdentity).toBeUndefined();
    expect(assistants(upsertLiveMessage(refreshed, live))).toHaveLength(2);
    const otherSession = mergeLatestHistory([{ ...prompt, sessionKey: 'two' }, { ...final, sessionKey: 'two' }], canonicalized(), 'two');
    expect(otherSession.at(-1)?.absorbedLiveIdentity).toBeUndefined();
  });
});
