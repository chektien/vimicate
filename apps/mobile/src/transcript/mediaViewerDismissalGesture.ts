export type MediaViewerDismissalGestureInput = {
  dx: number;
  dy: number;
  vy: number;
  height: number;
  zoomScale: number;
};

export function mediaViewerDismissalGesture(input: MediaViewerDismissalGestureInput) {
  const height = Math.max(1, input.height);
  const offset = Math.max(0, Math.min(input.dy, height));
  const opacity = Math.max(0.2, 1 - (offset / height) * 0.8);
  const downwardVerticalDrag = input.dy >= 12 && Math.abs(input.dy) > Math.abs(input.dx) * 1.2;
  const claim = input.zoomScale <= 1.01 && downwardVerticalDrag;
  const dismiss = claim && (input.dy >= Math.max(96, height * 0.12) || input.vy >= 1.05);
  return { claim, dismiss, offset, opacity };
}
