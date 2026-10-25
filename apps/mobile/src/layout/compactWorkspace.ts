import { PROJECT_RAIL_WIDTH } from './projectRailGeometry';

export const COMPACT_WORKSPACE_WIDTH = 700;
export const COMPACT_PHONE_LANDSCAPE_HEIGHT = 500;
export type CompactWorkspaceIdiom = 'phone' | 'pad';

export function usesCompactWorkspace(width: number, height: number) {
  return width < COMPACT_WORKSPACE_WIDTH || height < COMPACT_PHONE_LANDSCAPE_HEIGHT;
}

export function compactProjectDrawerWidth(width: number, idiom: CompactWorkspaceIdiom) {
  // iPad Split View should not make the project surface grow as the scene
  // shrinks. Retain the same rail measure used by the wide workspace; phones
  // keep a modestly broader overlay for touch and project labels, while still
  // leaving enough of the workspace visible to read the drawer as an overlay.
  if (idiom === 'pad') return Math.min(width, PROJECT_RAIL_WIDTH);
  return Math.min(width, Math.min(300, Math.max(264, width * 0.72)));
}
