import { MAX_WORKSPACE_FONT_SCALE, MIN_WORKSPACE_FONT_SCALE } from '../ui/workspaceTypography';

export const DEFAULT_PROJECT_FILES_LIST_RATIO = 0.3;
export const MIN_PROJECT_FILES_LIST_RATIO = 0.1;
export const MAX_PROJECT_FILES_LIST_RATIO = 0.8;
export const MIN_PROJECT_FILES_LIST_HEIGHT = 96;
export const MIN_PROJECT_FILES_PREVIEW_HEIGHT = 120;
export const PROJECT_FILES_DIVIDER_HEIGHT = 18;
export const PROJECT_FILES_SPLIT_STEP = 24;
export const PROJECT_FILES_DIRECTORY_ROW_HEIGHT = 32;

export type ProjectFilesSplitGeometry = {
  dividerHeight: number;
  listHeight: number;
  previewHeight: number;
};

function bounded(value: number, minimum: number, maximum: number) {
  if (!Number.isFinite(value)) return minimum;
  return Math.max(minimum, Math.min(maximum, value));
}

export function boundedProjectFilesListRatio(value: number) {
  return bounded(value, MIN_PROJECT_FILES_LIST_RATIO, MAX_PROJECT_FILES_LIST_RATIO);
}

/**
 * Preserves a viewport-relative preference while guaranteeing both useful
 * regions whenever they fit. Very short scenes share the remaining height in
 * proportion to the two minima rather than overcommitting the pane.
 */
export function projectFilesSplitGeometry(availableHeight: number, preferredListRatio: number): ProjectFilesSplitGeometry {
  const height = Number.isFinite(availableHeight) ? Math.max(0, availableHeight) : 0;
  const dividerHeight = Math.min(height, PROJECT_FILES_DIVIDER_HEIGHT);
  const contentHeight = Math.max(0, height - dividerHeight);
  const minimumTotal = MIN_PROJECT_FILES_LIST_HEIGHT + MIN_PROJECT_FILES_PREVIEW_HEIGHT;
  if (contentHeight < minimumTotal) {
    const listHeight = contentHeight * (MIN_PROJECT_FILES_LIST_HEIGHT / minimumTotal);
    return { dividerHeight, listHeight, previewHeight: contentHeight - listHeight };
  }
  const requestedListHeight = contentHeight * boundedProjectFilesListRatio(preferredListRatio);
  const listHeight = bounded(requestedListHeight, MIN_PROJECT_FILES_LIST_HEIGHT, contentHeight - MIN_PROJECT_FILES_PREVIEW_HEIGHT);
  return { dividerHeight, listHeight, previewHeight: contentHeight - listHeight };
}

export function projectFilesListRatioForHeight(requestedListHeight: number, availableHeight: number, currentPreferredRatio?: number) {
  const height = Number.isFinite(availableHeight) ? Math.max(0, availableHeight) : 0;
  const contentHeight = Math.max(0, height - Math.min(height, PROJECT_FILES_DIVIDER_HEIGHT));
  if (!contentHeight) return DEFAULT_PROJECT_FILES_LIST_RATIO;
  const requestedRatio = requestedListHeight / contentHeight;
  const geometry = projectFilesSplitGeometry(height, requestedRatio);
  if (currentPreferredRatio !== undefined) {
    const current = projectFilesSplitGeometry(height, currentPreferredRatio);
    const pushingAgainstClamp = (requestedListHeight > current.listHeight && geometry.listHeight <= current.listHeight)
      || (requestedListHeight < current.listHeight && geometry.listHeight >= current.listHeight);
    if (pushingAgainstClamp) return boundedProjectFilesListRatio(currentPreferredRatio);
  }
  return boundedProjectFilesListRatio(geometry.listHeight / contentHeight);
}

export function resizedProjectFilesListRatio(currentRatio: number, direction: 1 | -1, availableHeight: number) {
  const current = projectFilesSplitGeometry(availableHeight, currentRatio);
  return projectFilesListRatioForHeight(current.listHeight + direction * PROJECT_FILES_SPLIT_STEP, availableHeight, currentRatio);
}

export function parsedProjectFilesListRatio(serialized: string | null) {
  if (!serialized) return null;
  try {
    const value = JSON.parse(serialized) as { listRatio?: unknown };
    return typeof value?.listRatio === 'number' && Number.isFinite(value.listRatio)
      ? boundedProjectFilesListRatio(value.listRatio)
      : null;
  } catch {
    return null;
  }
}

export function serializedProjectFilesListRatio(listRatio: number) {
  return JSON.stringify({ listRatio: boundedProjectFilesListRatio(listRatio) });
}

export function projectFilesDirectoryRowHeight(fontScale: number) {
  const scale = bounded(fontScale, MIN_WORKSPACE_FONT_SCALE, MAX_WORKSPACE_FONT_SCALE);
  return PROJECT_FILES_DIRECTORY_ROW_HEIGHT * scale;
}
