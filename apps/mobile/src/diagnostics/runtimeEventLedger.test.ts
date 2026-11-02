import { beforeEach, expect, it, vi } from 'vitest';

const storage = vi.hoisted(() => ({ values: new Map<string, string>() }));
vi.mock('../storage/workspaceStore', () => ({
  loadValue: async (key: string) => storage.values.get(key) ?? null,
  saveValue: async (key: string, value: string) => { storage.values.set(key, value); },
}));

beforeEach(() => { vi.resetModules(); storage.values.clear(); });
const stored = () => JSON.parse(storage.values.get('diagnostics.runtimeEvents.v1') ?? '[]') as string[];
const settle = (count: number) => vi.waitFor(() => expect(stored().length).toBe(count));

it('persists bounded, redacted events across a simulated relaunch and renders them in SGT', async () => {
  const first = await import('./runtimeEventLedger');
  first.recordRuntimeEvent('launch', '', Date.UTC(2026, 10, 1, 8, 57, 40));
  first.recordRuntimeEvent('socket-closed', 'code=1006 clean=false while connected reason=from me@example.com', Date.UTC(2026, 10, 1, 8, 57, 41));
  await settle(2);
  vi.resetModules();
  const relaunched = await import('./runtimeEventLedger');
  relaunched.recordRuntimeEvent('memory-warning', '', Date.UTC(2026, 10, 1, 9, 0, 0));
  await settle(3);
  expect(relaunched.runtimeEventText(await relaunched.runtimeEventLines())).toBe([
    'runtime events (persisted across launches, SGT, oldest to newest)',
    '2026-11-01 16:57:40 SGT launch',
    '2026-11-01 16:57:41 SGT socket-closed code=1006 clean=false while connected reason=from <email>',
    '2026-11-01 17:00:00 SGT memory-warning',
  ].join('\n'));
});

it('keeps only the newest 40 events and tolerates corrupt storage', async () => {
  storage.values.set('diagnostics.runtimeEvents.v1', '{not json');
  const ledger = await import('./runtimeEventLedger');
  for (let i = 0; i < 45; i++) ledger.recordRuntimeEvent('foreground', '', 1_700_000_000_000 + i);
  await vi.waitFor(() => expect(stored().at(-1)).toBe('1700000000044 foreground'));
  const lines = await ledger.runtimeEventLines();
  expect(lines).toHaveLength(40);
  expect(lines[0]).toBe('1700000000005 foreground');
  expect(ledger.runtimeEventText([])).toContain('(none)');
});
