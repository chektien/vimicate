export type GatewayCommand = {
  name: string;
  description: string;
  acceptsArgs: boolean;
  aliases: string[];
  wireName?: string;
};

export const LOCAL_COMMANDS: GatewayCommand[] = [
  { name: 'approve', description: 'resolve a pending approval', acceptsArgs: true, aliases: [] },
  { name: 'approvals', description: 'list pending approvals', acceptsArgs: false, aliases: [] },
  { name: 'close-thread', description: 'remove the selected child thread', acceptsArgs: false, aliases: [] },
  { name: 'commands', description: 'list Vimicate and OpenClaw commands', acceptsArgs: false, aliases: [] },
  { name: 'context', description: 'show selected workspace context', acceptsArgs: false, aliases: [] },
  { name: 'deny', description: 'deny a pending approval', acceptsArgs: true, aliases: [] },
  { name: 'diagnostics', description: 'show the retained RN fatal breadcrumb', acceptsArgs: false, aliases: [] },
  { name: 'files', description: 'browse project files', acceptsArgs: false, aliases: [] },
  { name: 'help', description: 'show Vim and keyboard shortcuts', acceptsArgs: false, aliases: ['h', 'shortcuts'] },
  { name: 'healthcheck', description: 'read Gateway health', acceptsArgs: false, aliases: [] },
  { name: 'interrupt', description: 'stop the active run, then send the supplied prompt', acceptsArgs: true, aliases: [] },
  { name: 'model', description: 'set this thread model', acceptsArgs: true, aliases: [] },
  { name: 'models', description: 'list configured model commands', acceptsArgs: true, aliases: [] },
  { name: 'new-thread', description: 'create a child thread', acceptsArgs: true, aliases: [] },
  { name: 'noh', description: 'clear search highlights', acceptsArgs: false, aliases: ['nohlsearch'] },
  { name: 'progress', description: 'show or hide live progress rows', acceptsArgs: true, aliases: [] },
  { name: 'reconnect', description: 'reconnect the paired Gateway', acceptsArgs: false, aliases: [] },
  { name: 'repair', description: 'clear only this RN surface connection', acceptsArgs: false, aliases: [] },
  { name: 'reload-projects', description: 'reload the authoritative project registry', acceptsArgs: false, aliases: [] },
  { name: 'status', description: 'show selected session status', acceptsArgs: false, aliases: [] },
  { name: 'stop', description: 'stop the selected thread run', acceptsArgs: false, aliases: [] },
  { name: 'thread-sort', description: 'set activity or manual project order', acceptsArgs: true, aliases: [] },
  { name: 'update-notes', description: 'reopen the latest app update notes', acceptsArgs: false, aliases: [] },
  { name: 'verbose', description: 'show or hide raw detail rows', acceptsArgs: true, aliases: [] },
  { name: 'write', description: 'send the current prompt', acceptsArgs: false, aliases: ['w', 'send'] },
];

export function commandsFromPayload(payload: Record<string, unknown>): GatewayCommand[] {
  const rows = Array.isArray(payload.commands) ? payload.commands : [];
  return rows.flatMap((value) => {
    if (!record(value)) return [];
    const wireName = text(value.name).trim().replace(/^\//, '');
    const name = canonicalCommandName(wireName);
    if (!name) return [];
    return [{
      name,
      description: text(value.description),
      acceptsArgs: value.acceptsArgs === true,
      aliases: Array.isArray(value.textAliases) ? value.textAliases.filter((alias): alias is string => typeof alias === 'string').map(canonicalCommandName).filter(Boolean) : [],
      ...(wireName !== name ? { wireName } : {}),
    }];
  });
}

export function commandNameFromInput(input: string) {
  return canonicalCommandName(input.trim().replace(/^:/, '').split(/\s+/, 1)[0] ?? '');
}

export function commandForInput(commands: GatewayCommand[], input: string) {
  const name = commandNameFromInput(input);
  return commands.find((command) => canonicalCommandName(command.name) === name || command.aliases.some((alias) => canonicalCommandName(alias) === name));
}

export function commandSuggestions(commands: GatewayCommand[], input: string, limit = 3) {
  const prefix = commandNameFromInput(input);
  return commandCatalog(commands).filter((command) => !prefix || canonicalCommandName(command.name).startsWith(prefix) || command.aliases.some((alias) => canonicalCommandName(alias).startsWith(prefix))).slice(0, limit);
}

export function commandCatalog(commands: GatewayCommand[]) {
  const catalog = new Map<string, GatewayCommand>();
  for (const command of [...LOCAL_COMMANDS, ...commands]) catalog.set(canonicalCommandName(command.name), command);
  return [...catalog.values()].sort((left, right) => left.name.localeCompare(right.name));
}

export function outboundCommandText(command: GatewayCommand | undefined, typedToken: string, argumentsText: string) {
  const wireName = command?.wireName ?? command?.name ?? canonicalCommandName(typedToken);
  return `/${wireName}${argumentsText ? ` ${argumentsText}` : ''}`;
}

/**
 * OpenClaw persists the translated slash form in canonical history. Vimicate's
 * public command vocabulary is colon-prefixed and dash-normalized, so the wire
 * representation must stop at the history boundary instead of leaking into
 * the read-only transcript.
 */
export function displayedCommandTextFromWire(input: string) {
  const match = input.match(/^\/([a-z][a-z0-9_-]*)(?=$|\s)([\s\S]*)$/i);
  if (!match) return input;
  const command = canonicalCommandName(match[1] ?? '');
  return command ? `:${command}${match[2] ?? ''}` : input;
}

function record(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value); }
function text(value: unknown) { return typeof value === 'string' ? value : ''; }
function canonicalCommandName(value: string) { return value.trim().replace(/^[:/]/, '').replace(/_/g, '-').toLocaleLowerCase(); }
