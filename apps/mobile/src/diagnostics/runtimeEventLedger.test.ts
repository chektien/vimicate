import { beforeEach, expect, it, vi } from 'vitest';

const storage = vi.hoisted(() => ({ values: new Map<string, string>(), failLoads: 0, failSaves: 0, saveCalls: 0, gate: null as null | Promise<void> }));
vi.mock('../storage/workspaceStore', () => ({
  loadValue: async (key: string) => { if (storage.failLoads > 0) { storage.failLoads -= 1; throw new Error('database busy'); } return storage.values.get(key) ?? null; },
  saveValue: async (key: string, value: string) => {
    storage.saveCalls += 1;
    if (storage.gate) await storage.gate;
    if (storage.failSaves > 0) { storage.failSaves -= 1; throw new Error('write failed'); }
    storage.values.set(key, value);
  },
}));

beforeEach(() => { vi.resetModules(); storage.values.clear(); storage.failLoads = 0; storage.failSaves = 0; storage.saveCalls = 0; storage.gate = null; });
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

it('keeps events through a transient first load failure and persists them on the next write', async () => {
  storage.failLoads = 1;
  const ledger = await import('./runtimeEventLedger');
  ledger.recordRuntimeEvent('launch', '', 1_700_000_000_001);
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(stored()).toEqual([]);
  ledger.recordRuntimeEvent('foreground', '', 1_700_000_000_002);
  await vi.waitFor(() => expect(stored()).toEqual(['1700000000001 launch', '1700000000002 foreground']));
});

it('keeps an event recorded while an earlier save is still writing', async () => {
  let release!: () => void; storage.gate = new Promise(resolve => { release = resolve; });
  const ledger = await import('./runtimeEventLedger');
  ledger.recordRuntimeEvent('launch', '', 1_700_000_000_001);
  await new Promise(resolve => setTimeout(resolve, 0));
  ledger.recordRuntimeEvent('background', '', 1_700_000_000_002);
  storage.gate = null; release();
  await vi.waitFor(() => expect(stored()).toEqual(['1700000000001 launch', '1700000000002 background']));
});

it.each([false, true])('retains the newest bounded events when an in-flight save overflows pending, failed=%s', async (fail) => {
  let release!: () => void;
  storage.gate = new Promise(resolve => { release = resolve; });
  storage.failSaves = fail ? 1 : 0;
  const ledger = await import('./runtimeEventLedger');
  for (let i = 0; i < 40; i++) ledger.recordRuntimeEvent('foreground', '', 1_700_000_000_000 + i);
  await vi.waitFor(() => expect(storage.saveCalls).toBe(1));
  for (let i = 40; i < 85; i++) ledger.recordRuntimeEvent('foreground', '', 1_700_000_000_000 + i);
  const expected = Array.from({ length: 40 }, (_, i) => `${1_700_000_000_045 + i} foreground`);
  expect(await ledger.runtimeEventLines()).toEqual(expected);
  storage.gate = null;
  release();
  await vi.waitFor(() => expect(stored()).toEqual(expected));
  vi.resetModules();
  expect(await (await import('./runtimeEventLedger')).runtimeEventLines()).toEqual(expected);
});

it('restores a failed in-flight batch before newer pending events', async () => {
  let release!: () => void;
  storage.gate = new Promise(resolve => { release = resolve; });
  storage.failSaves = 1;
  const ledger = await import('./runtimeEventLedger');
  ledger.recordRuntimeEvent('launch', '', 1_700_000_000_001);
  await vi.waitFor(() => expect(storage.saveCalls).toBe(1));
  ledger.recordRuntimeEvent('background', '', 1_700_000_000_002);
  const expected = ['1700000000001 launch', '1700000000002 background'];
  expect(await ledger.runtimeEventLines()).toEqual(expected);
  storage.gate = null;
  release();
  await vi.waitFor(() => expect(stored()).toEqual(expected));
});

it('reads a coherent snapshot when the save settles between snapshot awaits', async () => {
  let release!: () => void;
  storage.gate = new Promise(resolve => { release = resolve; });
  const ledger = await import('./runtimeEventLedger');
  ledger.recordRuntimeEvent('launch', '', 1_700_000_000_001);
  await vi.waitFor(() => expect(storage.saveCalls).toBe(1));
  storage.gate = null; release();
  expect(await ledger.runtimeEventLines()).toEqual(['1700000000001 launch']);
});
