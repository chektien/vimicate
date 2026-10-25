import { describe, expect, it } from 'vitest';
import { commandCompletionOptions, selectCommandCompletion, cycleCommandCompletion } from './commandCompletion';
import { commandsFromPayload } from './gatewayCommands';

const commands = commandsFromPayload({ commands: [
  { name: 'status', description: 'Show status', acceptsArgs: true, textAliases: ['/status'] },
  { name: 'stop', description: 'Stop the active run', acceptsArgs: false, textAliases: ['/stop'] },
] });

const models = { models: ['opencode-go/qwen3.7-max', 'openai/gpt-5.2', 'anthropic/claude-opus-5'] };

describe('colon-command completion', () => {
  it('completes the model argument at the cursor instead of rewriting the command head', () => {
    const first = cycleCommandCompletion(commands, { query: 'model open' }, false, models);
    const second = cycleCommandCompletion(commands, first, false, models);
    const wrapped = cycleCommandCompletion(commands, second, false, models);
    expect(first).toMatchObject({ query: 'model opencode-go/qwen3.7-max', cursor: 'model opencode-go/qwen3.7-max'.length });
    expect(second.query).toBe('model openai/gpt-5.2');
    expect(wrapped.query).toBe('model opencode-go/qwen3.7-max');
    expect(first.completionNotice).toBeUndefined();
  });

  it('cycles the same argument backwards without touching the command or other tokens', () => {
    const reversed = cycleCommandCompletion(commands, { query: 'models open' }, true, models);
    const back = cycleCommandCompletion(commands, reversed, true, models);
    expect(reversed.query).toBe('models openai/gpt-5.2');
    expect(back.query).toBe('models opencode-go/qwen3.7-max');
  });

  it('offers the whole configured catalog for an empty argument after whitespace', () => {
    expect(cycleCommandCompletion(commands, { query: 'model ' }, false, models).query).toBe('model opencode-go/qwen3.7-max');
    expect(cycleCommandCompletion(commands, { query: 'model ' }, true, models).query).toBe('model anthropic/claude-opus-5');
  });

  it('still cycles command names before the first argument', () => {
    const first = cycleCommandCompletion(commands, { query: 'st' });
    const second = cycleCommandCompletion(commands, first);
    const wrapped = cycleCommandCompletion(commands, second);
    const reversed = cycleCommandCompletion(commands, wrapped, true);
    expect(first).toMatchObject({ query: 'status', cursor: 'status'.length });
    expect(second.query).toBe('stop');
    expect(wrapped.query).toBe('status');
    expect(reversed.query).toBe('stop');
  });

  it('cycles command names from a cursor inside the head and preserves the argument tail', () => {
    const first = cycleCommandCompletion(commands, { query: 'st compact', cursor: 2 });
    const second = cycleCommandCompletion(commands, first);
    expect(first).toMatchObject({ query: 'status compact', cursor: 'status'.length });
    expect(second.query).toBe('stop compact');
  });

  it('no longer seeds from the head while the cursor sits in an argument', () => {
    const attempted = cycleCommandCompletion(commands, { query: 'st compact' });
    expect(attempted.query).toBe('st compact');
    expect(attempted.completionNotice).toBe(':st has no argument completion.');
  });

  it('keeps :model reachable as its own command head instead of jumping to :models', () => {
    const first = cycleCommandCompletion(commands, { query: 'model' });
    expect(first.query).toBe('model');
    expect(cycleCommandCompletion(commands, first).query).toBe('models');
  });

  it('completes the head token when the cursor sits inside it', () => {
    const completed = cycleCommandCompletion(commands, { query: 'mod opencode-go/qwen3.7-max', cursor: 3 }, false, models);
    expect(completed.query).toBe('model opencode-go/qwen3.7-max');
    expect(completed.cursor).toBe('model'.length);
  });

  it('preserves the input and reports the truth for a command without argument completion', () => {
    const attempted = cycleCommandCompletion(commands, { query: 'new-thread release' }, false, models);
    expect(attempted.query).toBe('new-thread release');
    expect(attempted.completionNotice).toBe(':new-thread has no argument completion.');
    expect(attempted.completion).toBeUndefined();
  });

  it('preserves the input and names the missing catalog when no model choices are configured', () => {
    const attempted = cycleCommandCompletion(commands, { query: 'model open' });
    expect(attempted.query).toBe('model open');
    expect(attempted.completionNotice).toBe('No model catalog is available yet — run :models.');
  });

  it('preserves the input and reports an honest miss when no configured model matches', () => {
    const attempted = cycleCommandCompletion(commands, { query: 'model zzz' }, false, models);
    expect(attempted.query).toBe('model zzz');
    expect(attempted.completionNotice).toBe('No model matches zzz.');
  });

  it('reports an honest miss for an unmatched command head', () => {
    const attempted = cycleCommandCompletion(commands, { query: 'zzz' });
    expect(attempted.query).toBe('zzz');
    expect(attempted.completionNotice).toBe('No command matches zzz.');
  });

  it('reseeds from the edited token instead of splicing at a stale completion span', () => {
    const completed = cycleCommandCompletion(commands, { query: 'model open' }, false, models);
    const edited = cycleCommandCompletion(commands, { ...completed, query: 'model anth', cursor: undefined }, false, models);
    expect(edited.query).toBe('model anthropic/claude-opus-5');
  });

  it('clears a prior no-match notice once a completion succeeds', () => {
    const missed = cycleCommandCompletion(commands, { query: 'model zzz' }, false, models);
    const completed = cycleCommandCompletion(commands, { ...missed, query: 'model open', cursor: undefined }, false, models);
    expect(completed.query).toBe('model opencode-go/qwen3.7-max');
    expect(completed.completionNotice).toBeUndefined();
  });


});

