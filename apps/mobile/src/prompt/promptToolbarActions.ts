import type { HardwareKeyEvent } from '../../modules/vimicate-editor';

export const PROMPT_TOOLBAR_NAVIGATION_KEYS = ['left', 'down', 'up', 'right'] as const;

export type PromptToolbarNavigationKey = typeof PROMPT_TOOLBAR_NAVIGATION_KEYS[number];

export type PromptToolbarNavigationTarget = 'prompt' | 'command-history-older' | 'command-history-newer' | 'inert';

/**
 * An open command line owns the keyboard, so its arrows belong to it rather than to the
 * prompt caret. Only the colon command keeps history; search has none, and the command
 * line has no horizontal caret intent of its own.
 */
export function promptToolbarNavigationTarget(key: PromptToolbarNavigationKey, { commandLineActive, commandHistoryActive }: { commandLineActive: boolean; commandHistoryActive: boolean }): PromptToolbarNavigationTarget {
  if (!commandLineActive) return 'prompt';
  if (!commandHistoryActive) return 'inert';
  if (key === 'up') return 'command-history-older';
  if (key === 'down') return 'command-history-newer';
  return 'inert';
}

export function promptToolbarKeyEvent(key: PromptToolbarNavigationKey | 'escape'): HardwareKeyEvent {
  return {
    key,
    shift: false,
    control: false,
    option: false,
    command: false,
    isRepeat: false,
  };
}
