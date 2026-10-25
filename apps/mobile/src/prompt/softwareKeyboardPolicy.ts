import type { VimMode } from './vimPromptCore';

export function promptSoftwareKeyboardEnabled(requested: boolean, promptFocused: boolean, mode: VimMode) {
  return requested && promptFocused && mode === 'insert';
}

export function promptTouchRequestsSoftwareKeyboard(hardwareKeyboardConnected: boolean) {
  return !hardwareKeyboardConnected;
}