describe('touch command completion', () => {
  it('offers structured command descriptions and the complete untruncated model catalog', () => {
    expect(commandCompletionOptions(commands, { query: 'st' }).options[0]).toMatchObject({ value: 'status', label: ':status', description: 'Show status' });
    const catalog = Array.from({ length: 60 }, (_, i) => `provider/model-${i}`);
    expect(commandCompletionOptions(commands, { query: 'model ' }, { models: catalog }).options).toHaveLength(60);
  });
  it('replaces only the offered token, preserving surrounding arguments and native edit authority', () => {
    const state = { query: 'model open tail', cursor: 10, nativeEventCount: 7 };
    expect(selectCommandCompletion(commands, state, 'openai/gpt-5.2', models)).toMatchObject({ query: 'model openai/gpt-5.2 tail', nativeEventCount: 7 });
    expect(selectCommandCompletion(commands, state, 'unoffered', models)).toBe(state);
  });
  it('opens argument completion immediately when choosing an argument-taking command', () => {
    const selected = selectCommandCompletion(commands, { query: 'mod' }, 'model', models);
    expect(selected.query).toBe('model ');
    expect(commandCompletionOptions(commands, selected, models).options).toHaveLength(3);
    expect(selectCommandCompletion(commands, { query: 'st' }, 'stop').query).toBe('stop');
  });
  it('keeps alternatives available after Tab and exposes honest no-match states', () => {
    const cycled = cycleCommandCompletion(commands, { query: 'model open' }, false, models);
    expect(commandCompletionOptions(commands, cycled, models).options).toHaveLength(2);
    expect(commandCompletionOptions(commands, { query: 'model zzz' }, models)).toMatchObject({ options: [], notice: 'No model matches zzz.' });
  });
});


describe('fuzzy model completion', () => {
  const catalog = { models: ['openai/gpt-6-astra', 'openai/gpt-6.1-sol', 'anthropic/claude-opus-5'] };
  it('finds a model family inside its full provider/id for Tab and touch', () => {
    expect(cycleCommandCompletion(commands, { query: 'model astra' }, false, catalog).query).toBe('model openai/gpt-6-astra');
    expect(commandCompletionOptions(commands, { query: 'models ASTRA' }, catalog).options.map(option => option.value)).toEqual(['openai/gpt-6-astra']);
  });
  it('accepts ordered abbreviation characters without changing other tokens', () => {
    expect(cycleCommandCompletion(commands, { query: 'model g6ast tail', cursor: 11 }, false, catalog).query).toBe('model openai/gpt-6-astra tail');
  });
});


