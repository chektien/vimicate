import { describe, expect, it, vi } from 'vitest';
import { fromByteArray } from 'base64-js';
import { parseSetupCode } from './setupCode';
describe('OpenClaw setup parsing', () => {
  it('decodes UTF-8 setup codes without the browser TextDecoder global', () => {
    const payload = { url: 'ws://127.0.0.1:19123', bootstrapToken: 'synthetic-bootstrap', note: '测试' };
    const encoded = fromByteArray(new TextEncoder().encode(JSON.stringify(payload)));
    vi.stubGlobal('TextDecoder', undefined);
    try {
      expect(parseSetupCode(encoded)).toMatchObject({ endpoint: payload.url, credentialKind: 'bootstrapToken', credential: payload.bootstrapToken });
    } finally { vi.unstubAllGlobals(); }
  });
  it('normalizes local port 443 to 18789', () => expect(parseSetupCode('{"host":"192.168.1.4","port":443,"tls":false}')?.endpoint).toBe('ws://192.168.1.4:18789'));
  it('rejects cleartext public hosts', () => expect(parseSetupCode('ws://example.com:18789')).toBeNull());
  it('accepts TLS Tailscale hosts', () => expect(parseSetupCode('host.tail.ts.net')?.endpoint).toBe('wss://host.tail.ts.net'));
  it('preserves the bootstrap credential kind from the built-in base64url setup-code shape', () => {
    const payload = JSON.stringify({ url: 'ws://127.0.0.1:18789', bootstrapToken: 'one-shot-bootstrap' });
    const setupCode = fromByteArray(new TextEncoder().encode(payload)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
    expect(parseSetupCode(setupCode)).toMatchObject({
      endpoint: 'ws://127.0.0.1:18789',
      credentialKind: 'bootstrapToken',
      credential: 'one-shot-bootstrap',
    });
  });
});
