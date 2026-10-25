import { describe, expect, it } from 'vitest';
import type { GatewayProfile } from './setupCode';
import { gatewayDeviceFamilyForProfile } from './gatewayDeviceFamily';

const profile = (overrides: Partial<GatewayProfile> = {}): GatewayProfile => ({
  endpoint: 'wss://gateway.example.com',
  credentialKind: 'deviceToken',
  credential: 'token',
  sessionKey: 'agent:main:direct:vimicate-rn-phase1',
  ...overrides,
});

describe('gateway device-family authentication metadata', () => {
  it('preserves the native ipad registration metadata for a migrated iPhone identity', () => {
    expect(gatewayDeviceFamilyForProfile(profile({
      authoritySource: 'sharedKeychain',
      sessionKey: 'agent:main:direct:vimicate-ios',
    }), 'iphone')).toBe('ipad');
    expect(gatewayDeviceFamilyForProfile(profile({
      authoritySource: 'sharedKeychain',
      sessionKey: 'agent:main:dashboard:00000000-0000-4000-b000-000000000112',
    }), 'iphone')).toBe('ipad');
  });

  it('keeps an RN-local identity on its physical family', () => {
    expect(gatewayDeviceFamilyForProfile(profile(), 'iphone')).toBe('iphone');
  });
});
