import { describe, expect, it, vi } from 'vitest';
import { MediaScenePublicationAuthority } from './mediaScenePublicationAuthority';

describe('media scene publication authority', () => {
  it('invalidates foreground image work before inactive publication and retries only after resume', () => {
    const authority = new MediaScenePublicationAuthority(true);
    const resume = vi.fn();
    const unsubscribe = authority.subscribeResume(resume);
    const foreground = authority.capture();

    expect(foreground).not.toBeNull();
    expect(authority.owns(foreground)).toBe(true);
    expect(authority.suspend()).toBe(true);
    expect(authority.owns(foreground)).toBe(false);
    expect(resume).not.toHaveBeenCalled();
    expect(authority.suspend()).toBe(false);

    expect(authority.resume()).toBe(true);
    expect(resume).toHaveBeenCalledTimes(1);
    expect(authority.resume()).toBe(false);
    expect(resume).toHaveBeenCalledTimes(1);
    expect(authority.owns(authority.capture())).toBe(true);

    unsubscribe();
    authority.suspend(); authority.resume();
    expect(resume).toHaveBeenCalledTimes(1);
  });

  it('does not grant a publication revision while the scene is inactive', () => {
    const authority = new MediaScenePublicationAuthority(false);
    expect(authority.capture()).toBeNull();
    expect(authority.owns(null)).toBe(false);
    authority.resume();
    const active = authority.capture();
    expect(active).not.toBeNull();
    authority.suspend();
    expect(authority.owns(active)).toBe(false);
  });
});
