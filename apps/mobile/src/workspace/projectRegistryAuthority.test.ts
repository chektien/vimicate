import { describe, expect, it } from 'vitest';
import { resolveProjectRegistryAuthority } from './projectRegistryAuthority';

describe('project registry authority', () => {
  const accepted = { projects: [{ id: 'accepted' }] };
  const refreshed = { projects: [{ id: 'refreshed' }] };

  it('withholds startup authority when the first typed registry read fails', () => {
    expect(resolveProjectRegistryAuthority(null, null)).toEqual({
      snapshot: null,
      ready: false,
    });
  });

  it('retains prior authority when a later refresh fails', () => {
    expect(resolveProjectRegistryAuthority(accepted, null)).toEqual({
      snapshot: accepted,
      ready: true,
    });
  });

  it('promotes a successful typed read as the new authority', () => {
    expect(resolveProjectRegistryAuthority(accepted, refreshed)).toEqual({
      snapshot: refreshed,
      ready: true,
    });
  });
});
