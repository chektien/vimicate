import { describe, expect, it } from 'vitest';
import { nativeBuildIdentity, runtimeUpdateIdentity } from './nativeBuildIdentity';

describe('native build accessibility identity', () => {
  it('exposes the exact installed executable version without changing visible chrome', () => {
    expect(nativeBuildIdentity('0.1.1', '202608280005')).toBe('Vimicate 0.1.1 build 202608280005');
    expect(nativeBuildIdentity(null, '')).toBe('Vimicate unknown build unknown');
  });

  it('distinguishes the exact running OTA from the embedded fallback', () => {
    expect(runtimeUpdateIdentity('01a048ee-3a99-7289-a0c0-9cf654562f22', false)).toBe('Vimicate OTA 01a048ee-3a99-7289-a0c0-9cf654562f22');
    expect(runtimeUpdateIdentity(null, true)).toBe('Vimicate OTA embedded unknown');
  });
});
