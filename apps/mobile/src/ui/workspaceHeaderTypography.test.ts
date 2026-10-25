import { describe, expect, it } from 'vitest';
import { WORKSPACE_HEADER_IDENTITY_COMPACT_FONT_SIZE, WORKSPACE_HEADER_IDENTITY_FONT_SIZE } from './workspaceHeaderTypography';

describe('workspace header identity typography', () => {
  it('keeps the top-right model and run context legible at every width', () => {
    expect(WORKSPACE_HEADER_IDENTITY_FONT_SIZE).toBeGreaterThanOrEqual(12);
    expect(WORKSPACE_HEADER_IDENTITY_COMPACT_FONT_SIZE).toBeGreaterThanOrEqual(11);
    expect(WORKSPACE_HEADER_IDENTITY_COMPACT_FONT_SIZE).toBeLessThanOrEqual(WORKSPACE_HEADER_IDENTITY_FONT_SIZE);
  });
});
