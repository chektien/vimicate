import { describe, expect, it } from 'vitest';
import { type WorkspaceMessage, type WorkspaceProject } from '../workspace/workspaceTypes';
import { messagesFromPayload } from '../workspace/historyMessageProjection';
import { gatewaySessionGeneration } from './registrySessionIdentity';
import { generationReboundVisiblePublication, messagesOwnedBySessionGeneration, sessionGenerationChanged } from './sessionGenerationPublication';
import { parsedTranscriptCache, serializedTranscriptCache } from './persistentTranscriptCache';
import { sameTranscriptPublication } from './transcriptPublicationEquality';
import { mergeLatestHistory, mergeOlderHistory } from './historyPagination';
import { mergeSharedNarration } from './sharedNarration';

const sessionId = '00000000-0000-4000-a000-000000000127';
const otherSessionId = '00000000-0000-4000-9000-000000000135';
const sessionKey = 'agent:main:direct:vimicate-ios:project:fixture';
const start = Date.parse('2026-08-31T10:00:00Z');
const generation = { sessionId, sessionStartedAtMs: start, historyModel: 'sqlite-display-v1' as const };
const project: WorkspaceProject = { id: sessionKey, sessionKey, name: 'fixture', path: '', branch: '', starred: false, threadCount: 0, state: 'idle', sessionId, sessionStartedAtMs: start };

// Native physical order is prompt, answer, activity. Its display composer
// places buffered activity before the answer, despite the later timestamp.
const rawRows = [
  { id: 'prompt', role: 'user', text: 'request', timestamp: start - 3, __openclaw: { transcriptPosition: { source: sessionId, rawSeq: 1 } } },
  { id: 'activity', role: 'assistant', text: 'checking', timestamp: start - 1, __openclaw: { transcriptPosition: { source: sessionId, rawSeq: 3, activity: { afterRawSeq: 1, scopeId: 'run-1', startOrder: 0 } } } },
  { id: 'answer', role: 'assistant', text: 'done', timestamp: start - 2, __openclaw: { transcriptPosition: { source: sessionId, rawSeq: 2 } } },
];
const page = (messages = rawRows) => messagesFromPayload({ sessionKey, sessionId, messages });
const ids = (messages: WorkspaceMessage[]) => messages.map((message) => message.id);

