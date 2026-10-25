import { describe, expect, it } from 'vitest';
import { messageByApplyingRecovery, recoveredAssistantContent } from './messageRecovery';

describe('full assistant message recovery', () => {
  const clipped = { id: 'row', role: 'assistant' as const, text: 'partial...(truncated)...', recovery: { sourceMessageId: 'msg-1', state: 'available' as const } };

  it('parses a concrete chat.message.get response and upgrades one stable row', () => {
    const content = recoveredAssistantContent({ message: { content: [{ type: 'text', text: 'partial and now complete' }, { type: 'image', mimeType: 'image/png', url: 'https://example.test/proof.png' }] } });
    expect(messageByApplyingRecovery(clipped, content.text, content.attachments)).toMatchObject({ id: 'row', text: 'partial and now complete', recovery: { state: 'recovered' }, attachments: [{ uri: 'https://example.test/proof.png' }] });
  });

  it('never downgrades to an equal, shorter, or still-clipped representation', () => {
    expect(messageByApplyingRecovery(clipped, 'short', []).text).toBe(clipped.text);
    expect(messageByApplyingRecovery(clipped, `${'x'.repeat(30)}...(truncated)...`, []).recovery?.state).toBe('failed');
  });

  it('accepts a short complete answer in place of an oversized-history omission marker', () => {
    const omitted = {
      ...clipped,
      text: '[chat.history omitted: message too large]',
    };

    expect(messageByApplyingRecovery(omitted, 'Done.', [])).toMatchObject({
      id: 'row',
      text: 'Done.',
      recovery: { sourceMessageId: 'msg-1', state: 'recovered' },
    });
    expect(messageByApplyingRecovery(omitted, '   ', []).recovery?.state).toBe('failed');
    expect(messageByApplyingRecovery(omitted, '[chat.history omitted: message too large]', []).recovery?.state).toBe('failed');
  });
});
