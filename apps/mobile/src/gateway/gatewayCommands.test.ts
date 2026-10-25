import { describe, expect, it } from 'vitest';
import { commandCatalog, commandForInput, commandSuggestions, commandsFromPayload, displayedCommandTextFromWire, outboundCommandText } from './gatewayCommands';

describe('OpenClaw command registry', () => {
  const commands = commandsFromPayload({ commands: [
    { name: 'status', description: 'Show status', acceptsArgs: true, textAliases: ['/status'] },
    { name: 'stop', description: 'Stop the active run', acceptsArgs: false, textAliases: ['/stop'] },
  ] });

  it('normalizes registry rows and aliases', () => {
    expect(commands[0]).toEqual({ name: 'status', description: 'Show status', acceptsArgs: true, aliases: ['status'] });
    expect(commandForInput(commands, ':status compact')?.name).toBe('status');
  });

  it('presents one dashed command vocabulary while retaining an underscored wire name', () => {
    const [command] = commandsFromPayload({ commands: [{ name: 'reload_projects', description: 'Reload', textAliases: ['/reload_projects'] }] });
    expect(command).toEqual({ name: 'reload-projects', wireName: 'reload_projects', description: 'Reload', acceptsArgs: false, aliases: ['reload-projects'] });
    expect(commandForInput([command!], ':reload_projects')).toBe(command);
    expect(commandForInput([command!], ':reload-projects')).toBe(command);
    expect(commandSuggestions([command!], 'reload-p').map(({ name }) => name)).toContain('reload-projects');
    expect(outboundCommandText(command, ':reload-projects', 'now')).toBe('/reload_projects now');
  });

  it('restores Vimicate command vocabulary at the history boundary', () => {
    expect(displayedCommandTextFromWire('/think high')).toBe(':think high');
    expect(displayedCommandTextFromWire('/reload_projects now')).toBe(':reload-projects now');
    expect(displayedCommandTextFromWire('/Users/fixture/report.md')).toBe('/Users/fixture/report.md');
    expect(displayedCommandTextFromWire('https://example.com')).toBe('https://example.com');
  });

  it('offers prefix completions and rejects unknown names', () => {
    expect(commandSuggestions(commands, 'st').map((command) => command.name)).toEqual(['status', 'stop']);
    expect(commandForInput(commands, ':missing')).toBeUndefined();
  });

  it('merges local Vimicate commands without duplicating Gateway names', () => {
    expect(commandCatalog(commands).filter((command) => command.name === 'status')).toEqual([commands[0]]);
    expect(commandSuggestions([], 'new-t', 3).map((command) => command.name)).toContain('new-thread');
    expect(commandSuggestions([], 'mod', 3).some((command) => command.name === 'models')).toBe(true);
    expect(commandSuggestions([], 'w', 3).some((command) => command.name === 'write')).toBe(true);
    expect(commandSuggestions([], 'diag', 3).map((command) => command.name)).toContain('diagnostics');
    expect(commandSuggestions([], 'update-n', 3).map((command) => command.name)).toEqual(['update-notes']);
    expect(commandSuggestions([], 'inter', 3).map((command) => command.name)).toEqual(['interrupt']);
  });

  it('advertises :model and :models as distinct commands so completion cannot rename one to the other', () => {
    expect(commandSuggestions([], 'model', 3).map((command) => command.name)).toEqual(['model', 'models']);
    expect(commandForInput(commandCatalog([]), ':model opencode-go/qwen3.7-max')?.name).toBe('model');
  });
});
