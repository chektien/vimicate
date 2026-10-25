import { afterAll, describe, expect, it, vi } from 'vitest';
// @ts-expect-error Node built-in types are intentionally absent from the app tsconfig.
import { mkdtempSync, rmSync } from 'node:fs';
// @ts-expect-error Node built-in types are intentionally absent from the app tsconfig.
import { tmpdir } from 'node:os';
// @ts-expect-error Node built-in types are intentionally absent from the app tsconfig.
import { join } from 'node:path';
// @ts-expect-error Node built-in types are intentionally absent from the app tsconfig.
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';

const directory = mkdtempSync(join(tmpdir(), 'vimicate-command-history-'));
const databasePath = join(directory, 'workspace.db');

class AsyncExpoSQLiteAdapter {
  private readonly database = new DatabaseSync(databasePath);
  private closed = false;

  async execAsync(sql: string) { this.database.exec(sql); }
  async getFirstAsync<T>(sql: string, ...parameters: SQLInputValue[]) {
    return (this.database.prepare(sql).get(...parameters) ?? null) as T | null;
  }
  async getAllAsync<T>(sql: string, ...parameters: SQLInputValue[]) {
    return this.database.prepare(sql).all(...parameters) as T[];
  }
  async runAsync(sql: string, ...parameters: SQLInputValue[]) {
    const result = this.database.prepare(sql).run(...parameters);
    return { changes: Number(result.changes), lastInsertRowId: Number(result.lastInsertRowid) };
  }
  count(sql: string) { return Number((this.database.prepare(sql).get() as { count: number }).count); }
  close() { if (!this.closed) { this.database.close(); this.closed = true; } }
}

const connections: AsyncExpoSQLiteAdapter[] = [];
vi.mock('expo-sqlite', () => ({
  openDatabaseAsync: async () => {
    const connection = new AsyncExpoSQLiteAdapter();
    connections.push(connection);
    return connection;
  },
}));
vi.mock('../../modules/vimicate-persistence-activity', () => ({
  withPersistenceActivity: async (task: () => Promise<void>) => task(),
}));

afterAll(() => {
  connections.forEach((connection) => connection.close());
  rmSync(directory, { recursive: true, force: true });
});

describe('workspace command-history persistence', () => {
  it('executes the production SQL across a real SQLite close and reopen', async () => {
    const firstLifetime = await import('./workspaceStore');
    firstLifetime.setWorkspacePersistenceActive(true);
    for (let index = 0; index < 110; index++) await firstLifetime.appendCommandHistory(`command ${index}`);
    await firstLifetime.appendCommandHistory('command 109');
    expect(connections.at(-1)?.count('SELECT COUNT(*) AS count FROM command_history')).toBe(100);

    connections.at(-1)?.close();
    vi.resetModules();
    const relaunched = await import('./workspaceStore');
    relaunched.setWorkspacePersistenceActive(true);
    const restored = await relaunched.loadCommandHistory();

    expect(connections).toHaveLength(2);
    expect(restored).toHaveLength(100);
    expect(restored[0]).toBe('command 10');
    expect(restored.at(-1)).toBe('command 109');
    expect(connections.at(-1)?.count('SELECT COUNT(*) AS count FROM command_history')).toBe(100);
  });
});
