import { describe, expect, it } from 'vitest';
import { messagesFromPayload } from './historyMessageProjection';
import { mergeLatestHistory, mergeOlderHistory } from '../gateway/historyPagination';
import { parsedTranscriptCache, serializedTranscriptCache } from '../gateway/persistentTranscriptCache';

const sessionKey = 'agent:main:dashboard:fixture';
const runId = 'fixture-message-run';
const send = (id: string, message: string, extra: Record<string, unknown> = {}) => ({ role: 'assistant', timestamp: 1700000002000, stopReason: 'tool_use', api: 'anthropic-messages', provider: 'claude-cli',
  content: [{ type: 'toolcall', id, name: 'mcp__openclaw__message', arguments: { action: 'send', message, ...extra } }, { type: 'tool_result', tool_use_id: id, name: 'mcp__openclaw__message', content: [{ type: 'text', text: 'Sent visible reply to the current source conversation via internal-ui.' }] }],
  __openclaw: { id, importedFrom: 'claude-cli', cliSessionId: 'cli', externalId: id } });
const mirror = (id: string, text: string, rawSeq: number) => ({ role: 'assistant', api: 'openclaw-transcript', provider: 'openclaw', model: 'delivery-mirror', stopReason: 'stop', timestamp: 1700000002554,
  content: [{ type: 'text', text }], idempotencyKey: `${runId}:message-tool:fingerprint:mcp-${id}`,
  __openclaw: { runId, id: `mirror-${id}`, idempotencyKey: `${runId}:message-tool:fingerprint:mcp-${id}`, recordTimestampMs: 1700000002560, transcriptPosition: { source: 'fixture', rawSeq } } });
const roles = (messages: unknown[]) => messagesFromPayload({ sessionKey, messages }).filter(row => row.role === 'assistant' || row.role === 'narration').map(row => `${row.role}: ${row.text}`);

