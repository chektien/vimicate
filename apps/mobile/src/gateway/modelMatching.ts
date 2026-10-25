/** Canonical wire IDs remain separate from searchable Gateway labels/aliases. */
export type ModelChoice = string | { value: string; name?: string; aliases?: string[] };

export function modelChoiceValue(choice: ModelChoice) { return typeof choice === 'string' ? choice : choice.value; }

/** Stable catalog order breaks ranking ties. No typo-distance guessing. */
export function matchingModels(choices: readonly ModelChoice[], query: string) {
  const seed = query.trim().toLocaleLowerCase();
  const seen = new Set<string>();
  return choices.flatMap(choice => {
    const value = modelChoiceValue(choice);
    if (seen.has(value)) return [];
    seen.add(value);
    const fields = [value, value.slice(value.indexOf('/') + 1), ...(typeof choice === 'string' ? [] : [choice.name ?? '', ...(choice.aliases ?? [])])];
    const rank = seed && value.toLocaleLowerCase() === seed ? -1 : Math.min(...fields.filter(Boolean).map(field => matchRank(field.toLocaleLowerCase(), seed)));
    return Number.isFinite(rank) ? [{ value, rank }] : [];
  }).sort((a, b) => a.rank - b.rank);
}

/** Only a unique match or unique exact identity may mutate the session. */
export function resolveModelChoice(choices: readonly ModelChoice[], query: string) {
  const matches = matchingModels(choices, query);
  const exact = matches.filter(match => match.rank <= 0 && match.rank === matches[0]?.rank);
  const candidates = exact.length ? exact : matches;
  if (candidates.length === 1) return candidates[0]!.value;
  if (!candidates.length) throw new Error(`No model matches ${query}. Use :models to see configured choices.`);
  throw new Error(`Multiple models match ${query}: ${candidates.map(match => match.value).join(', ')}. Choose a full model with Tab or the suggestions.`);
}

function matchRank(field: string, seed: string) {
  if (!seed || field === seed) return 0;
  if (field.startsWith(seed)) return 1;
  if (field.includes(seed)) return 2;
  // Ignore punctuation in abbreviations, allowing e.g. g6ast → gpt-6-astra.
  const compact = seed.replace(/[^\p{L}\p{N}]/gu, '');
  if (compact.length < 2) return Infinity;
  let cursor = 0;
  for (const character of compact) {
    cursor = field.indexOf(character, cursor);
    if (cursor < 0) return Infinity;
    cursor += 1;
  }
  return 3;
}