it('keeps alias matches and ambiguous family choices available for forward, reverse and touch completion', () => {
  const catalog = { models: [
    { value: 'openai/gpt-5-astra', aliases: ['oldstar'] },
    { value: 'openai/gpt-6-astra', name: 'Astra Prime', aliases: ['flagship'] },
  ] };
  const first = cycleCommandCompletion(commands, { query: 'model astra' }, false, catalog);
  expect(first.query).toBe('model openai/gpt-6-astra');
  const second = cycleCommandCompletion(commands, first, false, catalog);
  expect(second.query).toBe('model openai/gpt-5-astra');
  expect(cycleCommandCompletion(commands, second, true, catalog).query).toBe(first.query);
  expect(commandCompletionOptions(commands, first, catalog).options).toHaveLength(2);
  expect(selectCommandCompletion(commands, { query: 'model flagship' }, 'openai/gpt-6-astra', catalog).query).toBe('model openai/gpt-6-astra');
  expect(commandCompletionOptions(commands, { query: 'model prime' }, catalog).options[0]?.value).toBe('openai/gpt-6-astra');
});


describe('spaced compound command completion', () => {
  it.each(['new thread', 'new th', 'NEW   THREAD', 'new\tthread'])(
    'completes %s to the canonical command', (query) => {
      expect(cycleCommandCompletion(commands, { query }).query).toBe('new-thread');
      expect(commandCompletionOptions(commands, { query }).options).toEqual([
        { value: 'new-thread', label: ':new-thread', description: 'create a child thread' },
      ]);
    },
  );
  it('supports other compound commands and touch selection with argument spacing', () => {
    expect(cycleCommandCompletion(commands, { query: 'reload proj' }).query).toBe('reload-projects');
    expect(selectCommandCompletion(commands, { query: 'new thread', nativeEventCount: 9 }, 'new-thread'))
      .toMatchObject({ query: 'new-thread ', cursor: 11, nativeEventCount: 9 });
    expect(selectCommandCompletion(commands, { query: 'close thread' }, 'close-thread').query).toBe('close-thread');
  });
  it('replaces only the compound command span, preserving the argument tail and indentation', () => {
    const state = { query: '  new th My release notes', cursor: 8 };
    expect(cycleCommandCompletion(commands, state).query).toBe('  new-thread My release notes');
    expect(selectCommandCompletion(commands, state, 'new-thread').query).toBe('  new-thread My release notes');
  });
  it('keeps ambiguous alternatives available across forward, reverse, touch and edits', () => {
    const catalog = commandsFromPayload({ commands: [
      { name: 'new_topic', description: 'New topic', acceptsArgs: true },
    ] });
    const first = cycleCommandCompletion(catalog, { query: 'new t' });
    expect(first.query).toBe('new-thread');
    expect(commandCompletionOptions(catalog, first).options.map(option => option.value)).toEqual(['new-thread', 'new-topic']);
    const next = cycleCommandCompletion(catalog, first);
    expect(next.query).toBe('new-topic');
    expect(cycleCommandCompletion(catalog, next, true).query).toBe('new-thread');
    expect(cycleCommandCompletion(catalog, { ...next, query: 'reload proj', cursor: undefined }).query).toBe('reload-projects');
  });
  it('does not steal normal arguments or complete from an empty argument', () => {
    for (const query of ['new ', 'new unrelated', 'new-thread release', 'new thread Release']) {
      expect(cycleCommandCompletion(commands, { query }).query).toBe(query);
    }
    const catalog = commandsFromPayload({ commands: [{ name: 'model_astra', acceptsArgs: false }] });
    expect(cycleCommandCompletion(catalog, { query: 'model astra' }, false, { models: ['openai/gpt-6-astra'] }).query)
      .toBe('model openai/gpt-6-astra');
  });
});