describe('native SQLite transcript compatibility', () => {
  it('preserves the native base order while inserting owned shared preambles in their recorded gaps', () => {
    const native = page();
    const preamble: WorkspaceMessage = { id: 'legacy-preamble', role: 'narration', text: 'before answer', source: 'history',
      sessionKey, transcriptSessionId: sessionId, timestamp: String(start - 2.5) };
    expect(ids(mergeSharedNarration(native, [preamble]))).toEqual(['prompt', 'legacy-preamble', 'activity', 'answer']);
    expect(ids(mergeSharedNarration(mergeSharedNarration(native, [preamble]), [preamble]))).toEqual(['prompt', 'legacy-preamble', 'activity', 'answer']);
  });
  it('keeps native commentary as separate preambles rather than collapsing it into the answer', () => {
    const metadata = { id: 'answer', idempotencyKey: 'turn:assistant', transcriptPosition: { source: sessionId, rawSeq: 2 } };
    const rows = messagesFromPayload({ sessionKey, sessionId, messages: [
      { role: 'assistant', content: 'checking', openclawStreamFallback: { source: 'segment', itemId: 'item-1', replacementText: 'checking' }, __openclaw: metadata },
      { role: 'assistant', content: 'done', __openclaw: metadata },
    ] });
    expect(rows[0]?.role).toBe('narration');
    expect(rows[0]?.id).not.toBe(rows[1]?.id);
    expect(rows[0]?.idempotencyKey).toBeUndefined();
    const shared: WorkspaceMessage = { id: 'live-item-run-item-1', narrationItemId: 'item-1', role: 'narration', text: 'checking',
      source: 'history', sessionKey, transcriptSessionId: sessionId, runId: 'run', timestamp: String(start - 2) };
    expect(mergeSharedNarration(rows, [shared])).toHaveLength(2);
  });
  it('coalesces one unambiguous native pre-tool message with its durable narration item', () => {
    const text = 'I will use the paper-writing skill, then inspect the repository.';
    const rows = messagesFromPayload({ sessionKey, sessionId, messages: [
      { id: 'prompt', role: 'user', content: 'revise the paper', timestamp: new Date(start).toISOString() },
      { id: 'native-preamble', role: 'assistant', content: text, timestamp: new Date(start + 2_200).toISOString() },
      { id: 'read-call', role: 'assistant', content: [{ type: 'toolCall', id: 'read-1', name: 'read', arguments: { path: '/skills/paper-writing/SKILL.md' } }], timestamp: new Date(start + 2_300).toISOString() },
    ] });
    const shared: WorkspaceMessage = {
      id: 'live-item-run-item-1', narrationItemId: 'item-1', role: 'narration', text,
      source: 'history', sessionKey, transcriptSessionId: sessionId, runId: 'run', timestamp: String(start + 1_000),
    };

    const merged = mergeSharedNarration([
      ...rows.slice(0, 2),
      { ...shared, source: 'live', state: 'streaming' },
      ...rows.slice(2),
    ], [shared]);
    expect(merged.filter((row) => row.text === text)).toHaveLength(1);
    expect(merged.map((row) => row.role)).toEqual(['user', 'narration', 'tool']);
    expect(merged[1]).toMatchObject({ transcriptSessionId: sessionId, narrationItemId: 'item-1', runId: 'run' });
  });
  it('does not collapse repeated native text when the narration pairing is ambiguous', () => {
    const text = 'I will check that now.';
    const rows = messagesFromPayload({ sessionKey, sessionId, messages: [
      { id: 'first', role: 'assistant', content: text, timestamp: new Date(start + 1_000).toISOString() },
      { id: 'second', role: 'assistant', content: text, timestamp: new Date(start + 2_000).toISOString() },
    ] });
    const shared: WorkspaceMessage = {
      id: 'live-item-run-item-2', narrationItemId: 'item-2', role: 'narration', text,
      source: 'history', sessionKey, transcriptSessionId: sessionId, runId: 'run', timestamp: String(start + 1_500),
    };

    const merged = mergeSharedNarration(rows, [shared]);

    expect(merged.filter((row) => row.text === text)).toHaveLength(3);
    expect(merged.filter((row) => row.role === 'assistant')).toHaveLength(2);
    expect(merged.filter((row) => row.role === 'narration')).toHaveLength(1);
  });
  it('does not undo native display order with timestamp sorting', () => {
    expect(ids(page())).toEqual(['prompt', 'activity', 'answer']);
  });

  it('retains bounded native row identity and concrete history ownership', () => {
    const messages = messagesFromPayload({ sessionKey, sessionId, messages: [{
      role: 'user', text: 'request', timestamp: start,
      __openclaw: { id: 'canonical-prompt', idempotencyKey: 'request-1:user' },
    }] });
    expect(messages[0]).toMatchObject({ id: 'canonical-prompt', idempotencyKey: 'request-1:user', transcriptSessionId: sessionId });
  });

  it('projects the native media envelope retained by the official legacy importer', () => {
    const messages = messagesFromPayload({ sessionKey, sessionId, messages: [{
      role: 'assistant', content: 'attached', __openclaw: { id: 'image', media: [
        { path: '/tmp/result.png', contentType: 'image/png', kind: 'image' },
        { url: 'https://example.test/result.pdf', contentType: 'application/pdf', kind: 'document' },
      ] },
    }] });
    expect(messages[0]?.attachments).toEqual([
      expect.objectContaining({ filename: 'result.png', mimeType: 'image/png', uri: '/__openclaw__/assistant-media?source=%2Ftmp%2Fresult.png' }),
      expect.objectContaining({ filename: 'result.pdf', mimeType: 'application/pdf', uri: 'https://example.test/result.pdf' }),
    ]);
  });

  it('keeps canonical pre-reset display rows only for the explicitly negotiated same session', () => {
    const foreign = messagesFromPayload({ sessionKey, sessionId: otherSessionId, messages: [{ id: 'foreign', role: 'assistant', text: 'wrong session', timestamp: start + 1 }] });
    const live: WorkspaceMessage = { id: 'stale-live', role: 'assistant', text: 'old', source: 'live', sessionKey, timestamp: String(start - 1) };
    const local: WorkspaceMessage = { id: 'new-prompt', role: 'user', text: 'new', source: 'local', sessionKey, timestamp: String(start + 1) };
    expect(ids(messagesOwnedBySessionGeneration([...page(), ...foreign, live, local], generation)))
      .toEqual(['prompt', 'activity', 'answer', 'new-prompt']);
    expect(ids(messagesOwnedBySessionGeneration([...page(), live, local], { sessionId, sessionStartedAtMs: start })))
      .toEqual(['new-prompt']);
  });

  it('requires the explicit registry capability and invalidates older policy publications', () => {
    const legacy = gatewaySessionGeneration(project, null);
    expect(legacy).toEqual({ sessionId, sessionStartedAtMs: start });
    expect(gatewaySessionGeneration(project, { capabilities: { sessionHistory: 'unknown' } })).toEqual(legacy);
    expect(gatewaySessionGeneration(project, { capabilities: { sessionHistory: 'sqlite-display-v1' } })).toEqual(generation);
    expect(sessionGenerationChanged(legacy, generation)).toBe(true);
    const current = page();
    expect(generationReboundVisiblePublication(sessionKey, sessionKey, sessionKey, legacy, generation, 'latest', current, current)).toBe(current);
  });

  it('does not borrow a reset epoch from a different registry session', () => {
    const registry = { threads: { json: JSON.stringify({ threads: [{ currentBinding: {
      stableSessionKey: sessionKey, state: 'current', sessionID: otherSessionId, sessionStartedAtMs: start,
    } }] }) } };
    const { sessionStartedAtMs: _started, ...withoutEpoch } = project;
    expect(gatewaySessionGeneration(withoutEpoch, registry))
      .toEqual({ sessionId, sessionStartedAtMs: 0 });
  });

  it('preserves native order and ownership through bounded cache serialization', () => {
    const messages = page();
    const restored = parsedTranscriptCache(serializedTranscriptCache(messages));
    expect(ids(restored)).toEqual(['prompt', 'activity', 'answer']);
    expect(ids(messagesOwnedBySessionGeneration(restored, generation))).toEqual(ids(messages));
  });

  it('publishes newly arrived ordering and ownership facts even when the visible text is unchanged', () => {
    const unpositioned = messagesFromPayload({ sessionKey, messages: [rawRows[0]] });
    const owned = page([rawRows[0]!]);
    expect(sameTranscriptPublication(unpositioned, owned)).toBe(false);
    const noPosition = messagesFromPayload({ sessionKey, sessionId, messages: [{ ...rawRows[0], __openclaw: {} }] });
    expect(sameTranscriptPublication(noPosition, owned)).toBe(false);
    expect(sameTranscriptPublication(owned, page([rawRows[0]!]))).toBe(true);
  });

  it('recomposes native activity placement after overlapping latest and older pages merge', () => {
    const latest = page(rawRows.slice(1));
    expect(ids(mergeOlderHistory(page([rawRows[0]!]), latest, sessionKey))).toEqual(['prompt', 'activity', 'answer']);
    expect(ids(mergeLatestHistory(latest, page(), sessionKey))).toEqual(['prompt', 'activity', 'answer']);
  });
});
