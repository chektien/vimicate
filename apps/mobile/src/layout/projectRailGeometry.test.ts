import { describe, expect, it } from 'vitest';
// @ts-expect-error Vitest's Node runtime provides this test-only module.
import { readFileSync } from 'node:fs';
import {
  PROJECT_CARD_LEFT_INSET,
  PROJECT_RAIL_LIST_LEFT_INSET,
  PROJECT_RAIL_WIDTH,
  projectCardRightInset,
  projectRailPinchSurfaceStyle,
} from './projectRailGeometry';

describe('project rail pinch surface geometry', () => {
  it('owns only the fixed rail width in the wide workspace', () => {
    expect(PROJECT_RAIL_WIDTH).toBe(224);
    expect(projectRailPinchSurfaceStyle(false)).toEqual({ flex: 0, width: PROJECT_RAIL_WIDTH, height: '100%', minHeight: 0, overflow: 'hidden' });
  });

  it('keeps card side insets compact so width is spent on project names', () => {
    expect(PROJECT_RAIL_LIST_LEFT_INSET).toBe(4);
    expect(PROJECT_CARD_LEFT_INSET).toBe(2);
    expect(projectCardRightInset(false)).toBe(3);
  });

  it('gives starless child cards a readable trailing inset in either sort mode', () => {
    expect(projectCardRightInset(true)).toBe(8);
  });

  it('applies the card-kind inset once at the shared select-content boundary', () => {
    const source = readFileSync(new URL('../workspace/ProjectRail.tsx', import.meta.url), 'utf8');
    expect(source).toContain("paddingRight: projectCardRightInset(project.kind === 'thread')");
    expect(source).not.toContain('paddingRight: PROJECT_CARD_RIGHT_INSET');
  });

  it('fills the compact project drawer without competing with the workspace', () => {
    expect(projectRailPinchSurfaceStyle(true)).toEqual({ flex: 1, width: '100%', minHeight: 0, overflow: 'hidden' });
  });
});
