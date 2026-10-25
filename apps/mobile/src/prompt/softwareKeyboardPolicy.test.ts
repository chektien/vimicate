import { describe, expect, it } from 'vitest';
import { promptSoftwareKeyboardEnabled, promptTouchRequestsSoftwareKeyboard } from './softwareKeyboardPolicy';

describe('prompt software keyboard policy', () => {
  it('requires explicit request, prompt focus, and insert mode', () => {
    expect(promptSoftwareKeyboardEnabled(true, true, 'insert')).toBe(true);
    expect(promptSoftwareKeyboardEnabled(false, true, 'insert')).toBe(false);
    expect(promptSoftwareKeyboardEnabled(true, false, 'insert')).toBe(false);
    expect(promptSoftwareKeyboardEnabled(true, true, 'normal')).toBe(false);
  });

  it('does not force the software keyboard from a prompt tap when hardware is connected', () => {
    expect(promptTouchRequestsSoftwareKeyboard(true)).toBe(false);
    expect(promptTouchRequestsSoftwareKeyboard(false)).toBe(true);
  });
});
