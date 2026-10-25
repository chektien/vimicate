import { describe, expect, it } from 'vitest';
import { matchingModels, resolveModelChoice } from './modelMatching';
import { modelCatalogEntriesFromPayload } from './modelCommandProjection';

const choices = [
  'openai/gpt-5-astra',
  'custom/astra-fast',
  { value: 'openai/gpt-6-astra', name: 'GPT 6 Astra', aliases: ['flagship'] },
  'custom/astra',
];

describe('model search ownership', () => {
  it('ranks exact bare IDs first, then prefixes, substrings and ordered abbreviations', () => {
    expect(matchingModels(choices, 'astra').map(match => match.value)).toEqual([
      'custom/astra', 'custom/astra-fast', 'openai/gpt-5-astra', 'openai/gpt-6-astra',
    ]);
    expect(resolveModelChoice(choices, 'astra')).toBe('custom/astra');
    expect(resolveModelChoice(choices, 'OPENAI/GPT-6-ASTRA')).toBe('openai/gpt-6-astra');
    expect(resolveModelChoice(choices, 'flagship')).toBe('openai/gpt-6-astra');
    expect(resolveModelChoice(['one/model', { value: 'two/model', aliases: ['one/model'] }], 'one/model')).toBe('one/model');
  });
  it('does not pick a nonexact best-ranked model or silently pick among duplicate aliases', () => {
    expect(() => resolveModelChoice(choices, 'ast')).toThrow('Multiple models match ast');
    expect(() => resolveModelChoice([
      { value: 'one/model', aliases: ['fast'] }, { value: 'two/model', aliases: ['fast'] },
    ], 'fast')).toThrow('Multiple models match fast');
  });
  it('validates searchable metadata without accepting invalid or duplicate wire IDs', () => {
    const catalog = modelCatalogEntriesFromPayload({ result: { models: [
      { provider: 'openai', id: 'gpt-6-astra', name: 'Astra Prime', alias: 'best', aliases: ['flagship', null, 42] },
      { id: 'openai/gpt-6-astra' }, { name: 'not a model', aliases: ['invalid'] },
      { provider: 'custom', modelId: 'test', name: 42, aliases: 'invalid' },
    ] } });
    expect(catalog).toEqual([
      { value: 'openai/gpt-6-astra', name: 'Astra Prime', aliases: ['best', 'flagship'] },
      { value: 'custom/test' },
    ]);
    expect(resolveModelChoice(catalog, 'Prime')).toBe('openai/gpt-6-astra');
    expect(resolveModelChoice(catalog, 'best')).toBe('openai/gpt-6-astra');
  });
  it('deduplicates matches and preserves catalog order for an empty query', () => {
    expect(matchingModels(['one/model', 'one/model', 'two/model'], '').map(match => match.value)).toEqual(['one/model', 'two/model']);
  });
});
