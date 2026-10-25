import type { CommandCompletionState } from '../gateway/commandCompletion';

export type CommandHistorySelection = { history?: { index: number; draft: string } | undefined };

const COMMAND_HISTORY_LIMIT = 100;
const COMMAND_HISTORY_ENTRY_LIMIT = 4096;

function normalizedCommand(query: unknown) {
  if (typeof query !== 'string') return null;
  const command = query.trim();
  return command && command.length <= COMMAND_HISTORY_ENTRY_LIMIT ? command : null;
}

export function recordCommand(history: readonly string[], query: string): string[] {
  const command = normalizedCommand(query);
  if (!command || history.at(-1) === command) return [...history];
  return [...history.slice(-(COMMAND_HISTORY_LIMIT - 1)), command];
}

export function normalizedCommandHistory(entries: readonly unknown[]) {
  return entries.reduce<string[]>((history, entry) => {
    const command = normalizedCommand(entry);
    return command ? recordCommand(history, command) : history;
  }, []);
}

type PendingCommandWrite = { command: string; resolve: () => void; reject: (error: unknown) => void };

export class CommandHistoryOwner {
  readonly historyRef = { current: [] as string[] };
  private hydration: Promise<void> | null = null;
  private phase: 'waiting' | 'hydrating' | 'ready' | 'degraded' = 'waiting';
  private readonly pendingWrites: PendingCommandWrite[] = [];
  private draining = false;

  constructor(
    private readonly load: () => Promise<readonly unknown[]>,
    private readonly append: (command: string) => Promise<void>,
  ) {}

  hydrate() {
    if (this.hydration) return this.hydration;
    this.phase = 'hydrating';
    this.hydration = this.load().then((entries) => {
      this.historyRef.current = normalizedCommandHistory([...entries, ...this.historyRef.current]);
      this.phase = 'ready';
      void this.drainWrites();
    }).catch((error: unknown) => {
      this.phase = 'degraded';
      void this.drainWrites();
      throw error;
    });
    return this.hydration;
  }

  record(query: string) {
    const command = normalizedCommand(query);
    if (!command) return null;
    this.historyRef.current = recordCommand(this.historyRef.current, command);
    const write = new Promise<void>((resolve, reject) => { this.pendingWrites.push({ command, resolve, reject }); });
    if (this.phase === 'waiting') void this.hydrate().catch(() => undefined);
    if (this.phase === 'ready' || this.phase === 'degraded') void this.drainWrites();
    return write;
  }

  private async drainWrites() {
    if (this.draining || (this.phase !== 'ready' && this.phase !== 'degraded')) return;
    this.draining = true;
    try {
      while (this.pendingWrites.length) {
        const pending = this.pendingWrites.shift()!;
        try { await this.append(pending.command); pending.resolve(); }
        catch (error) { pending.reject(error); }
      }
    } finally {
      this.draining = false;
      if (this.pendingWrites.length) void this.drainWrites();
    }
  }
}

export function recallCommand<T extends CommandCompletionState & CommandHistorySelection>(entries: readonly string[], state: T, direction: -1 | 1): T {
  if (!entries.length || (!state.history && direction === 1)) return state;
  const current = state.history?.index ?? entries.length;
  const index = Math.max(0, Math.min(entries.length, current + direction));
  if (index === current) return state;
  const draft = state.history?.draft ?? state.query;
  return { ...state, query: index === entries.length ? draft : entries[index]!,
    history: index === entries.length ? undefined : { index, draft },
    cursor: undefined, completion: undefined, completionNotice: undefined };
}
