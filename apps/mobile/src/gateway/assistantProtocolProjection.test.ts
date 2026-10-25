import { describe, expect, it } from 'vitest';
import { projectAssistantProtocolContent } from './assistantProtocolProjection';

const image = { id: 'image', filename: 'proof.png', mimeType: 'image/png', uri: 'https://example.test/proof.png' };

describe('assistant protocol projection', () => {
  it.each(['NO_REPLY', 'HEARTBEAT_OK'])('hides exact terminal sentinel %s', (value) => {
    expect(projectAssistantProtocolContent(value, [], true)).toEqual({ text: '', attachments: [], deferred: false });
  });

  it.each(['N', 'NO', 'NO_', 'HEART', 'HEARTBEAT_'])('defers ambiguous cumulative prefix %s', (value) => {
    expect(projectAssistantProtocolContent(value, [], false)).toEqual({ text: '', attachments: [], deferred: true });
  });

  it.each(['NO', 'NO problem', 'NO_REPLY is a protocol token', 'HEARTBEAT_OK means healthy'])('preserves authored terminal text %s', (value) => {
    expect(projectAssistantProtocolContent(value, [], true).text).toBe(value);
  });

  it('preserves media while hiding sentinel text', () => {
    expect(projectAssistantProtocolContent('NO_REPLY', [image], true)).toEqual({ text: '', attachments: [image], deferred: false });
  });

  it.each(['working', 'wrapping up', 'waiting for response'])('suppresses generic streaming status %s but keeps terminal prose', (value) => {
    expect(projectAssistantProtocolContent(value, [], false).deferred).toBe(true);
    expect(projectAssistantProtocolContent(value, [], true).text).toBe(value);
  });

  it('suppresses a bare delivery identifier without hiding a prose delivery answer', () => {
    expect(projectAssistantProtocolContent('1480855314935844997', [], true).text).toBe('');
    expect(projectAssistantProtocolContent('Posted to #hmd. Message id: 1514813591587393749.', [], true).text).toContain('Posted to #hmd');
  });
});
