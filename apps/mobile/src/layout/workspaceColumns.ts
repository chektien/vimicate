import { WORKSPACE_DIVIDER_THICKNESS } from './workspaceDividerGeometry';

export const WORKSPACE_COLUMN_DIVIDER_WIDTH = WORKSPACE_DIVIDER_THICKNESS;
export const MIN_CONVERSATION_COLUMN_WIDTH = 300;
export const MIN_PROJECTS_COLUMN_WIDTH = 160;
export const MAX_PROJECTS_COLUMN_WIDTH = 600;
export const DEFAULT_PROJECTS_COLUMN_WIDTH = 224;
export const MIN_FILES_COLUMN_WIDTH = 240;
export const DEFAULT_MAX_FILES_COLUMN_WIDTH = 430;
export const MAX_FILES_COLUMN_WIDTH = 1200;
export const DEFAULT_FILES_COLUMN_FRACTION = 0.36;
export const WORKSPACE_COLUMN_RESIZE_STEP = 24;

export type WorkspaceColumnPreferences = {
  projects: number;
  files: number;
};

export type WorkspaceColumnGeometry = {
  projectsWidth: number;
  conversationWidth: number;
  filesWidth: number;
};

type WorkspaceColumnGeometryInput = {
  width: number;
  projectsVisible: boolean;
  filesVisible: boolean;
  preferredProjectsWidth: number;
  preferredFilesWidth: number;
};

function bounded(value: number, minimum: number, maximum: number) {
  if (!Number.isFinite(value)) return minimum;
  return Math.max(minimum, Math.min(maximum, value));
}

export function defaultWorkspaceColumnPreferences(width: number): WorkspaceColumnPreferences {
  const safeWidth = Number.isFinite(width) ? Math.max(0, width) : 0;
  return {
    projects: DEFAULT_PROJECTS_COLUMN_WIDTH,
    files: bounded(safeWidth * DEFAULT_FILES_COLUMN_FRACTION, MIN_FILES_COLUMN_WIDTH, DEFAULT_MAX_FILES_COLUMN_WIDTH),
  };
}

export function boundedWorkspaceColumnPreferences(value: Partial<WorkspaceColumnPreferences>): WorkspaceColumnPreferences {
  return {
    projects: bounded(value.projects ?? DEFAULT_PROJECTS_COLUMN_WIDTH, MIN_PROJECTS_COLUMN_WIDTH, MAX_PROJECTS_COLUMN_WIDTH),
    files: bounded(value.files ?? MIN_FILES_COLUMN_WIDTH, MIN_FILES_COLUMN_WIDTH, MAX_FILES_COLUMN_WIDTH),
  };
}

export function parsedWorkspaceColumnPreferences(serialized: string | null): Partial<WorkspaceColumnPreferences> | null {
  if (!serialized) return null;
  try {
    const value = JSON.parse(serialized) as { projects?: unknown; files?: unknown };
    if (!value || typeof value !== 'object') return null;
    const restored: Partial<WorkspaceColumnPreferences> = {};
    if (typeof value.projects === 'number' && Number.isFinite(value.projects)) {
      restored.projects = bounded(value.projects, MIN_PROJECTS_COLUMN_WIDTH, MAX_PROJECTS_COLUMN_WIDTH);
    }
    if (typeof value.files === 'number' && Number.isFinite(value.files)) {
      restored.files = bounded(value.files, MIN_FILES_COLUMN_WIDTH, MAX_FILES_COLUMN_WIDTH);
    }
    return restored.projects === undefined && restored.files === undefined ? null : restored;
  } catch {
    return null;
  }
}

export function serializedWorkspaceColumnPreferences(preferences: WorkspaceColumnPreferences) {
  return JSON.stringify(boundedWorkspaceColumnPreferences(preferences));
}

/**
 * Resolves side-column preferences without ever spending the conversation's
 * protected width. On scenes too narrow even for both side minima, the side
 * columns share the remaining space proportionally instead of overcommitting.
 */
