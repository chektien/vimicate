import { describe, expect, it } from 'vitest';
import { colors } from '../theme/tokens';
import { PROJECT_RAIL_HEADER_ICON_SIZES, projectSortIconColor } from './projectRailHeaderPresentation';

describe('project rail header presentation', () => {
  it('communicates sort state only through grey and neon-green line color', () => {
    expect(projectSortIconColor('manual')).toBe(colors.inkMuted);
    expect(projectSortIconColor('activity')).toBe(colors.activeAccent);
  });

  it('keeps the compact controls while making their glyphs more legible', () => {
    expect(PROJECT_RAIL_HEADER_ICON_SIZES).toEqual({ sort: 19, refresh: 22, close: 21 });
  });
});
