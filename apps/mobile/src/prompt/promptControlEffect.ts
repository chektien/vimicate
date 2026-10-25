type Modifiers = { control?: boolean; command?: boolean; option?: boolean };
type ControlEffect = 'ignore' | 'half-page-up' | 'half-page-down' | 'focus-transcript' | 'history-previous' | 'history-next';

/** Consume modifiers before ordinary Vim keys can undo or delete the draft. */
export function promptControlEffect(input: Modifiers, key: string, visual: boolean): ControlEffect | null {
  if (input.command || input.option) return 'ignore';
  if (!input.control) return null;
  const lower = key.toLowerCase();
  // Visual block toggle and escape remain owned by the Visual key handler.
  if (visual) return lower === 'v' || key === '[' ? null : 'ignore';
  if (lower === 'r' || lower === 'v' || key === '[') return null;
  if (lower === 'f') return 'focus-transcript';
  if (lower === 'p') return 'history-previous';
  if (lower === 'n') return 'history-next';
  if (lower === 'u') return 'half-page-up';
  if (lower === 'd') return 'half-page-down';
  return 'ignore';
}
