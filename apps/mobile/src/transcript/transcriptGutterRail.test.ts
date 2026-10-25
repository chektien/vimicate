import { describe, expect, it } from 'vitest';
import { transcriptGutterRailKind } from './transcriptGutterRail';

describe('transcript gutter rail', () => {
  it('renders one active rail instead of stacking it beside prompt chrome', () => {
    expect(transcriptGutterRailKind({ focused: true, current: true, authoredPrompt: true, grouped: false })).toBe('active');
  });

  it('retains semantic rails when the Vim cursor is elsewhere', () => {
    expect(transcriptGutterRailKind({ focused: true, current: false, authoredPrompt: true, grouped: false })).toBe('authored');
    expect(transcriptGutterRailKind({ focused: false, current: false, authoredPrompt: false, grouped: true })).toBe('grouped');
    expect(transcriptGutterRailKind({ focused: false, current: false, authoredPrompt: false, grouped: false })).toBe('none');
  });
});
