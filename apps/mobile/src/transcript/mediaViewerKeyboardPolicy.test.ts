import { describe, expect, it } from 'vitest';
import { mediaViewerKeyDisposition } from './mediaViewerKeyboardPolicy';

const key = (value: string, control = false) => ({ key: value, shift: false, control, option: false, command: false });

describe('media viewer keyboard ownership', () => {
  it('lets the workspace own keys while the viewer is closed', () => {
    expect(mediaViewerKeyDisposition(false, key('j'))).toBe('pass');
  });

  it('closes on both Vim escape forms and blocks other keys from editing the obscured prompt', () => {
    expect(mediaViewerKeyDisposition(true, key('escape'))).toBe('close');
    expect(mediaViewerKeyDisposition(true, key('[', true))).toBe('close');
    expect(mediaViewerKeyDisposition(true, key('x'))).toBe('block');
  });
});
