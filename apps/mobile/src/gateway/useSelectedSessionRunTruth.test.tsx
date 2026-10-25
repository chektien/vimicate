// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { useSelectedSessionRunTruth } from './useSelectedSessionRunTruth';
import { HistoryPublicationAuthority } from './historyPublicationAuthority';
import { SessionRunRegistry } from './sessionRunRegistry';

it.each(['follow', 'truth', 'current'] as const)('publishes selected run truth only for its retained generation at %s', async boundary => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const root = createRoot(document.createElement('div'));
  const registry = { current: new SessionRunRegistry() }; const scene = { current: new HistoryPublicationAuthority() };
  let complete!: () => void; const held = new Promise<void>(resolve => { complete = resolve; });
  const persist = vi.fn(); const publish = vi.fn(); let ownsGeneration = true;
  const client = {
    status: 'connected', connectionRevision: 1,
    followSession: vi.fn(async () => { if (boundary === 'follow') await held; }),
    readSessionRunTruth: vi.fn(async () => { if (boundary !== 'follow') await held; return { session: { key: 'a', hasActiveRun: true, activeRunId: 'observed-run' } }; }),
  };
  let refresh!: ReturnType<typeof useSelectedSessionRunTruth>;
  function Component() { refresh = useSelectedSessionRunTruth(client as never, registry, persist, publish, scene); return null; }
  try {
    await act(async () => root.render(<Component />));
    const request = refresh('a', true, () => ownsGeneration);
    await act(async () => { await Promise.resolve(); ownsGeneration = boundary === 'current'; complete(); await request; });
    if (boundary === 'current') {
      expect(registry.current.runFor('a')).toBe('observed-run'); expect(persist).toHaveBeenCalledOnce(); expect(publish).toHaveBeenCalledWith('a');
    } else {
      expect(registry.current.runFor('a')).toBe(''); expect(persist).not.toHaveBeenCalled(); expect(publish).not.toHaveBeenCalled();
      if (boundary === 'follow') expect(client.readSessionRunTruth).not.toHaveBeenCalled();
    }
  } finally { await act(async () => root.unmount()); vi.unstubAllGlobals(); }
});

it('bounds rapid selected run reads to one in flight and the latest selection', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const root = createRoot(document.createElement('div'));
  const registry = { current: new SessionRunRegistry() }; const scene = { current: new HistoryPublicationAuthority() };
  let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
  const persist = vi.fn(); const publish = vi.fn();
  const client = {
    status: 'connected', connectionRevision: 1, followSession: vi.fn(async () => {}),
    readSessionRunTruth: vi.fn(async (key: string) => { await gate; return { session: { key, hasActiveRun: true, activeRunId: `run-${key}` } }; }),
  };
  let refresh!: ReturnType<typeof useSelectedSessionRunTruth>;
  function Component() { refresh = useSelectedSessionRunTruth(client as never, registry, persist, publish, scene); return null; }
  const requests: Promise<void>[] = [];
  try {
    await act(async () => root.render(<Component />));
    await act(async () => { requests.push(refresh('first')); await Promise.resolve(); });
    await act(async () => { for (let index = 0; index < 40; index += 1) requests.push(refresh(`selection-${index}`)); });
    expect(client.readSessionRunTruth).toHaveBeenCalledTimes(1);
    await act(async () => { release(); await Promise.all(requests); });
    expect(client.readSessionRunTruth.mock.calls.map(([key]) => key)).toEqual(['first', 'selection-39']);
    expect(registry.current.runFor('first')).toBe('');
    expect(registry.current.runFor('selection-39')).toBe('run-selection-39');
    expect(publish).toHaveBeenCalledExactlyOnceWith('selection-39');
    expect(persist).toHaveBeenCalledOnce();
  } finally { release(); await Promise.allSettled(requests); await act(async () => root.unmount()); vi.unstubAllGlobals(); }
});

