import { describe, expect, it } from 'vitest';
import { decorateGatewayMedia } from './gatewayMedia';

describe('gateway media authentication policy', () => {
  it('authenticates only managed same-gateway media routes', () => {
    const [message] = decorateGatewayMedia([{
      id: 'one', role: 'assistant', text: 'files', attachments: [
        { id: 'managed', filename: 'capture.png', mimeType: 'image/png', uri: '/api/chat/media/outgoing/capture.png' },
        { id: 'external', filename: 'external.png', mimeType: 'image/png', uri: 'https://files.example/external.png' },
      ],
    }], 'wss://gateway.tailnet.example/socket?token=ignored', 'device-secret', 'agent:main:one');

    expect(message?.attachments?.[0]).toMatchObject({
      uri: 'https://gateway.tailnet.example/api/chat/media/outgoing/capture.png',
      headers: { Authorization: 'Bearer device-secret', 'x-openclaw-requester-session-key': 'agent:main:one' },
    });
    expect(message?.attachments?.[1]).toEqual({ id: 'external', filename: 'external.png', mimeType: 'image/png', uri: 'https://files.example/external.png' });
  });

  it('does not decorate non-websocket or malformed gateway endpoints', () => {
    const messages = [{ id: 'one', role: 'assistant' as const, text: 'image', attachments: [{ id: 'a', filename: 'a.png', mimeType: 'image/png', uri: '/api/chat/media/outgoing/a.png' }] }];
    expect(decorateGatewayMedia(messages, 'https://gateway.example', 'secret', 'one')).toEqual(messages);
    expect(decorateGatewayMedia(messages, 'not a url', 'secret', 'one')).toEqual(messages);
  });

  it('normalizes gateway-local file and outgoing sources before adding paired authority', () => {
    const [message] = decorateGatewayMedia([{ id: 'one', role: 'assistant', text: '', attachments: [
      { id: 'file', filename: 'host.png', mimeType: 'image/png', uri: 'file:///Users/fixture/Downloads/host.png' },
      { id: 'outgoing', filename: 'out.png', mimeType: 'image/png', uri: 'media://outgoing/id?sessionKey=one' },
    ] }], 'wss://gateway.example/socket', 'secret', 'one');
    expect(message?.attachments?.every((attachment) => attachment.uri?.startsWith('https://gateway.example/__openclaw__/assistant-media'))).toBe(true);
    expect(message?.attachments?.every((attachment) => attachment.headers?.Authorization === 'Bearer secret')).toBe(true);
  });

  it('restores paired authority onto persisted absolute same-Gateway media URLs', () => {
    const [message] = decorateGatewayMedia([{ id: 'one', role: 'assistant', text: '', attachments: [
      { id: 'cached', filename: 'cached.png', mimeType: 'image/png', uri: 'https://gateway.example/dashboard/__openclaw__/assistant-media?source=%2Ftmp%2Fcached.png' },
      { id: 'foreign', filename: 'foreign.png', mimeType: 'image/png', uri: 'https://cdn.example/__openclaw__/assistant-media?source=%2Ftmp%2Fforeign.png' },
    ] }], 'wss://gateway.example/socket', 'secret', 'agent:main:one');
    expect(message?.attachments?.[0]).toMatchObject({
      uri: 'https://gateway.example/dashboard/__openclaw__/assistant-media?source=%2Ftmp%2Fcached.png',
      headers: { Authorization: 'Bearer secret', 'x-openclaw-requester-session-key': 'agent:main:one' },
    });
    expect(message?.attachments?.[1]?.headers).toBeUndefined();
  });
});
