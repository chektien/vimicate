import { describe, expect, it } from 'vitest';
import { hardwareTextCharacter, normalizedHardwareKey } from './hardwareKey';

describe('hardware key normalization', () => {
  it('normalizes letters and shifted punctuation from UIKit modifier facts', () => {
    expect(normalizedHardwareKey({ key: 'v', shift: true })).toBe('V');
    expect(normalizedHardwareKey({ key: '6', shift: true })).toBe('^');
    expect(normalizedHardwareKey({ key: '4', shift: true })).toBe('$');
    expect(normalizedHardwareKey({ key: ';', shift: true })).toBe(':');
    expect(hardwareTextCharacter({ key: '/', shift: true })).toBe('?');
  });

  it('does not turn named keys into text', () => {
    expect(normalizedHardwareKey({ key: 'escape', shift: true })).toBe('escape');
    expect(hardwareTextCharacter({ key: 'backspace', shift: false })).toBe('');
  });
});
