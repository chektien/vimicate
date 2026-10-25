import { describe, expect, it } from 'vitest';
import { serializedGatewayFrame } from './gatewayOutboundFrame';
describe('attachment request wire budget', () => {
  it('permits eighteen MiB encoded as base64 with normal request overhead', () => {
    const frame = { type: 'req', id: 'fixture', method: 'chat.send', params: { message: 'review', attachments: [{ content: 'A'.repeat(24 * 1024 * 1024) }] } };
    expect(JSON.parse(serializedGatewayFrame(frame)).params.message).toBe('review');
  });
  it('rejects prompt and Unicode overhead before writing to the connection', () => {
    expect(() => serializedGatewayFrame({ method: 'chat.send', params: { message: '😀'.repeat(1024 * 1024), attachments: [{ content: 'A'.repeat(22 * 1024 * 1024) }] } })).toThrow('connection upload budget');
  });
  it('retains the exact UTF-8 limit for mixed Unicode, surrogate pairs and escaped lone surrogates', () => {
    const message = 'é漢😀\ud800\udc00\ud800';
    const frame = { method: 'chat.send', params: { message, attachments: [{ content: '' }] } };
    const overhead = new TextEncoder().encode(JSON.stringify(frame)).byteLength;
    frame.params.attachments[0]!.content = 'A'.repeat(25 * 1024 * 1024 - overhead);
    expect(serializedGatewayFrame(frame)).toBe(JSON.stringify(frame));
    frame.params.attachments[0]!.content += 'A';
    expect(() => serializedGatewayFrame(frame)).toThrow('connection upload budget');
  });
});
