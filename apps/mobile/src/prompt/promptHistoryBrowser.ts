import { createPromptState, type PromptState } from './vimPromptCore';
import { normalizedHardwareKey } from '../keyboard/hardwareKey';
import type { HardwareKeyEvent } from '../../modules/vimicate-editor';

export type PromptHistoryBrowserState = {
  open: boolean;
  entries: readonly string[];
  selectedIndex: number;
};

export type PromptHistoryBrowserRow = {
  index: number;
  text: string;
  selected: boolean;
};

export type PromptHistoryBrowserAction = 'older' | 'newer' | 'accept' | 'cancel' | 'block';

export const closedPromptHistoryBrowser: PromptHistoryBrowserState = {
  open: false,
  entries: [],
  selectedIndex: -1,
};

export function openPromptHistoryBrowser(entries: readonly string[]): PromptHistoryBrowserState {
  const bounded = entries.slice(-100);
  return { open: true, entries: bounded, selectedIndex: bounded.length - 1 };
}

export function closePromptHistoryBrowser(_state: PromptHistoryBrowserState): PromptHistoryBrowserState {
  return closedPromptHistoryBrowser;
}

export function movePromptHistoryBrowser(state: PromptHistoryBrowserState, direction: number): PromptHistoryBrowserState {
  if (!state.open || !state.entries.length || !direction) return state;
  return {
    ...state,
    selectedIndex: Math.max(0, Math.min(state.entries.length - 1, state.selectedIndex + direction)),
  };
}

export function promptHistorySelection(state: PromptHistoryBrowserState) {
  return state.open && state.selectedIndex >= 0 ? state.entries[state.selectedIndex] : undefined;
}

export function promptHistoryWindow(state: PromptHistoryBrowserState, maximumRows: number): PromptHistoryBrowserRow[] {
  if (!state.open || !state.entries.length || maximumRows <= 0) return [];
  const size = Math.min(state.entries.length, Math.max(1, Math.floor(maximumRows)));
  const idealStart = state.selectedIndex - Math.floor(size / 2);
  const start = Math.max(0, Math.min(state.entries.length - size, idealStart));
  return state.entries.slice(start, start + size).map((text, offset) => {
    const index = start + offset;
    return { index, text, selected: index === state.selectedIndex };
  });
}

export function acceptedPromptHistorySelection(current: PromptState, text: string): PromptState {
  return {
    ...createPromptState(text),
    authority: current.authority + 1,
    register: current.register,
    registerKind: current.registerKind,
    registerRevision: current.registerRevision,
    undo: [...current.undo.slice(-99), { text: current.text, selection: current.selection }],
  };
}

export function promptHistoryBrowserAction(state: PromptHistoryBrowserState, event: HardwareKeyEvent): PromptHistoryBrowserAction {
  if (!state.open) return 'block';
  const key = normalizedHardwareKey(event).toLocaleLowerCase();
  if (key === 'escape' || (event.control && key === '[') || (!event.control && !event.command && !event.option && key === 'q')) return 'cancel';
  if (!event.control && !event.command && !event.option && key === 'enter') return 'accept';
  if ((event.control && key === 'p') || (!event.control && !event.command && !event.option && (key === 'k' || key === 'up'))) return 'older';
  if ((event.control && key === 'n') || (!event.control && !event.command && !event.option && (key === 'j' || key === 'down'))) return 'newer';
  return 'block';
}
