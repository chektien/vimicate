export type ProjectRailVisibleRange = { first: number; last: number } | null;

export function shouldRevealProjectIndex(index: number, visible: ProjectRailVisibleRange) {
  if (!visible) return true;
  return index < visible.first + 1 || index > visible.last - 1;
}

export function projectRevealPosition(index: number, visible: ProjectRailVisibleRange) {
  if (!visible) return 0.5;
  return index < visible.first ? 0.12 : 0.82;
}
