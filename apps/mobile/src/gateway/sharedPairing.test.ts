import { describe, expect, it } from 'vitest';
import { profileFromSharedRecords } from './sharedPairingRecords';

describe('shared native pairing records', () => {
  it('adapts the native credential and endpoint schema without exposing a new identity', () => {
    const profile = profileFromSharedRecords(
      JSON.stringify({ kind: 'pairedDeviceToken', token: 'device-token', scopes: ['operator.read'], authorityGeneration: 'generation' }),
      JSON.stringify({ host: 'gateway.example.com', port: 443, useTLS: true, path: '/gateway', sessionKey: 'agent:main:direct:vimicate-ios' }),
    );
    expect(profile).toEqual({ endpoint: 'wss://gateway.example.com/gateway', credentialKind: 'deviceToken', credential: 'device-token', sessionKey: 'agent:main:direct:vimicate-ios', scopes: ['operator.read'], authoritySource: 'sharedKeychain' });
  });

  it('rejects bootstrap and malformed records', () => {
    expect(profileFromSharedRecords(JSON.stringify({ kind: 'bootstrapToken', token: 'boot' }), JSON.stringify({ host: 'localhost', port: 18789, useTLS: false, sessionKey: 'key' }))).toBeNull();
    expect(profileFromSharedRecords('not-json', '{}')).toBeNull();
  });
});
