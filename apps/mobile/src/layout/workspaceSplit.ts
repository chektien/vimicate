import { WORKSPACE_DIVIDER_THICKNESS } from './workspaceDividerGeometry';

export const DEFAULT_PROMPT_HEIGHT = 160;
export const MIN_PROMPT_HEIGHT = 112;
export const MAX_PROMPT_HEIGHT = 420;
export const MIN_TRANSCRIPT_HEIGHT = 150;
export const WORKSPACE_DIVIDER_HEIGHT = WORKSPACE_DIVIDER_THICKNESS;
export const KEYBOARD_SPLIT_STEP = 24;

export function workspaceSizeClass(availableHeight: number) {
  return availableHeight < 700 ? 'compact' : 'regular';
}

export function workspacePersistenceSizeClass(availableHeight: number, stableViewportHeight: number) {
  return workspaceSizeClass(stableViewportHeight > 0 ? stableViewportHeight : availableHeight);
}

export function clampedPromptHeight(requestedHeight: number, availableHeight: number) {
  const availableMaximum = Math.max(MIN_PROMPT_HEIGHT, availableHeight - MIN_TRANSCRIPT_HEIGHT - WORKSPACE_DIVIDER_HEIGHT);
  return Math.max(MIN_PROMPT_HEIGHT, Math.min(MAX_PROMPT_HEIGHT, availableMaximum, requestedHeight));
}

export function resizedPromptHeight(currentHeight: number, direction: 1 | -1, availableHeight: number) {
  return clampedPromptHeight(currentHeight + direction * KEYBOARD_SPLIT_STEP, availableHeight);
}
