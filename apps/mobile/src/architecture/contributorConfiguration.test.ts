// @ts-expect-error Vitest's Node runtime provides this test-only module.
import { createRequire } from 'node:module';
// @ts-expect-error Vitest's Node runtime provides this test-only module.
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
const configure = require('../../app.config.js');
const shipping = require('../../app.json').expo;
const nativeSource = readFileSync(new URL('../../modules/vimicate-shared-keychain/ios/VimicateSharedKeychainModule.swift', import.meta.url), 'utf8');

afterEach(() => vi.unstubAllEnvs());

describe('contributor build isolation', () => {
  it('leaves the complete shipping config unchanged by default and in production mode', () => {
    vi.stubEnv('VIMICATE_BUILD_MODE', '');
    expect(configure({ config: shipping })).toBe(shipping);
    vi.stubEnv('VIMICATE_BUILD_MODE', 'production');
    expect(configure({ config: shipping })).toBe(shipping);
  });

  it('cannot target maintainer signing, updates, shared records or installed application data', () => {
    const input = JSON.parse(JSON.stringify(shipping));
    input.owner = 'synthetic-owner';
    input.runtimeVersion = 'synthetic-runtime';
    input.updates = { url: 'https://updates.example.test' };
    input.ios.appleTeamId = 'SYNTHETIC1';
    input.ios.bundleIdentifier = 'test.example.shipping';
    input.ios.entitlements = { 'keychain-access-groups': ['SYNTHETIC1.test.example.shared'] };
    input.extra = { eas: { projectId: 'synthetic-project-id' }, storageNamespace: 'test.example.shipping' };
    const original = JSON.stringify(input);
    vi.stubEnv('VIMICATE_BUILD_MODE', 'contributor');
    const config = configure({ config: input });
    expect(config.name).toBe('Vimicate Contributor');
    expect(config.ios.bundleIdentifier).toBe('org.vimicate.contributor');
    expect(config.scheme).toBe('vimicate-contributor');
    expect(config.extra.storageNamespace).toBe('org.vimicate.contributor');
    expect(config.ios.infoPlist.VimicateKeychainScope).toBe('application');
    expect(config.updates).toEqual({ enabled: false, checkAutomatically: 'NEVER' });
    for (const key of ['owner', 'runtimeVersion']) expect(config).not.toHaveProperty(key);
    expect(config.extra).not.toHaveProperty('eas');
    expect(config.ios).not.toHaveProperty('appleTeamId');
    expect(config.ios).not.toHaveProperty('entitlements');
    expect(JSON.stringify(config)).not.toMatch(/synthetic-owner|synthetic-runtime|SYNTHETIC1|synthetic-project-id|test\.example\.shipping|updates\.example\.test|\/Users\/|~\//);
    expect(JSON.stringify(input)).toBe(original);
    // The native security query must actually omit the shared access group,
    // not merely remove the signing entitlement while still requesting it.
    expect(nativeSource).toContain('if Bundle.main.object(forInfoDictionaryKey: "VimicateKeychainScope") as? String != "application" {');
    expect(nativeSource).toContain('query[kSecAttrAccessGroup as String] = self.accessGroup');
  });

  it('rejects a misspelled mode instead of accidentally preparing a shipping build', () => {
    vi.stubEnv('VIMICATE_BUILD_MODE', 'contributer');
    expect(() => configure({ config: shipping })).toThrow('Unknown VIMICATE_BUILD_MODE');
  });
});
