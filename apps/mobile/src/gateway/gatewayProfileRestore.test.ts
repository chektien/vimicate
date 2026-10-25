import { describe, expect, it } from 'vitest';
import type { GatewayProfile } from './setupCode';
import { gatewayProfileRestorePlan, settledSharedGatewayProfile } from './gatewayProfileRestore';

const sharedProfile: GatewayProfile = {
  endpoint: 'wss://gateway.example.test',
  sessionKey: 'agent:main:direct:vimicate-ios',
  credentialKind: 'deviceToken',
  credential: 'shared-token',
};

describe('Gateway profile cold-start restoration', () => {
  it('establishes a connection from shared, private, or legacy pairing authority', () => {
    expect(gatewayProfileRestorePlan(sharedProfile, null, null)).toMatchObject({
      source: 'shared',
      shouldConnect: true,
      shouldPersistPrivate: true,
    });

    expect(gatewayProfileRestorePlan(null, JSON.stringify({ ...sharedProfile, credential: 'private-token' }), null)).toMatchObject({
      source: 'private',
      shouldConnect: true,
      shouldPersistPrivate: false,
    });

    expect(gatewayProfileRestorePlan(null, null, JSON.stringify({ ...sharedProfile, credential: 'legacy-token' }))).toMatchObject({
      source: 'legacy',
      shouldConnect: true,
      shouldPersistPrivate: true,
    });
  });

  it('has no startup connection plan only when every pairing source is absent', () => {
    expect(gatewayProfileRestorePlan(null, null, null)).toBeNull();
  });

  it('contains a rejected shared-Keychain read so private pairing restoration can continue', async () => {
    const result = await settledSharedGatewayProfile(async () => {
      throw new Error('Keychain status -34018');
    });

    expect(result.profile).toBeNull();
    expect(result.problem).toBe('Keychain status -34018');
    expect(gatewayProfileRestorePlan(result.profile, JSON.stringify(sharedProfile), null)?.source).toBe('private');
  });
});