export function workspaceColumnWidths(input: WorkspaceColumnGeometryInput): WorkspaceColumnGeometry {
  const width = Number.isFinite(input.width) ? Math.max(0, input.width) : 0;
  const visibleCount = Number(input.projectsVisible) + Number(input.filesVisible);
  const dividerWidth = Math.min(width, visibleCount * WORKSPACE_COLUMN_DIVIDER_WIDTH);
  const sideCapacity = Math.max(0, width - dividerWidth - Math.min(MIN_CONVERSATION_COLUMN_WIDTH, width - dividerWidth));
  const preferred = boundedWorkspaceColumnPreferences({
    projects: input.preferredProjectsWidth,
    files: input.preferredFilesWidth,
  });

  let projectsWidth = input.projectsVisible ? preferred.projects : 0;
  let filesWidth = input.filesVisible ? preferred.files : 0;
  const requested = projectsWidth + filesWidth;

  if (requested > sideCapacity && input.projectsVisible && input.filesVisible) {
    const minimumTotal = MIN_PROJECTS_COLUMN_WIDTH + MIN_FILES_COLUMN_WIDTH;
    if (sideCapacity < minimumTotal) {
      projectsWidth = sideCapacity * (MIN_PROJECTS_COLUMN_WIDTH / minimumTotal);
      filesWidth = sideCapacity - projectsWidth;
    } else {
      const excess = requested - sideCapacity;
      const projectsFlex = Math.max(0, projectsWidth - MIN_PROJECTS_COLUMN_WIDTH);
      const filesFlex = Math.max(0, filesWidth - MIN_FILES_COLUMN_WIDTH);
      const flex = projectsFlex + filesFlex;
      projectsWidth -= flex ? excess * (projectsFlex / flex) : 0;
      filesWidth = sideCapacity - projectsWidth;
    }
  } else if (requested > sideCapacity && input.projectsVisible) {
    projectsWidth = sideCapacity;
  } else if (requested > sideCapacity && input.filesVisible) {
    filesWidth = sideCapacity;
  }

  const conversationWidth = Math.max(0, width - dividerWidth - projectsWidth - filesWidth);
  return { projectsWidth, conversationWidth, filesWidth };
}

export function resizedWorkspaceColumnWidth(width: number, direction: 1 | -1) {
  return width + direction * WORKSPACE_COLUMN_RESIZE_STEP;
}

type WorkspaceColumnResizeInput = WorkspaceColumnGeometryInput & {
  geometry: WorkspaceColumnGeometry;
  side: 'projects' | 'files';
  requestedWidth: number;
};

/** Holds the opposite visible side at its rendered width while resizing. */
export function resizedWorkspaceColumnPreferences(input: WorkspaceColumnResizeInput): WorkspaceColumnPreferences {
  const current = boundedWorkspaceColumnPreferences({
    projects: input.preferredProjectsWidth,
    files: input.preferredFilesWidth,
  });
  const visible = input.side === 'projects' ? input.projectsVisible : input.filesVisible;
  if (!visible) return current;

  const next = { ...current };
  if (input.projectsVisible) next.projects = Math.max(MIN_PROJECTS_COLUMN_WIDTH, input.geometry.projectsWidth);
  if (input.filesVisible) next.files = Math.max(MIN_FILES_COLUMN_WIDTH, input.geometry.filesWidth);

  const width = Number.isFinite(input.width) ? Math.max(0, input.width) : 0;
  const visibleCount = Number(input.projectsVisible) + Number(input.filesVisible);
  const dividers = Math.min(width, visibleCount * WORKSPACE_COLUMN_DIVIDER_WIDTH);
  const center = Math.min(MIN_CONVERSATION_COLUMN_WIDTH, Math.max(0, width - dividers));
  const rendered = input.side === 'projects' ? input.geometry.projectsWidth : input.geometry.filesWidth;
  const opposite = input.side === 'projects' ? input.geometry.filesWidth : input.geometry.projectsWidth;
  const minimum = Math.min(input.side === 'projects' ? MIN_PROJECTS_COLUMN_WIDTH : MIN_FILES_COLUMN_WIDTH, rendered);
  const preferredMaximum = input.side === 'projects' ? MAX_PROJECTS_COLUMN_WIDTH : MAX_FILES_COLUMN_WIDTH;
  const maximum = Math.max(minimum, Math.min(preferredMaximum, width - dividers - center - opposite));
  next[input.side] = bounded(input.requestedWidth, minimum, maximum);
  return next;
}
