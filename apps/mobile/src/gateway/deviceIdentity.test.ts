import { describe, expect, it, vi } from 'vitest';
import { deviceIDForPublicKeyWithDigest } from './deviceIdentityDigest';

describe('OpenClaw device identity digest boundary', () => {
  it('passes a Uint8Array to the native digest bridge and returns lowercase SHA-256 hex', async () => {
    const digest = vi.fn(async (_algorithm: string, data: Uint8Array) => {
      expect(data).toBeInstanceOf(Uint8Array);
      expect([...data]).toEqual([1, 2, 3]);
      return new Uint8Array([0, 1, 15, 16, 255]).buffer;
    });

    await expect(deviceIDForPublicKeyWithDigest(new Uint8Array([1, 2, 3]), 'SHA-256', digest)).resolves.toBe('00010f10ff');
    expect(digest).toHaveBeenCalledWith('SHA-256', expect.any(Uint8Array));
  });
});
