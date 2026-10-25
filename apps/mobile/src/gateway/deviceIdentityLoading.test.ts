import { fromByteArray, toByteArray } from 'base64-js';
import nacl from 'tweetnacl';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  digest: vi.fn(),
  getRandomBytes: vi.fn(),
  secureGet: vi.fn(),
  secureSet: vi.fn(),
  sharedGet: vi.fn(),
  sharedSet: vi.fn(),
}));

vi.mock('expo-crypto', () => ({
  CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
  digest: mocks.digest,
  getRandomBytes: mocks.getRandomBytes,
}));

vi.mock('expo-secure-store', () => ({
  AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: 'after-first-unlock-this-device-only',
  getItemAsync: mocks.secureGet,
  setItemAsync: mocks.secureSet,
}));

vi.mock('expo-device', () => ({ isDevice: false }));

vi.mock('../../modules/vimicate-shared-keychain', () => ({
  getSharedKeychainItem: mocks.sharedGet,
  setSharedKeychainItem: mocks.sharedSet,
}));

import { loadOrCreateIdentity } from './deviceIdentity';

describe('shared OpenClaw identity loading', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.sharedGet.mockResolvedValue(null);
    mocks.sharedSet.mockResolvedValue(undefined);
    mocks.secureGet.mockResolvedValue(null);
    mocks.secureSet.mockResolvedValue(undefined);
    mocks.getRandomBytes.mockReturnValue(Uint8Array.from({ length: 32 }, (_, index) => index + 1));
    mocks.digest.mockResolvedValue(Uint8Array.from({ length: 32 }, (_, index) => index).buffer);
  });

  it('does not fall back to a local or generated key for a shared paired token', async () => {
    await expect(loadOrCreateIdentity(true)).rejects.toThrow('RN will not register a second device');
    expect(mocks.secureGet).not.toHaveBeenCalled();
    expect(mocks.getRandomBytes).not.toHaveBeenCalled();
    expect(mocks.sharedSet).not.toHaveBeenCalled();
  });

  it('rejects a malformed shared identity instead of replacing it', async () => {
    mocks.sharedGet.mockResolvedValue('{not-json');
    await expect(loadOrCreateIdentity()).rejects.toThrow('shared native OpenClaw device identity is invalid');
    expect(mocks.secureGet).not.toHaveBeenCalled();
    expect(mocks.getRandomBytes).not.toHaveBeenCalled();
    expect(mocks.sharedSet).not.toHaveBeenCalled();
  });

  it('keeps simulator-local identities independent from shared device authority', async () => {
    mocks.sharedGet.mockResolvedValue('{not-json');
    const identity = await loadOrCreateIdentity(false, false);
    expect(identity.deviceId).toHaveLength(64);
    expect(mocks.sharedGet).not.toHaveBeenCalled();
    expect(mocks.sharedSet).not.toHaveBeenCalled();
  });

  it('expands the native 32-byte Ed25519 seed and reuses its exact device ID', async () => {
    const seed = Uint8Array.from({ length: 32 }, (_, index) => index + 1);
    const pair = nacl.sign.keyPair.fromSeed(seed);
    const digest = Uint8Array.from({ length: 32 }, (_, index) => 255 - index);
    const deviceId = [...digest].map((value) => value.toString(16).padStart(2, '0')).join('');
    mocks.digest.mockResolvedValue(digest.buffer);
    mocks.sharedGet.mockResolvedValue(JSON.stringify({
      deviceId,
      publicKey: fromByteArray(pair.publicKey),
      privateKey: fromByteArray(seed),
      createdAtMs: 123,
    }));

    const identity = await loadOrCreateIdentity(true);

    expect(identity.deviceId).toBe(deviceId);
    expect(toByteArray(identity.privateKey)).toHaveLength(64);
    expect(mocks.secureSet).toHaveBeenCalledOnce();
    expect(mocks.sharedSet).not.toHaveBeenCalled();
    expect(mocks.getRandomBytes).not.toHaveBeenCalled();
  });
});