// Synthetic progress sent mid-turn through the
// message tool must retain its commentary role and glyph.
describe('message-tool sends mirrored into the transcript', () => {
  it.each(['older', 'latest'] as const)('coalesces an overlapping %s page after resolving its mirror role', direction => {
    const sessionId = '11111111-1111-4111-8111-111111111111';
    const current = messagesFromPayload({ sessionKey, sessionId, messages: [mirror('overlap', 'Working.', 1)] });
    const overlap = messagesFromPayload({ sessionKey, sessionId, messages: [send('overlap', 'Working.', { final: false }), mirror('overlap', 'Working.', 1)] });
    const merged = direction === 'older' ? mergeOlderHistory(overlap, current, sessionKey) : mergeLatestHistory(overlap, current, sessionKey);
    expect(merged.filter(row => row.id === 'mirror-overlap')).toHaveLength(1);
    expect(merged.find(row => row.id === 'mirror-overlap')?.role).toBe('narration');
  });

  it.each(['older', 'latest', 'cache'] as const)('repairs a glyph when its call arrives via %s', direction => {
    const call = messagesFromPayload({ sessionKey, messages: [send('page', 'Working across pages.', { final: false })] });
    const mirrored = messagesFromPayload({ sessionKey, messages: [mirror('page', 'Working across pages.', 1)] });
    const loaded = direction === 'older' ? mergeOlderHistory(call, mirrored, sessionKey)
      : direction === 'latest' ? mergeLatestHistory(mirrored, call, sessionKey)
      : mergeOlderHistory(parsedTranscriptCache(serializedTranscriptCache(call)), parsedTranscriptCache(serializedTranscriptCache(mirrored)), sessionKey);
    expect(loaded.find(row => row.id === 'mirror-page')?.role).toBe('narration');
    expect(loaded.filter(row => row.id === 'mirror-page')).toHaveLength(1);
  });

  it('does not borrow classification from another concrete transcript', () => {
    const old = messagesFromPayload({ sessionKey, sessionId: '11111111-1111-4111-8111-111111111111', messages: [send('old', 'Same words.', { final: false })] });
    const newer = messagesFromPayload({ sessionKey, sessionId: '22222222-2222-4222-8222-222222222222', messages: [mirror('new', 'Same words.', 1)] });
    expect(mergeOlderHistory(old, newer, sessionKey).find(row => row.id === 'mirror-new')?.role).toBe('assistant');
  });

  it('does not carry an earned glyph into changed mirror content or a new concrete transcript', () => {
    const sessionId = '11111111-1111-4111-8111-111111111111';
    const known = messagesFromPayload({ sessionKey, sessionId, messages: [send('a', 'Working.', { final: false }), mirror('a', 'Working.', 1)] })
      .filter(row => row.id === 'mirror-a');
    for (const [generation, text] of [[sessionId, 'Different message.'], ['22222222-2222-4222-8222-222222222222', 'Working.']]) {
      const incoming = messagesFromPayload({ sessionKey, sessionId: generation, messages: [mirror('a', text!, 1)] });
      expect(mergeLatestHistory(incoming, known, sessionKey).find(row => row.id === 'mirror-a' && row.transcriptSessionId === generation && row.text === text)?.role).toBe('assistant');
    }
  });

  it('honors a completed send loaded later and keeps an earned glyph when its call leaves the cache', () => {
    const sessionId = '11111111-1111-4111-8111-111111111111';
    const rows = messagesFromPayload({ sessionKey, sessionId, messages: [send('a', 'Repeated.', { final: false }), mirror('a', 'Repeated.', 1)] });
    const mirrored = rows.filter(row => row.id === 'mirror-a');
    const restored = parsedTranscriptCache(serializedTranscriptCache(mirrored));
    expect(restored[0]?.role).toBe('narration');
    const refreshed = mergeLatestHistory(messagesFromPayload({ sessionKey, sessionId, messages: [mirror('a', 'Repeated.', 1)] }), restored, sessionKey);
    expect(refreshed.find(row => row.id === 'mirror-a')?.role).toBe('narration');
    const completed = messagesFromPayload({ sessionKey, sessionId, messages: [send('b', 'Repeated.')] });
    expect(mergeOlderHistory(completed, refreshed, sessionKey).find(row => row.id === 'mirror-a')?.role).toBe('assistant');
  });
  it('reads a send marked final: false as commentary', () => {
    expect(roles([send('a', 'Checking the sample data now.', { final: false }), mirror('a', 'Checking the sample data now.', 1)]))
      .toEqual(['narration: Checking the sample data now.']);
  });

  it('keeps a completed send, with or without an explicit final, as a reply', () => {
    expect(roles([send('b', 'Step 1 is ready for review.'), mirror('b', 'Step 1 is ready for review.', 1),
      send('c', 'All done.', { final: true }), mirror('c', 'All done.', 2)]))
      .toEqual(['assistant: Step 1 is ready for review.', 'assistant: All done.']);
  });

  it('keeps a reply when the same words were also sent as a completed reply', () => {
    expect(roles([send('d', 'Working on it.', { final: false }), send('e', 'Working on it.'), mirror('d', 'Working on it.', 1)]))
      .toEqual(['assistant: Working on it.']);
  });

  it('never reclassifies an ordinary answer that repeats a progress text', () => {
    const answer = { role: 'assistant', timestamp: 1700000010000, stopReason: 'end_turn', api: 'anthropic-messages', provider: 'claude-cli', content: [{ type: 'text', text: 'Checking the sample data now.' }],
      __openclaw: { id: 'end', importedFrom: 'claude-cli', cliSessionId: 'cli', externalId: 'end' } };
    expect(roles([send('f', 'Checking the sample data now.', { final: false }), answer])).toEqual(['assistant: Checking the sample data now.']);
  });

  it('leaves a mirror whose sending call is outside the loaded window as a reply', () => {
    expect(roles([mirror('g', 'Earlier progress.', 1)])).toEqual(['assistant: Earlier progress.']);
  });
});
