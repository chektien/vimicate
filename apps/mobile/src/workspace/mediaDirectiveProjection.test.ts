import { describe, expect, it } from 'vitest';
import { gatewayAttachments, gatewayContentText, messagesFromPayload } from './historyMessageProjection';

describe('assistant MEDIA directive projection', () => {
  it.each(['', ' ', '   '])('consumes a quoted own-line reference with %j indentation', (indent) => {
    const text = `Here\n${indent}MEDIA:"/workspace/my image.png"\nAfter`;
    expect(gatewayContentText(text)).toBe('Here\nAfter');
    expect(gatewayAttachments(text)).toEqual([expect.objectContaining({
      filename: 'my image.png', uri: '/__openclaw__/assistant-media?source=%2Fworkspace%2Fmy%20image.png',
    })]);
  });

  it.each([
    '```text\nMEDIA:/workspace/image.png\n```',
    '~~~~\nMEDIA:/workspace/image.png\n~~~\nMEDIA:/workspace/image.png\n~~~~',
    '    MEDIA:/workspace/image.png', '\tMEDIA:/workspace/image.png',
    '**MEDIA:/workspace/image.png**', '`MEDIA:/workspace/image.png`',
    'Here is an example: MEDIA:/workspace/image.png',
  ])('keeps non-directive code or prose literal without attachments', (text) => {
    expect(gatewayContentText(text)).toBe(text);
    expect(gatewayAttachments(text)).toEqual([]);
  });

  it.each(['/workspace/../private/image.png', '../private/image.png', '/workspace/%2e%2e/private/image.png',
    'file:///workspace/../private/image.png', 'http://127.0.0.1/image.png', 'javascript:image.png',
    '/workspace/image\u0000.png', '/private/secret.txt'])('never leaks or fetches an invalid/unsupported directive %j', (source) => {
    const text = `MEDIA:${source}`;
    const [message] = messagesFromPayload({ messages: [{ role: 'assistant', content: text }] });
    expect(message?.text).toBe('image unavailable');
    expect(message?.attachments).toBeUndefined();
  });

  it('keeps a valid missing image in authenticated media instead of displaying its host path', () => {
    const [message] = messagesFromPayload({ messages: [{ role: 'assistant',
      content: 'MEDIA:./missing.png' }] }, '/workspace/project');
    expect(message?.text).toBe('');
    expect(message?.attachments).toEqual([expect.objectContaining({
      filename: 'missing.png', uri: '/__openclaw__/assistant-media?source=%2Fworkspace%2Fproject%2Fmissing.png',
    })]);
  });

  it('routes inbound references to the same authenticated Gateway owner', () => {
    const text = 'MEDIA:media://inbound/retained-image';
    expect(gatewayContentText(text)).toBe('');
    expect(gatewayAttachments(text)[0]?.uri).toBe('/__openclaw__/assistant-media?source=media%3A%2F%2Finbound%2Fretained-image');
  });
});
