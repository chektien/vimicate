import { toByteArray } from 'base64-js';

export type CredentialKind = 'none' | 'bootstrapToken' | 'token' | 'deviceToken';
export type GatewayProfile = {
  endpoint: string;
  credentialKind: CredentialKind;
  credential: string;
  sessionKey: string;
  scopes?: string[];
  authoritySource?: 'sharedKeychain';
};

function isLocalHost(host: string) {
  const value = host.toLowerCase().replace(/^\[|\]$/g, '');
  if (value === 'localhost' || value === '::1' || value.endsWith('.local') || value.endsWith('.ts.net')) return true;
  const parts = value.split('.').map(Number);
  if (parts.length !== 4 || parts.some(Number.isNaN)) return false;
  return parts[0] === 10 || parts[0] === 127 || (parts[0] === 100 && (parts[1] ?? 0) >= 64 && (parts[1] ?? 0) <= 127) || (parts[0] === 172 && (parts[1] ?? 0) >= 16 && (parts[1] ?? 0) <= 31) || (parts[0] === 192 && parts[1] === 168) || (parts[0] === 169 && parts[1] === 254);
}
function decodeBase64Url(value: string) {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - value.length % 4) % 4);
  const bytes = toByteArray(base64);
  // Hermes does not provide the browser TextDecoder global. Decode UTF-8 with
  // the ECMAScript URI decoder, which also rejects malformed byte sequences.
  return decodeURIComponent(Array.from(bytes, (byte) => `%${byte.toString(16).padStart(2, '0')}`).join(''));
}
function fromUrl(raw: string, credentialKind: CredentialKind = 'none', credential = ''): GatewayProfile | null {
  try {
    const bareHost = raw.split(':')[0] ?? raw;
    const input = raw.includes('://') ? raw : `${bareHost.toLowerCase().endsWith('.ts.net') || !isLocalHost(bareHost) ? 'wss' : 'ws'}://${raw}`;
    const url = new URL(input);
    if (url.protocol === 'openclaw:' && url.hostname === 'gateway') {
      const host = url.searchParams.get('host'); if (!host) return null;
      const tls = url.searchParams.get('tls') === 'true'; const port = url.searchParams.get('port') ?? (tls ? '443' : '18789');
      return fromUrl(`${tls ? 'wss' : 'ws'}://${host}:${port}${url.searchParams.get('path') ?? ''}`, (url.searchParams.get('bootstrapToken') ? 'bootstrapToken' : url.searchParams.get('token') ? 'token' : credentialKind), url.searchParams.get('bootstrapToken') ?? url.searchParams.get('token') ?? credential);
    }
    if (!['ws:', 'wss:', 'http:', 'https:'].includes(url.protocol)) return null;
    const tls = url.protocol === 'wss:' || url.protocol === 'https:';
    if (!tls && !isLocalHost(url.hostname)) return null;
    const port = url.port || (tls ? '443' : '18789');
    const normalizedPort = !tls && port === '443' && isLocalHost(url.hostname) ? '18789' : port;
    const path = url.pathname === '/' ? '' : url.pathname;
    const bootstrap = url.searchParams.get('bootstrapToken'); const token = url.searchParams.get('token');
    return { endpoint: `${tls ? 'wss' : 'ws'}://${url.hostname}${normalizedPort === (tls ? '443' : '80') ? '' : `:${normalizedPort}`}${path}`, credentialKind: bootstrap ? 'bootstrapToken' : token ? 'token' : credentialKind, credential: bootstrap ?? token ?? credential, sessionKey: 'agent:main:direct:vimicate-rn-phase1' };
  } catch { return null; }
}
export function parseSetupCode(input: string): GatewayProfile | null {
  const trimmed = input.trim(); if (!trimmed) return null;
  try {
    const payload = JSON.parse(trimmed) as { url?: string; host?: string; port?: number; tls?: boolean; path?: string; bootstrapToken?: string; token?: string };
    const raw = payload.url ?? (payload.host ? `${payload.tls === false ? 'ws' : 'wss'}://${payload.host}:${payload.port ?? (payload.tls === false ? 18789 : 443)}${payload.path ?? ''}` : '');
    if (raw) return fromUrl(raw, payload.bootstrapToken ? 'bootstrapToken' : payload.token ? 'token' : 'none', payload.bootstrapToken ?? payload.token ?? '');
  } catch { /* continue */ }
  try { const parsed = parseSetupCode(decodeBase64Url(trimmed)); if (parsed) return parsed; } catch { /* continue */ }
  return fromUrl(trimmed);
}
