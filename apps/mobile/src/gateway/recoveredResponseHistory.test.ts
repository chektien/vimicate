import { describe, expect, it } from 'vitest';
import { type WorkspaceMessage } from '../workspace/workspaceTypes';
import { messagesFromPayload } from '../workspace/historyMessageProjection';
import { mergeLatestHistory } from './historyPagination';
import { messageByApplyingRecovery, recoveredToolRows } from './messageRecovery';
import { parsedTranscriptCache, serializedTranscriptCache } from './persistentTranscriptCache';

const sessionKey = 'agent:main:dashboard:00000000-0000-4000-a000-000000000121';
const generation = '00000000-0000-4000-a000-000000000121';
const sourceMessageId = '00000000-0000-4000-8000-000000000157';
const clippedText = `${'A'.repeat(8_001)}...(truncated)...`;
const fullText = `${'A'.repeat(8_001)}${'B'.repeat(519)}`;
const attachment = { id: 'proof', filename: 'proof.png', mimeType: 'image/png', uri: '/assistant-media/proof.png' };

function history(id = sourceMessageId, text = clippedText, sessionId = generation) {
  return messagesFromPayload({ sessionKey, sessionId, messages: [{
    id, role: 'assistant', content: [{ type: 'text', text }],
    __openclaw: { id, truncated: true, reason: text === '[chat.history omitted: message too large]' ? 'oversized' : 'display-cap', seq: 2156 },
  }] })[0]!;
}

function recovered(canonical = history()) {
  return messageByApplyingRecovery(canonical, fullText, [attachment]);
}

describe('recovered response across history publication', () => {
  it('keeps a recovered oversized tool result through a latest-history refresh', () => {
    const canonical = history();
    let rows: WorkspaceMessage[] = recoveredToolRows(canonical, { message: { role: 'user',
      content: [{ type: 'tool_result', tool_use_id: 'shot', content: 'screenshot bytes described' }] } }, sessionKey);
    expect(rows[0]).toMatchObject({ id: sourceMessageId, role: 'tool', recovery: { state: 'recovered' } });
    rows = mergeLatestHistory([canonical], rows, sessionKey);
    expect(rows.find(row => row.id === sourceMessageId)).toMatchObject({ role: 'tool', recovery: { state: 'recovered' } });
    expect(rows.find(row => row.id === sourceMessageId)?.text).toContain('screenshot bytes described');
  });

  it('keeps the full display-cap response and media through repeated latest-history refreshes', () => {
    const canonical = history();
    expect(canonical.recovery).toEqual({ sourceMessageId, state: 'available' });
    let rows: WorkspaceMessage[] = [recovered(canonical)];
    for (let index = 0; index < 3; index += 1) {
      rows = mergeLatestHistory([canonical], rows, sessionKey);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ text: fullText, attachments: [attachment], recovery: { sourceMessageId, state: 'recovered' } });
    }
  });

  it('keeps recovered content after a bounded cache round trip and refresh', () => {
    const canonical = history();
    const restored = parsedTranscriptCache(serializedTranscriptCache([recovered(canonical)]));
    expect(restored[0]).toMatchObject({ text: fullText, attachments: [attachment], recovery: { state: 'recovered' } });
    expect(mergeLatestHistory([canonical], restored, sessionKey)[0]).toMatchObject({ text: fullText, attachments: [attachment], recovery: { state: 'recovered' } });
  });

  it.each(['[chat.history omitted: message too large]', 'partial…(truncated)…'])('keeps recovery over incomplete history text %s', (text) => {
    const canonical = history(sourceMessageId, text);
    const loaded = messageByApplyingRecovery(canonical, fullText, [attachment]);
    expect(mergeLatestHistory([canonical], [loaded], sessionKey)[0]).toMatchObject({ text: fullText, attachments: [attachment], recovery: { state: 'recovered' } });
  });

  it('prefers a later complete canonical response and its attachment snapshot', () => {
    const canonical = history();
    const { recovery: _recovery, ...fresh } = history(sourceMessageId, 'A newer complete canonical answer');
    const complete = { ...fresh,
      attachments: [{ ...attachment, id: 'canonical-proof' }] };
    expect(mergeLatestHistory([complete], [recovered(canonical)], sessionKey)).toEqual([complete]);
  });

  it('does not carry recovery into another generation, route, or source message', () => {
    const loaded = recovered();
    for (const [index, candidate] of [
      history(sourceMessageId, clippedText, '00000000-0000-4000-8000-000000000107'),
      history('different-message'),
      { ...history(), sessionKey: 'agent:main:other' },
    ].entries()) {
      const merged = mergeLatestHistory([candidate], [loaded], candidate.sessionKey!);
      const published = merged.find(row => row.id === candidate.id && row.sessionKey === candidate.sessionKey
        && row.transcriptSessionId === candidate.transcriptSessionId);
      expect({ index, textLength: published?.text.length, attachments: published?.attachments, state: published?.recovery?.state })
        .toEqual({ index, textLength: candidate.text.length, attachments: candidate.attachments, state: candidate.recovery?.state });
    }
  });
});
