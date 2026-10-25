import type { WorkspaceFocus } from '../workspace/focusRouting';
import { adjustedWorkspaceFontScale, DEFAULT_WORKSPACE_FONT_SCALE, MAX_WORKSPACE_FONT_SCALE, MIN_WORKSPACE_FONT_SCALE } from './workspaceTypography';

export type PaneFontTarget = WorkspaceFocus | 'filesList' | 'filesPreview';
export type PaneFontScales = Record<PaneFontTarget, number>;

export const MAX_PROJECT_FONT_SCALE = 2;

export const DEFAULT_PANE_FONT_SCALES: PaneFontScales = {
  projects: DEFAULT_WORKSPACE_FONT_SCALE,
  transcript: DEFAULT_WORKSPACE_FONT_SCALE,
  prompt: adjustedWorkspaceFontScale(DEFAULT_WORKSPACE_FONT_SCALE, -1),
  filesList: DEFAULT_WORKSPACE_FONT_SCALE,
  filesPreview: 0.9,
};

export function adjustedPaneFontScales(current: PaneFontScales, pane: PaneFontTarget, direction: 1 | -1) {
  return { ...current, [pane]: adjustedWorkspaceFontScale(current[pane], direction, pane === 'projects' ? MAX_PROJECT_FONT_SCALE : MAX_WORKSPACE_FONT_SCALE) };
}

export function parsedPaneFontScales(value: string | null): PaneFontScales {
  if (!value) return DEFAULT_PANE_FONT_SCALES;
  try {
    const parsed = JSON.parse(value) as Partial<Record<PaneFontTarget, unknown>>;
    return {
      projects: validScale(parsed.projects, DEFAULT_PANE_FONT_SCALES.projects, MAX_PROJECT_FONT_SCALE),
      transcript: validScale(parsed.transcript, DEFAULT_PANE_FONT_SCALES.transcript),
      prompt: validScale(parsed.prompt, DEFAULT_PANE_FONT_SCALES.prompt),
      filesList: validScale(parsed.filesList, DEFAULT_PANE_FONT_SCALES.filesList),
      filesPreview: validScale(parsed.filesPreview, DEFAULT_PANE_FONT_SCALES.filesPreview),
    };
  } catch {
    return DEFAULT_PANE_FONT_SCALES;
  }
}

function validScale(value: unknown, fallback: number, maximum = MAX_WORKSPACE_FONT_SCALE) {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(MIN_WORKSPACE_FONT_SCALE, Math.min(maximum, value))
    : fallback;
}
