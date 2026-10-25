import { describe, expect, it } from 'vitest';
import { CommandHistoryOwner, normalizedCommandHistory, recordCommand, recallCommand } from './commandHistory';

describe('colon command history', () => {
  it('recalls in order, stops at the oldest, and restores unfinished input', () => {
    const history = ['status', 'model example/model'];
    let state = { query: 'update-', softwareKeyboardEnabled: false };
    state = recallCommand(history, state, -1);
    expect(state.query).toBe('model example/model');
    state = recallCommand(history, state, -1);
    expect(state.query).toBe('status');
    expect(recallCommand(history, state, -1)).toEqual(state);
    state = recallCommand(history, state, 1);
    expect(state.query).toBe('model example/model');
    state = recallCommand(history, state, 1);
    expect(state.query).toBe('update-');
    expect(recallCommand(history, state, 1)).toEqual(state);
    expect(state.softwareKeyboardEnabled).toBe(false);
  });
  it('bounds submitted history and skips blanks and consecutive duplicates', () => {
    let history: string[] = [];
    for (let i = 0; i < 110; i++) history = recordCommand(history, `command ${i}`);
    expect(history).toHaveLength(100);
    expect(history[0]).toBe('command 10');
    expect(recordCommand(history, '  command 109  ')).toEqual(history);
    expect(recordCommand(history, '   ')).toEqual(history);
    expect(recordCommand(history, 'x'.repeat(4097))).toEqual(history);
    expect(recordCommand(history, 'command 10').at(-1)).toBe('command 10');
  });
  it('does nothing without history and clears stale completion on recall', () => {
    const state = { query: 'sta', cursor: 0, completionNotice: 'old', completion: undefined };
    expect(recallCommand([], state, -1)).toBe(state);
    expect(recallCommand(['status'], state, -1)).toMatchObject({ query: 'status', cursor: undefined, completionNotice: undefined });
  });

  it('sanitizes malformed durable rows and retains only the newest 100 valid commands', () => {
    const stored: unknown[] = [null, '', 'same', 'same', 'x'.repeat(4097), 42];
    for (let index = 0; index < 105; index++) stored.push(`command ${index}`);
    const history = normalizedCommandHistory(stored);
    expect(history).toHaveLength(100);
    expect(history[0]).toBe('command 5');
    expect(history.at(-1)).toBe('command 104');
  });

  it('merges commands recorded during hydration and writes each accepted submission immediately', async () => {
    let resolveLoad: ((history: unknown[]) => void) | undefined;
    const writes: string[] = [];
    const owner = new CommandHistoryOwner(
      () => new Promise((resolve) => { resolveLoad = resolve; }),
      async (command) => { writes.push(command); },
    );
    const hydration = owner.hydrate();
    const firstWrite = owner.record('new-thread Notes');
    const secondWrite = owner.record('status');
    expect(writes).toEqual([]);
    resolveLoad?.(['new-thread Notes', 'status']);
    await hydration;
    await Promise.all([firstWrite, secondWrite]);

    expect(writes).toEqual(['new-thread Notes', 'status']);
    expect(owner.historyRef.current).toEqual(['new-thread Notes', 'status', 'new-thread Notes', 'status']);
  });

  it('preserves a legitimate repeated command sequence across the hydration boundary', async () => {
    let releaseLoad: ((history: unknown[]) => void) | undefined;
    const owner = new CommandHistoryOwner(
      () => new Promise((resolve) => { releaseLoad = resolve; }),
      async () => undefined,
    );
    const hydration = owner.hydrate();
    const writes = [owner.record('a'), owner.record('b')];
    releaseLoad?.(['a', 'b']);
    await hydration;
    await Promise.all(writes);
    expect(owner.historyRef.current).toEqual(['a', 'b', 'a', 'b']);
  });

  it('coalesces duplicate hydration and drains recorded writes after a failed load', async () => {
    let attempts = 0;
    const writes: string[] = [];
    const owner = new CommandHistoryOwner(async () => {
      attempts += 1;
      throw new Error('read failed');
    }, async (command) => { writes.push(command); });

    const write = owner.record('status');
    const first = owner.hydrate();
    expect(owner.hydrate()).toBe(first);
    await expect(first).rejects.toThrow('read failed');
    await write;
    expect(attempts).toBe(1);
    expect(writes).toEqual(['status']);
    expect(owner.historyRef.current).toEqual(['status']);
  });

  it('retains local recall after a failed write and continues later queued writes', async () => {
    let attempts = 0;
    const owner = new CommandHistoryOwner(async () => [], async () => {
      attempts += 1;
      if (attempts === 1) throw new Error('write failed');
    });

    await owner.hydrate();
    const failed = owner.record('status');
    const following = owner.record('model openai/gpt-6');
    await expect(failed).rejects.toThrow('write failed');
    await following;
    expect(attempts).toBe(2);
    expect(owner.historyRef.current).toEqual(['status', 'model openai/gpt-6']);
  });

  it('restores a bounded durable history in a new app-shell lifetime without executing it', async () => {
    let durable: string[] = [];
    const append = async (command: string) => { durable = recordCommand(durable, command); };
    const first = new CommandHistoryOwner(async () => durable, append);
    for (let index = 0; index < 110; index++) await first.record(`command ${index}`);

    const relaunched = new CommandHistoryOwner(async () => durable, append);
    await relaunched.hydrate();
    expect(relaunched.historyRef.current).toHaveLength(100);
    expect(recallCommand(relaunched.historyRef.current, { query: 'draft' }, -1).query).toBe('command 109');
    expect(durable[0]).toBe('command 10');
  });
});
