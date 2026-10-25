import { describe, expect, it } from 'vitest';
import { tintForWorkspaceGroup, workspaceGroupTintMap, workspaceGroupTintPalette } from './workspaceGroupTint';

describe('workspace semantic group tinting', () => {
  it('matches native sorted distinct tint assignment without hash collisions', () => {
    const map = workspaceGroupTintMap(['work', 'home', 'research', ' Home ']);
    expect([...map]).toEqual([
      ['home', workspaceGroupTintPalette[0]],
      ['research', workspaceGroupTintPalette[1]],
      ['work', workspaceGroupTintPalette[2]],
    ]);
    expect(tintForWorkspaceGroup('HOME', map)).toBe(workspaceGroupTintPalette[0]);
  });
});
