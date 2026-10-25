import { describe, expect, it } from 'vitest';
import type { CommandSession, SearchSession } from '../ui/WorkspaceCommandBar';
import { workspaceCommandLineActions } from './workspaceCommandLineActions';

describe('workspace command-line actions', () => {
  it('routes paste and native text changes to the active colon command', () => {
    let command: CommandSession | null = { query: 'model ' };
    let search: SearchSession | null = null;
    const commandRef: { current: CommandSession | null } = { current: command };
    const searchRef: { current: SearchSession | null } = { current: search };
    const actions = workspaceCommandLineActions({
      commandRef,
      searchRef,
      commands: [],
      modelChoices: ['opencode-go/qwen3.7-max', 'openai/gpt-5.2'],
      setCommand(value) { command = typeof value === 'function' ? value(command) : value; commandRef.current = command; },
      setSearch(value) { search = typeof value === 'function' ? value(search) : value; searchRef.current = search; },
    });

    actions.paste('opencode-go/qwen3.7-max\n');
    expect(command?.query).toBe('model opencode-go/qwen3.7-max ');
    actions.updateQuery('status');
    expect(command?.query).toBe('status');
    actions.updateQuery('model open');
    actions.complete(false);
    expect(command?.query).toBe('model opencode-go/qwen3.7-max');
    actions.complete(false);
    expect(command?.query).toBe('model openai/gpt-5.2');
    actions.complete(true);
    expect(command?.query).toBe('model opencode-go/qwen3.7-max');
    actions.cancel();
    expect(command).toBeNull();
    expect(search).toBeNull();
  });

  it('updates search without accidentally opening or modifying a command', () => {
    let command: CommandSession | null = null;
    let search: SearchSession | null = { scope: 'transcript', query: 'old', direction: 1 };
    const commandRef: { current: CommandSession | null } = { current: command };
    const searchRef: { current: SearchSession | null } = { current: search };
    const actions = workspaceCommandLineActions({
      commandRef,
      searchRef,
      commands: [],
      modelChoices: ['opencode-go/qwen3.7-max', 'openai/gpt-5.2'],
      setCommand(value) { command = typeof value === 'function' ? value(command) : value; commandRef.current = command; },
      setSearch(value) { search = typeof value === 'function' ? value(search) : value; searchRef.current = search; },
    });

    actions.updateQuery('needle');
    expect(search).toMatchObject({ query: 'needle', scope: 'transcript', direction: 1 });
    expect(command).toBeNull();
  });
});


describe('native command edit acknowledgements', () => {
  function setup(query = 'model ', searching = false) {
    const commandRef: { current: CommandSession | null } = { current: searching ? null : { query } };
    const searchRef: { current: SearchSession | null } = { current: searching ? { query, scope: 'transcript', direction: 1 } : null };
    const actions = workspaceCommandLineActions({ commandRef, searchRef, commands: [], modelChoices: ['openai/example'], historyRef: { current: ['models'] },
      setCommand(value) { commandRef.current = typeof value === 'function' ? value(commandRef.current) : value; },
      setSearch(value) { searchRef.current = typeof value === 'function' ? value(searchRef.current) : value; },
    });
    return { actions, commandRef, searchRef };
  }

  it('keeps native query and its count in the same state update and rejects retired edits', () => {
    const { actions, commandRef } = setup();
    actions.updateQuery('model open', 4);
    expect(commandRef.current).toMatchObject({ query: 'model open', nativeEventCount: 4 });
    actions.updateQuery('model op', 3);
    expect(commandRef.current).toMatchObject({ query: 'model open', nativeEventCount: 4 });
    actions.complete(false);
    expect(commandRef.current).toMatchObject({ query: 'model openai/example', nativeEventCount: 4 });
    actions.recall(-1);
    expect(commandRef.current).toMatchObject({ query: 'models', nativeEventCount: 4 });
    actions.paste(' x');
    expect(commandRef.current).toMatchObject({ query: 'models x', nativeEventCount: 4 });
  });

  it('applies the same acknowledgement lifetime to search without stealing command ownership', () => {
    const { actions, searchRef, commandRef } = setup('', true);
    actions.updateQuery('needle', 6);
    actions.updateQuery('need', 5);
    expect(searchRef.current).toMatchObject({ query: 'needle', nativeEventCount: 6 });
    actions.updateQuery('replacement');
    expect(searchRef.current).toMatchObject({ query: 'replacement', nativeEventCount: 6 });
    expect(commandRef.current).toBeNull();
  });

  it('accepts a current touch offer without losing edit count and ignores stale or cancelled offers', () => {
    const { actions, commandRef } = setup();
    actions.updateQuery('model open', 4);
    const offer = commandRef.current!;
    actions.selectCompletion('openai/example', offer);
    expect(commandRef.current).toMatchObject({ query: 'model openai/example', nativeEventCount: 4 });
    actions.updateQuery('model newer', 5);
    actions.selectCompletion('openai/example', offer);
    expect(commandRef.current).toMatchObject({ query: 'model newer', nativeEventCount: 5 });
    actions.cancel();
    actions.selectCompletion('openai/example', offer);
    expect(commandRef.current).toBeNull();
  });

  it('retains compatibility with native builds that do not publish edit counts', () => {
    const { actions, commandRef } = setup();
    actions.updateQuery('model open');
    actions.complete(false);
    expect(commandRef.current?.query).toBe('model openai/example');
  });
});
