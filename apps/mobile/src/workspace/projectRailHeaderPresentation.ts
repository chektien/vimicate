import { colors } from '../theme/tokens';

export const PROJECT_RAIL_HEADER_ICON_SIZES = {
  sort: 19,
  refresh: 22,
  close: 21,
} as const;

export function projectSortIconColor(sortMode: 'manual' | 'activity') {
  return sortMode === 'activity' ? colors.activeAccent : colors.inkMuted;
}
