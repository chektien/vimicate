import { describe, expect, it } from 'vitest';
import { WORKSPACE_COLUMN_DIVIDER_WIDTH } from './workspaceColumns';
import {
  WORKSPACE_DIVIDER_GRIP_LENGTH,
  WORKSPACE_DIVIDER_GRIP_THICKNESS,
  WORKSPACE_DIVIDER_HIT_SLOP,
  WORKSPACE_DIVIDER_THICKNESS,
} from './workspaceDividerGeometry';
import { WORKSPACE_DIVIDER_HEIGHT } from './workspaceSplit';

describe('workspace divider geometry', () => {
  it('uses the same compact thickness for horizontal and vertical dividers', () => {
    expect(WORKSPACE_DIVIDER_THICKNESS).toBe(10);
    expect(WORKSPACE_COLUMN_DIVIDER_WIDTH).toBe(WORKSPACE_DIVIDER_THICKNESS);
    expect(WORKSPACE_DIVIDER_HEIGHT).toBe(WORKSPACE_DIVIDER_THICKNESS);
  });

  it('keeps a rounded grip and generous drag reach without a redundant full-length rule', () => {
    expect(WORKSPACE_DIVIDER_GRIP_THICKNESS).toBe(4);
    expect(WORKSPACE_DIVIDER_GRIP_LENGTH).toBe(34);
    expect(WORKSPACE_DIVIDER_THICKNESS + WORKSPACE_DIVIDER_HIT_SLOP * 2).toBeGreaterThanOrEqual(24);
  });
});
