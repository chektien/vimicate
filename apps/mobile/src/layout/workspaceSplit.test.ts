import { describe, expect, it } from 'vitest';
import { clampedPromptHeight, MIN_TRANSCRIPT_HEIGHT, resizedPromptHeight, WORKSPACE_DIVIDER_HEIGHT, workspacePersistenceSizeClass, workspaceSizeClass } from './workspaceSplit';

describe('workspace split geometry', () => {
  it('respects prompt and transcript minimums', () => {
    expect(clampedPromptHeight(40, 900)).toBe(112);
    expect(clampedPromptHeight(800, 900)).toBe(420);
    expect(clampedPromptHeight(420, 300)).toBe(300 - MIN_TRANSCRIPT_HEIGHT - WORKSPACE_DIVIDER_HEIGHT);
  });

  it('resizes by a deterministic keyboard/accessibility step', () => {
    expect(resizedPromptHeight(160, 1, 900)).toBe(184);
    expect(resizedPromptHeight(160, -1, 900)).toBe(136);
  });

  it('stores compact and regular layouts independently', () => {
    expect(workspaceSizeClass(699)).toBe('compact');
    expect(workspaceSizeClass(700)).toBe('regular');
  });

  it('does not switch an iPad split preset while the keyboard reduces available height', () => {
    expect(workspacePersistenceSizeClass(520, 1024)).toBe('regular');
    expect(workspacePersistenceSizeClass(520, 0)).toBe('compact');
  });
});
