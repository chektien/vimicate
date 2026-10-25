export const DEFAULT_WORKSPACE_FONT_SCALE = 1;
export const MIN_WORKSPACE_FONT_SCALE = 0.75;
export const MAX_WORKSPACE_FONT_SCALE = 1.5;
export const WORKSPACE_FONT_SCALE_STEP = 0.1;

export function adjustedWorkspaceFontScale(current: number, direction: 1 | -1) {
  // Step to the next multiple of the step, not current ± step. The 0.75 floor
  // and older saved values are off-grid, and adding 0.1 to them would never
  // return to 100% (0.75 → 0.85 → 0.95 → 1.05).
  const steps = current / WORKSPACE_FONT_SCALE_STEP;
  const next = direction > 0 ? Math.floor(steps + 1e-6) + 1 : Math.ceil(steps - 1e-6) - 1;
  const adjusted = Math.round(next * WORKSPACE_FONT_SCALE_STEP * 100) / 100;
  return Math.max(MIN_WORKSPACE_FONT_SCALE, Math.min(MAX_WORKSPACE_FONT_SCALE, adjusted));
}

export function workspaceFontMetrics(fontSize: number, scale: number, lineHeight?: number) {
  return {
    fontSize: fontSize * scale,
    ...(lineHeight === undefined ? {} : { lineHeight: lineHeight * scale }),
  };
}
