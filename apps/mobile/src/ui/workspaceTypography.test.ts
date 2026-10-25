import { describe, expect, it } from 'vitest';
import { adjustedWorkspaceFontScale, workspaceFontMetrics } from './workspaceTypography';

describe('workspace typography scaling', () => {
  it('uses bounded deterministic command-plus and command-minus steps', () => {
    expect(adjustedWorkspaceFontScale(1, 1)).toBe(1.1);
    expect(adjustedWorkspaceFontScale(1, -1)).toBe(0.9);
    expect(adjustedWorkspaceFontScale(1.5, 1)).toBe(1.5);
    expect(adjustedWorkspaceFontScale(0.75, -1)).toBe(0.75);
    // Off-grid values (the 0.75 floor, older saved scales) snap back onto 10% steps.
    expect(adjustedWorkspaceFontScale(0.95, 1)).toBe(1);
    expect(adjustedWorkspaceFontScale(0.95, -1)).toBe(0.9);
    expect(adjustedWorkspaceFontScale(0.75, 1)).toBe(0.8);
    expect(adjustedWorkspaceFontScale(0.88, 1)).toBe(0.9);
    expect(adjustedWorkspaceFontScale(0.8, -1)).toBe(0.75);
    let scale = 1;
    for (let i = 0; i < 6; i += 1) scale = adjustedWorkspaceFontScale(scale, -1);
    for (let i = 0; i < 3; i += 1) scale = adjustedWorkspaceFontScale(scale, 1);
    expect(scale).toBe(1);
  });

  it('scales text and line height from the same workspace authority', () => {
    expect(workspaceFontMetrics(13, 1.2, 20)).toEqual({ fontSize: 15.6, lineHeight: 24 });
    expect(workspaceFontMetrics(11, 0.9)).toEqual({ fontSize: 9.9 });
  });
});
