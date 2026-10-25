import type { GatewayProfile } from './setupCode';

type StoredCredential = { kind: string; token: string; scopes?: string[]; authorityGeneration?: string };
type StoredEndpoint = { host: string; port: number; useTLS: boolean; path?: string; sessionKey: string };

export function profileFromSharedRecords(credentialJSON: string, endpointJSON: string): GatewayProfile | null {
  try {
    const credential = JSON.parse(credentialJSON) as StoredCredential;
    const endpoint = JSON.parse(endpointJSON) as StoredEndpoint;
    if (credential.kind !== 'pairedDeviceToken' || !credential.token || !endpoint.host || !endpoint.port) return null;
    const scheme = endpoint.useTLS ? 'wss' : 'ws';
    const defaultPort = endpoint.useTLS ? 443 : 80;
    const port = endpoint.port === defaultPort ? '' : `:${endpoint.port}`;
    const path = endpoint.path && endpoint.path !== '/' ? (endpoint.path.startsWith('/') ? endpoint.path : `/${endpoint.path}`) : '';
    return {
      endpoint: `${scheme}://${endpoint.host}${port}${path}`,
      credentialKind: 'deviceToken',
      credential: credential.token,
      sessionKey: endpoint.sessionKey || 'agent:main:direct:vimicate-ios',
      scopes: Array.isArray(credential.scopes) ? credential.scopes.filter((scope): scope is string => typeof scope === 'string') : [],
      authoritySource: 'sharedKeychain',
    };
  } catch { return null; }
}
