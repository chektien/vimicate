import { describe, expect, it } from 'vitest';
import { HistoryPublicationAuthority } from './historyPublicationAuthority';

describe('history publication scene authority', () => {
  it('invalidates foreground requests at suspension and admits new work only after resume', () => {
    const authority = new HistoryPublicationAuthority(true);
    const foreground = authority.capture();
    const signal = authority.signal;

    expect(authority.owns(foreground)).toBe(true);
    expect(signal.aborted).toBe(false);
    expect(authority.suspend()).toBe(true);
    expect(signal.aborted).toBe(true);
    expect(authority.owns(foreground)).toBe(false);
    expect(authority.suspend()).toBe(false);

    authority.resume();
    expect(authority.signal).not.toBe(signal);
    expect(authority.signal.aborted).toBe(false);
    const resumed = authority.signal; authority.resume();
    expect(authority.signal).toBe(resumed);
    expect(authority.owns(foreground)).toBe(false);
    expect(authority.owns(authority.capture())).toBe(true);
  });

  it('starts inactive with no claimable cancellation scope, then admits a fresh scope on resume', () => {
    const authority = new HistoryPublicationAuthority(false); const initial = authority.signal;
    expect(initial.aborted).toBe(true);
    authority.suspend(); expect(authority.signal).toBe(initial);
    authority.resume(); expect(authority.signal.aborted).toBe(false);
    expect(authority.signal).not.toBe(initial);
  });
});
