import { describe, expect, it } from 'vitest';
import { textObjectRange } from './vimTextObjects';

describe('shared Vim text objects', () => {
  it('finds inside and around words', () => {
    expect(textObjectRange('one two', 1, 'w', false)).toEqual({ start: 0, end: 2 });
    expect(textObjectRange('one two', 1, 'w', true)).toEqual({ start: 0, end: 3 });
  });

  it('finds nested delimiters and quotes', () => {
    expect(textObjectRange('a [b [c] d] e', 6, '[', false)).toEqual({ start: 6, end: 6 });
    expect(textObjectRange('say "hello" now', 6, '"', true)).toEqual({ start: 4, end: 10 });
  });
});
