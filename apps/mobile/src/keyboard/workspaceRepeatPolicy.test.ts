import { describe, expect, it } from 'vitest';
import { isWorkspaceNavigationKey, shouldAcceptSynthesizedRepeat } from './workspaceRepeatPolicy';

const repeat = (key: string) => ({ key, shift: false, control: false, option: false, command: false, isRepeat: true });

describe('workspace repeat policy', () => {
  it('coalesces only physical workspace navigation motions', () => {
    expect(isWorkspaceNavigationKey(repeat('j'))).toBe(true);
    expect(isWorkspaceNavigationKey({ ...repeat('j'), control: true })).toBe(false);
    expect(shouldAcceptSynthesizedRepeat(repeat('v'), 'transcript', '', false)).toBe(false);
  });

  it('does not stack a held prompt operator but preserves query text repeat', () => {
    expect(shouldAcceptSynthesizedRepeat(repeat('d'), 'prompt', 'd', false)).toBe(false);
    expect(shouldAcceptSynthesizedRepeat(repeat('x'), 'prompt', '', false)).toBe(true);
    expect(shouldAcceptSynthesizedRepeat(repeat('v'), 'prompt', '', false)).toBe(false);
    expect(shouldAcceptSynthesizedRepeat(repeat('i'), 'prompt', '', false)).toBe(false);
    expect(shouldAcceptSynthesizedRepeat(repeat('w'), 'prompt', '', false)).toBe(true);
    expect(shouldAcceptSynthesizedRepeat(repeat('v'), 'transcript', '', true)).toBe(true);
  });

  it('admits held Normal-mode undo without widening pending operators or shortcuts', () => {
    expect(shouldAcceptSynthesizedRepeat(repeat('u'), 'prompt', '', false)).toBe(true);
    expect(shouldAcceptSynthesizedRepeat({ ...repeat('u'), command: true }, 'prompt', '', false)).toBe(false);
    expect(shouldAcceptSynthesizedRepeat(repeat('u'), 'prompt', 'd', false)).toBe(false);
    expect(shouldAcceptSynthesizedRepeat(repeat('u'), 'transcript', '', false)).toBe(false);
  });

  it('lets the focused files pane own repeated navigation independently of a prompt operator', () => {
    expect(shouldAcceptSynthesizedRepeat(repeat('j'), 'files', 'd', false)).toBe(true);
  });
});

it.each(['w', 'b', 'e', 'W', 'B', 'E', 'n', 'N', '^', '$'])('admits held transcript motion %s and coalesces it', key => {
  expect(shouldAcceptSynthesizedRepeat(repeat(key), 'transcript', '', false)).toBe(true);
  expect(isWorkspaceNavigationKey(repeat(key))).toBe(true);
});

it('normalizes shifted word motions and rejects modified shortcuts and pending operators', () => {
  for (const key of ['w', 'b', 'e', 'n']) {
    const shifted = { ...repeat(key), shift: true };
    expect(shouldAcceptSynthesizedRepeat(shifted, 'transcript', '', false)).toBe(true);
    expect(shouldAcceptSynthesizedRepeat(shifted, 'prompt', '', false)).toBe(true);
    for (const modifier of ['control', 'command', 'option']) {
      expect(shouldAcceptSynthesizedRepeat({ ...shifted, [modifier]: true }, 'transcript', '', false)).toBe(false);
    }
    for (const pending of ['y', 'g', 'yi', 'z', '[', ']']) {
      expect(shouldAcceptSynthesizedRepeat(shifted, 'transcript', pending, false)).toBe(false);
    }
  }
});

it('keeps operators, counts, mode changes and text motions out of list navigation', () => {
  for (const key of ['d', 'c', 'y', 'g', 'z', 'v', 'i', 'a', 'p', 'enter', '0', '2']) {
    expect(shouldAcceptSynthesizedRepeat(repeat(key), 'transcript', '', false)).toBe(false);
  }
  for (const pane of ['files', 'projects'] as const) {
    expect(shouldAcceptSynthesizedRepeat(repeat('w'), pane, '', false)).toBe(false);
    expect(shouldAcceptSynthesizedRepeat(repeat('b'), pane, '', false)).toBe(false);
    expect(shouldAcceptSynthesizedRepeat(repeat('n'), pane, '', false)).toBe(true);
  }
});
