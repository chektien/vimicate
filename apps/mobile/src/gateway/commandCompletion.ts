import { commandNameFromInput, commandSuggestions, type GatewayCommand } from './gatewayCommands';
import { matchingModels, type ModelChoice } from './modelMatching';
import { isModelCommandName } from './modelCommandProjection';

/**
 * Completion edits one command or argument span. A spaced compound command
 * prefix can explicitly complete to its dash-normalized name. Model arguments
 * retain their own vocabulary; submission never applies this interpretation.
 */
export type CommandArgumentVocabulary = { models?: ModelChoice[] };

export type CommandCompletionCycle = { seed: string; index: number; start: number; end: number; query: string };

export type CommandCompletionState = {
  query: string;
  cursor?: number | undefined;
  completion?: CommandCompletionCycle | undefined;
  completionNotice?: string | undefined;
};

type ActiveToken = { start: number; end: number; index: number; text: string };
type CompletionOffer = { candidates: string[]; notice: string };

export type CommandCompletionOption = { value: string; label: string; description: string };

export function commandCompletionOptions(commands: GatewayCommand[], state: CommandCompletionState, vocabulary: CommandArgumentVocabulary = {}) {
  const active = completionToken(commands, state.query, clampedCursor(state));
  const cycle = state.completion;
  const seed = cycle?.query === state.query && cycle.start === active.start && cycle.end === active.end ? cycle.seed : active.text;
  const offer = completionOffer(commands, state.query, active, seed, vocabulary);
  const matches = active.index === 0 ? commandSuggestions(commands, seed, Number.MAX_SAFE_INTEGER) : [];
  return {
    options: offer.candidates.map((value): CommandCompletionOption => ({
      value, label: active.index === 0 ? `:${value}` : value,
      description: matches.find((match) => match.name === value)?.description ?? '',
    })),
    notice: state.completionNotice ?? offer.notice,
  };
}

/** Selection edits the offered span only. Submission remains a separate intent. */
export function selectCommandCompletion<T extends CommandCompletionState>(commands: GatewayCommand[], state: T, value: string, vocabulary: CommandArgumentVocabulary = {}): T {
  if (!commandCompletionOptions(commands, state, vocabulary).options.some((option) => option.value === value)) return state;
  const active = completionToken(commands, state.query, clampedCursor(state));
  const acceptsArgs = active.index === 0 && commandSuggestions(commands, value, Number.MAX_SAFE_INTEGER).find((match) => match.name === value)?.acceptsArgs;
  const suffix = acceptsArgs && active.end === state.query.length ? ' ' : '';
  const query = `${state.query.slice(0, active.start)}${value}${suffix}${state.query.slice(active.end)}`;
  return { ...state, query, cursor: active.start + value.length + suffix.length, completion: undefined, completionNotice: undefined };
}

export function cycleCommandCompletion<T extends CommandCompletionState>(
  commands: GatewayCommand[],
  state: T,
  reverse = false,
  vocabulary: CommandArgumentVocabulary = {},
): T & CommandCompletionState {
  const cursor = clampedCursor(state);
  const active = completionToken(commands, state.query, cursor);
  // A cycle only continues while its own result is still the untouched active
  // token. Any edit reseeds, so a stale span can never splice into new text.
  const cycle = state.completion?.query === state.query && state.completion?.start === active.start && state.completion?.end === active.end
    ? state.completion
    : undefined;
  const seed = cycle?.seed ?? active.text;
  const offer = completionOffer(commands, state.query, active, seed, vocabulary);
  if (!offer.candidates.length) return { ...state, cursor, completion: undefined, completionNotice: offer.notice };
  const priorIndex = cycle ? cycle.index : reverse ? 0 : -1;
  const index = (priorIndex + (reverse ? -1 : 1) + offer.candidates.length) % offer.candidates.length;
  const candidate = offer.candidates[index]!;
  const query = `${state.query.slice(0, active.start)}${candidate}${state.query.slice(active.end)}`;
  const end = active.start + candidate.length;
  return { ...state, query, cursor: end, completion: { seed, index, start: active.start, end, query }, completionNotice: undefined };
}

function completionOffer(commands: GatewayCommand[], query: string, active: ActiveToken, seed: string, vocabulary: CommandArgumentVocabulary): CompletionOffer {
  if (active.index === 0) {
    const names = commandSuggestions(commands, seed, Number.MAX_SAFE_INTEGER).map((command) => command.name);
    return { candidates: names, notice: names.length ? '' : `No command matches ${seed}.` };
  }
  const head = commandNameFromInput(query);
  if (active.index !== 1 || !isModelCommandName(head)) return { candidates: [], notice: `:${head || 'that command'} has no argument completion.` };
  const models = vocabulary.models ?? [];
  if (!models.length) return { candidates: [], notice: 'No model catalog is available yet — run :models.' };
  const matches = matchingModels(models, seed).map(match => match.value);
  return { candidates: matches, notice: matches.length ? '' : `No model matches ${seed}.` };
}

function completionToken(commands: GatewayCommand[], query: string, cursor: number): ActiveToken {
  const active = activeToken(query, cursor);
  if (active.index === 0 || !active.text || isModelCommandName(commandNameFromInput(query))) return active;
  const start = query.search(/\S/);
  const text = query.slice(start, active.end).replace(/\s+/g, '-');
  // Require an actual catalog prefix before treating spaces as command-name
  // separators. Unmatched arguments keep their existing owner and notice.
  if (!commandSuggestions(commands, text, 1).length) return active;
  return { start, end: active.end, index: 0, text };
}

function activeToken(query: string, cursor: number): ActiveToken {
  let start = cursor;
  while (start > 0 && !isSpace(query[start - 1]!)) start -= 1;
  let end = cursor;
  while (end < query.length && !isSpace(query[end]!)) end += 1;
  const preceding = query.slice(0, start).trim();
  return { start, end, index: preceding ? preceding.split(/\s+/).length : 0, text: query.slice(start, end) };
}

function clampedCursor(state: CommandCompletionState) {
  return Math.max(0, Math.min(state.cursor ?? state.query.length, state.query.length));
}

function isSpace(character: string) { return /\s/.test(character); }
