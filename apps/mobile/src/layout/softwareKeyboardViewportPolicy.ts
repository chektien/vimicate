export const MIN_VISIBLE_KEYBOARD_WORKSPACE_HEIGHT = 220;

export type KeyboardViewportBounds = { y: number; height: number };
export type KeyboardViewportFrame = { screenY: number; height: number };

export function usesManagedKeyboardViewport(platform: string) {
  return platform === 'ios';
}

export function keyboardViewportInset(
  bounds: KeyboardViewportBounds,
  keyboard: KeyboardViewportFrame,
  authority: { active: boolean; local: boolean | undefined },
) {
  if (!authority.active || authority.local === false) return 0;
  if (!Number.isFinite(bounds.y) || !Number.isFinite(bounds.height) || bounds.height <= 0) return 0;
  if (!Number.isFinite(keyboard.screenY) || !Number.isFinite(keyboard.height) || keyboard.height <= 0) return 0;

  const overlap = Math.max(0, bounds.y + bounds.height - keyboard.screenY);
  const keyboardBound = Math.max(0, keyboard.height);
  const workspaceBound = Math.max(0, bounds.height - MIN_VISIBLE_KEYBOARD_WORKSPACE_HEIGHT);
  return Math.min(overlap, keyboardBound, workspaceBound);
}
