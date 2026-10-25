import { describe, expect, it } from 'vitest';
import { reactFatalDiagnostic } from './reactFatalDiagnostic';

describe('originating React fatal coordinates', () => {
  const frame = { methodName: 'setter', file: 'https://private.example/private/main.jsbundle?token=secret', lineNumber: 1, column: 123 };
  it('retains only bounded coordinates and the first summary line', () => {
    const result = reactFatalDiagnostic({ isFatal: true, message: 'failure\nPRIVATE PROSE', stack: Array(100).fill(frame), extraData: { rawStack: 'SECRET' } });
    expect(result).toEqual({ summary: 'failure', frames: Array(16).fill('at setter (main.jsbundle:1:123)') });
  });
  it('rejects malformed or nonfatal payloads without inventing locations', () => {
    for (const value of [null, undefined, 'failure', {}, { isFatal: false, message: 'failure', stack: [frame] }]) expect(reactFatalDiagnostic(value)).toBeNull();
    const invalid = [null, {}, { ...frame, column: NaN }, { ...frame, lineNumber: -1 }, { ...frame, column: 1.5 }, { ...frame, column: 1e12 }, { ...frame, methodName: 'bad\nname' }, { ...frame, file: 'bad\nfile.js' }];
    expect(reactFatalDiagnostic({ isFatal: true, message: 'x'.repeat(500), stack: invalid })).toEqual({ summary: 'x'.repeat(220), frames: [] });
  });
});
