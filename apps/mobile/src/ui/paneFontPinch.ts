export const PANE_FONT_PINCH_STEP_RATIO = 1.12;

export function paneFontPinchStep(startDistance: number, currentDistance: number) {
  if (!Number.isFinite(startDistance) || !Number.isFinite(currentDistance) || startDistance <= 0 || currentDistance <= 0) return 0;
  const logarithmicDistance = Math.log(currentDistance / startDistance);
  const direction = Math.sign(logarithmicDistance);
  if (!direction) return 0;
  const magnitude = Math.floor(Math.abs(logarithmicDistance) / Math.log(PANE_FONT_PINCH_STEP_RATIO) + 1e-9);
  return magnitude ? direction * magnitude : 0;
}
