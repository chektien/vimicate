export const workspaceGroupTintPalette = ['#8fbf7d', '#73a3c7', '#d4879c', '#66bdaa', '#b39ee0', '#e07880'] as const;

export function workspaceGroupTintMap(groups: readonly string[]) {
  const ordered = [...new Set(groups.map(normalizedGroup).filter(Boolean))].sort();
  return new Map(ordered.map((group, index) => [group, workspaceGroupTintPalette[index % workspaceGroupTintPalette.length]!]));
}

export function tintForWorkspaceGroup(group: string, tintMap: ReadonlyMap<string, string>) {
  return tintMap.get(normalizedGroup(group)) ?? workspaceGroupTintPalette[0];
}

function normalizedGroup(group: string) { return group.trim().toLocaleLowerCase(); }
