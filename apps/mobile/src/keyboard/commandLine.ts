import type { HardwareKeyEvent } from '../../modules/vimicate-editor';
import { hardwareTextCharacter } from './hardwareKey';

export type CommandLineState = { query: string };
export type CommandLineAction = 'none' | 'cancel' | 'submit';

export function appendCommandLinePaste<T extends CommandLineState>(state: T, pastedText: string): T {
  const safeText = pastedText
    .replace(/\r\n?/g, '\n')
    .replace(/[\u0000\u0008\u000b\u000c\u007f]/g, '')
    .replace(/\n+/g, ' ');
  return { ...state, query: state.query + safeText };
}

export function handleCommandLineKey<T extends CommandLineState>(state: T, event: HardwareKeyEvent): { state: T; action: CommandLineAction } {
  if (event.key === 'escape' || (event.control && event.key === '[')) return { state, action: 'cancel' };
  if (event.key === 'enter') return { state, action: 'submit' };
  if (event.key === 'backspace' || event.key === 'delete') return { state: { ...state, query: state.query.slice(0, -1) }, action: 'none' };
  if (event.control && event.key.toLowerCase() === 'u') return { state: { ...state, query: '' }, action: 'none' };
  if (event.control || event.command || event.option) return { state, action: 'none' };
  const character = hardwareTextCharacter(event);
  return character ? { state: { ...state, query: state.query + character }, action: 'none' } : { state, action: 'none' };
}
