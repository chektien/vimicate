import { describe, expect, it } from 'vitest';
import { isHiddenWorkspaceSession } from './workspaceSessionVisibility';

describe('workspace session visibility', () => {
  it('filters exact control-plane and debug-smoke sessions before project adoption', () => {
    expect(isHiddenWorkspaceSession('agent:main:dashboard:one', 'Vimicate control A91F')).toBe(true);
    expect(isHiddenWorkspaceSession('agent:main:vimicate-control:one', 'renamed')).toBe(true);
    expect(isHiddenWorkspaceSession('agent:thread:visible-background-run-smoke', 'Visible background run')).toBe(true);
  });

  it('does not hide ordinary similarly worded user threads', () => {
    expect(isHiddenWorkspaceSession('agent:main:dashboard:one', 'control systems review')).toBe(false);
    expect(isHiddenWorkspaceSession('agent:main:dashboard:two', 'Vimicate controller design')).toBe(false);
  });
});
