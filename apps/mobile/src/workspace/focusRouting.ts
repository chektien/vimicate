import type { HardwareKeyEvent } from '../../modules/vimicate-editor';
import { normalizedHardwareKey } from '../keyboard/hardwareKey';

export type TerminalSurface = 'prompt' | 'transcript';
export type WorkspaceFocus = 'projects' | TerminalSurface;
export type FocusRouting = { target: WorkspaceFocus; rememberedTerminal: TerminalSurface };
export type PaneShortcutContext = { filesOpen: boolean; filesFocused: boolean };
export type FileFocusDisposition = 'preserve' | 'open' | 'acquire' | 'release';

export function resolvePaneShortcutPrefix(pending: boolean, input: HardwareKeyEvent, enabled: boolean) {
  const key = input.key.toLowerCase();
  if (pending) {
    if (key === 'escape') return { pending: false, input, consumed: false };
    const paneKey = ['h', 'j', 'k', 'l', 'left', 'down', 'up', 'right'].includes(key);
    return { pending: false, input: paneKey && !input.command && !input.option ? { ...input, control: true } : null, consumed: !paneKey };
  }
  if (enabled && input.control && !input.command && !input.option && key === 'w') return { pending: true, input: null, consumed: true };
  return { pending: false, input, consumed: false };
}

export function createFocusRouting(target: WorkspaceFocus = 'prompt'): FocusRouting {
  return { target, rememberedTerminal: target === 'transcript' ? 'transcript' : 'prompt' };
}

export function focusWorkspaceTarget(state: FocusRouting, target: WorkspaceFocus): FocusRouting {
  if (target === 'projects') {
    const rememberedTerminal = state.target === 'projects' ? state.rememberedTerminal : state.target;
    return { target, rememberedTerminal };
  }
  return { target, rememberedTerminal: target };
}

export function focusAfterProjectActivation(state: FocusRouting) {
  return focusWorkspaceTarget(state, 'prompt');
}

export function applyPaneShortcut(
  state: FocusRouting,
  input: HardwareKeyEvent,
  context: PaneShortcutContext = { filesOpen: false, filesFocused: false },
): { state: FocusRouting; handled: boolean; fileFocus: FileFocusDisposition } {
  const preserve = { state, handled: false, fileFocus: 'preserve' as const };
  if (!input.control) return preserve;
  const key = input.key.toLowerCase();
  if (context.filesFocused) {
    if (key === 'h' || key === 'left') return { state: focusWorkspaceTarget(state, state.rememberedTerminal), handled: true, fileFocus: 'release' };
    if (key === 'l' || key === 'right') return { state, handled: true, fileFocus: 'preserve' };
    return preserve;
  }
  if (key === 'h' || key === 'left') return { state: focusWorkspaceTarget(state, 'projects'), handled: true, fileFocus: 'preserve' };
  if (key === 'l' || key === 'right') {
    if (state.target === 'projects') return { state: focusWorkspaceTarget(state, state.rememberedTerminal), handled: true, fileFocus: 'preserve' };
    return { state, handled: true, fileFocus: context.filesOpen ? 'acquire' : 'open' };
  }
  if (key === 'j' || key === 'down') return { state: focusWorkspaceTarget(state, 'prompt'), handled: true, fileFocus: 'preserve' };
  if (key === 'k' || key === 'up') return { state: focusWorkspaceTarget(state, 'transcript'), handled: true, fileFocus: 'preserve' };
  return preserve;
}

export function adjacentProjectKey(keys: string[], current: string, delta: number) {
  if (!keys.length) return '';
  const currentIndex = Math.max(0, keys.indexOf(current));
  return keys[Math.max(0, Math.min(keys.length - 1, currentIndex + delta))] ?? keys[0] ?? '';
}

export type ProjectNavigationState = { focusedKey: string; prefix: '' | 'g' | 'd' };

export function applyProjectNavigation(
  keys: string[],
  state: ProjectNavigationState,
  input: HardwareKeyEvent,
): { state: ProjectNavigationState; activateKey?: string; removeKey?: string; handled: boolean } {
  const key = normalizedHardwareKey(input);
  const clean = (focusedKey = state.focusedKey): ProjectNavigationState => ({ focusedKey, prefix: '' });
  const unmodified = !input.control && !input.command && !input.option;

  if (state.prefix === 'd') {
    if (unmodified && key === 'd' && state.focusedKey) return { state: clean(), removeKey: state.focusedKey, handled: true };
    return { state: clean(), handled: true };
  }
  if (unmodified && key === 'd') return { state: { ...state, prefix: 'd' }, handled: true };

  if (state.prefix === 'g') {
    if (key === 'g') return { state: clean(keys[0] ?? ''), handled: true };
    state = clean();
  }
  if (key === 'g') return { state: { ...state, prefix: 'g' }, handled: true };
  if (key === 'j' || key === 'down') return { state: clean(adjacentProjectKey(keys, state.focusedKey, 1)), handled: true };
  if (key === 'k' || key === 'up') return { state: clean(adjacentProjectKey(keys, state.focusedKey, -1)), handled: true };
  if (key === 'G') return { state: clean(keys.at(-1) ?? ''), handled: true };
  if (key === 'enter' || key === 'l' || key === 'right') return { state: clean(), activateKey: state.focusedKey, handled: true };
  if (/^[1-9]$/.test(key)) {
    const activateKey = keys[Number(key) - 1];
    return activateKey
      ? { state: clean(activateKey), activateKey, handled: true }
      : { state: clean(), handled: true };
  }
  return { state: clean(), handled: false };
}
