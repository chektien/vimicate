import type { HardwareKeyEvent } from '../../modules/vimicate-editor';
import type { WorkspaceFocus } from '../workspace/focusRouting';
import { normalizedHardwareKey } from './hardwareKey';

const DIRECTION_KEYS = ['h', 'j', 'k', 'l', 'left', 'down', 'up', 'right'];
const LIST_NAVIGATION_KEYS = new Set([...DIRECTION_KEYS, 'n', 'N']);
const WORKSPACE_NAVIGATION_KEYS = new Set([
  ...LIST_NAVIGATION_KEYS, 'w', 'W', 'b', 'B', 'e', 'E', '^', '$',
]);
const PROMPT_REPEATABLE_NORMAL_KEYS = new Set([
  ...WORKSPACE_NAVIGATION_KEYS,
  'x', 'X', 'u', 'backspace', 'delete', '~',
]);

export function isWorkspaceNavigationKey(event: HardwareKeyEvent) {
  return !event.control && !event.command && !event.option && WORKSPACE_NAVIGATION_KEYS.has(normalizedHardwareKey(event));
}

export function shouldAcceptSynthesizedRepeat(event: HardwareKeyEvent, pane: WorkspaceFocus | 'files', pending: string, commandLineActive: boolean) {
  if (!event.isRepeat) return true;
  if (commandLineActive) return true;
  if (event.control || event.command || event.option) return false;
  const key = normalizedHardwareKey(event);
  // List navigation remains independent of the parked prompt's pending operator.
  if (pane === 'projects' || pane === 'files') return LIST_NAVIGATION_KEYS.has(key);
  // A held prefix/target must not finish or replace a pending Vim command.
  if (pending) return false;
  if (pane === 'transcript') return WORKSPACE_NAVIGATION_KEYS.has(key);
  return PROMPT_REPEATABLE_NORMAL_KEYS.has(normalizedHardwareKey(event));
}
