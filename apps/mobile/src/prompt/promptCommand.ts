import type { PromptState } from './vimPromptCore';
import { isPromptFindMotion, type PromptFindMotion } from './vimPromptCharacterMotion';

export type PromptOperator = 'd' | 'c' | 'y';
export type PromptPending = '' | 'g' | 'r' | PromptOperator | PromptFindMotion
  | 'dg' | 'cg' | 'yg' | 'di' | 'ci' | 'yi' | 'da' | 'ca' | 'ya'
  | `${PromptOperator}${PromptFindMotion}`;

export function promptOperator(pending: PromptPending): PromptOperator | null {
  const value = pending[0];
  return value === 'd' || value === 'c' || value === 'y' ? value : null;
}

export function promptKeyIsCount(state: Pick<PromptState, 'pending' | 'count'>, key: string): boolean {
  // Once r/f/F/t/T owns an argument, digits are text, not another count.
  const awaitingCharacter = state.pending === 'r' || isPromptFindMotion(state.pending.slice(-1));
  return !awaitingCharacter && (/^[1-9]$/.test(key) || (key === '0' && Boolean(state.count)));
}

/** Render the parsed command in Vim order, not count + pending storage order. */
export function promptModeHint(state: PromptState): string {
  if (state.pending || state.count) {
    const operator = promptOperator(state.pending);
    const command = operator
      ? `${state.operatorCount > 1 ? state.operatorCount : ''}${operator}${state.count}${state.pending.slice(1)}`
      : `${state.count}${state.pending}`;
    return `${command}…`;
  }
  return state.visualMode ? `visual ${state.visualMode}` : state.mode === 'insert' ? 'Esc normal' : '';
}