async function harness(read: (key: string) => Promise<{ session: { key: string; hasActiveRun: boolean; activeRunId: string } }>) {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const root = createRoot(document.createElement('div'));
  const registry = { current: new SessionRunRegistry() }; const scene = { current: new HistoryPublicationAuthority() };
  const publish = vi.fn(); const persist = vi.fn();
  const client = { status: 'connected', connectionRevision: 1, followSession: vi.fn(async () => {}), readSessionRunTruth: vi.fn(read) };
  let refresh!: ReturnType<typeof useSelectedSessionRunTruth>;
  function Component() { refresh = useSelectedSessionRunTruth(client as never, registry, persist, publish, scene); return null; }
  await act(async () => root.render(<Component />));
  return { client, registry, scene, publish, persist, refresh, unmount: async () => { await act(async () => root.unmount()); vi.unstubAllGlobals(); } };
}
const active = (key: string) => ({ session: { key, hasActiveRun: true, activeRunId: `run-${key}` } });

it.each(['scene', 'connection'] as const)('admits a new %s without publishing or waiting for retired reads', async boundary => {
  let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
  const h = await harness(async key => { if (key === 'old') await gate; return active(key); });
  try {
    const old = h.refresh('old'); await act(async () => { await Promise.resolve(); });
    if (boundary === 'scene') { h.scene.current.suspend(); h.scene.current.resume(); }
    else h.client.connectionRevision += 1;
    await act(async () => { await h.refresh('new'); });
    expect(h.registry.current.runFor('new')).toBe('run-new');
    await act(async () => { release(); await old; });
    expect(h.registry.current.runFor('old')).toBe('');
    expect(h.publish).toHaveBeenCalledExactlyOnceWith('new');
  } finally { release(); await h.unmount(); }
});

it('drops a queued read and every publication after unmount', async () => {
  let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
  const h = await harness(async key => { await gate; return active(key); });
  const first = h.refresh('first'); await act(async () => { await Promise.resolve(); });
  const last = h.refresh('last');
  await h.unmount(); release(); await Promise.all([first, last]);
  await h.refresh('after-disposal');
  expect(h.client.readSessionRunTruth).toHaveBeenCalledTimes(1);
  expect(h.publish).not.toHaveBeenCalled(); expect(h.persist).not.toHaveBeenCalled();
});

it('continues to the latest intent after an obsolete read fails', async () => {
  let reject!: (error: Error) => void; const gate = new Promise<void>((_, fail) => { reject = fail; });
  const h = await harness(async key => { if (key === 'old') await gate; return active(key); });
  try {
    const old = h.refresh('old'); await act(async () => { await Promise.resolve(); });
    const latest = h.refresh('latest');
    await act(async () => { reject(new Error('obsolete transport error')); await Promise.all([old, latest]); });
    expect(h.publish).toHaveBeenCalledExactlyOnceWith('latest');
    expect(h.client.readSessionRunTruth.mock.calls.map(([key]) => key)).toEqual(['old', 'latest']);
  } finally { await h.unmount(); }
});

it('rejects a current read failure and permits an explicit retry', async () => {
  const h = await harness(async key => active(key));
  h.client.readSessionRunTruth.mockRejectedValueOnce(new Error('current transport error'));
  try {
    await expect(h.refresh('current')).rejects.toThrow('current transport error');
    expect(h.publish).not.toHaveBeenCalled();
    await act(async () => { await h.refresh('current'); });
    expect(h.publish).toHaveBeenCalledExactlyOnceWith('current');
  } finally { await h.unmount(); }
});

it('retains a pending census subscription requirement for the latest selection', async () => {
  const h = await harness(async key => active(key));
  try {
    await act(async () => { const first = h.refresh('first', true); const latest = h.refresh('latest'); await Promise.all([first, latest]); });
    expect(h.client.followSession).toHaveBeenCalledExactlyOnceWith('latest');
    expect(h.client.readSessionRunTruth).toHaveBeenCalledExactlyOnceWith('latest');
    expect(h.publish).toHaveBeenCalledExactlyOnceWith('latest');
  } finally { await h.unmount(); }
});
