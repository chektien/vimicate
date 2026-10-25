import { expect, it, vi } from 'vitest';
import { SessionRefreshOwner, type SessionRefreshIntent } from './sessionRefreshOwner';
const deferred = () => { let resolve!: () => void; let reject!: (error: Error) => void; const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const intent = (patch: Partial<SessionRefreshIntent> = {}): SessionRefreshIntent => ({ refreshRegistry: false, requireRegistry: false, preferredKey: '', selectionKey: 'a', hydrateSelected: false, requiredHistory: new Map(), ...patch });
const scope = (connection = 1, controller = new AbortController()) => ({ connection, signal: controller.signal, historyGeneration: (key: string) => `${key}-generation` });
const drain = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };

it('merges all successor authority without ever joining a pre-event observation', async () => {
  const owner = new SessionRefreshOwner(); const active = deferred(); const trailing = deferred();
  const generation = scope(); const runs: SessionRefreshIntent[] = [];
  const execute = vi.fn(async (value: SessionRefreshIntent) => { runs.push(value); await (runs.length === 1 ? active : trailing).promise; });
  const first = owner.request(intent(), generation, execute);
  let settled = false;
  const second = owner.request(intent({ refreshRegistry: true, requiredHistory: new Map([['a', 'a-generation']]) }), generation, execute).then(() => { settled = true; });
  const third = owner.request(intent({ requireRegistry: true, hydrateSelected: true, preferredKey: 'b', requiredHistory: new Map([['b', 'b-generation']]) }), generation, execute);
  for (let i = 0; i < 100; i++) void owner.request(intent(), generation, execute);
  expect(execute).toHaveBeenCalledTimes(1);
  active.resolve(); await first; await drain();
  expect(settled).toBe(false); expect(execute).toHaveBeenCalledTimes(2);
  expect(runs[1]).toEqual(intent({ refreshRegistry: true, requireRegistry: true, hydrateSelected: true, preferredKey: 'b', requiredHistory: new Map([['a', 'a-generation'], ['b', 'b-generation']]) }));
  trailing.resolve(); await Promise.all([second, third]); expect(settled).toBe(true);
});

it('starts one further fresh read for arrivals during the trailing observation', async () => {
  const owner = new SessionRefreshOwner(); const generation = scope(); const first = deferred(); const second = deferred();
  const execute = vi.fn().mockImplementationOnce(() => first.promise).mockImplementationOnce(() => second.promise).mockResolvedValue(undefined);
  void owner.request(intent(), generation, execute); void owner.request(intent(), generation, execute);
  first.resolve(); await drain();
  for (let i = 0; i < 50; i++) void owner.request(intent(), generation, execute);
  expect(execute).toHaveBeenCalledTimes(2); second.resolve(); await drain(); expect(execute).toHaveBeenCalledTimes(3);
});

it('preserves strict failure only for strict callers and recovers a queued successor', async () => {
  const owner = new SessionRefreshOwner(); const generation = scope(); const first = deferred(); const next = deferred();
  const execute = vi.fn().mockImplementationOnce(() => first.promise).mockImplementationOnce(() => next.promise).mockResolvedValue(undefined);
  const strict = owner.request(intent({ requireRegistry: true }), generation, execute).catch(error => error.message);
  const ordinary = owner.request(intent(), generation, execute);
  first.reject(new Error('registry unavailable')); await expect(strict).resolves.toBe('registry unavailable'); await drain();
  expect(execute).toHaveBeenCalledTimes(2);
  const strictNext = owner.request(intent({ requireRegistry: true }), generation, async () => { throw new Error('strict successor'); }).catch(error => error.message);
  const ordinaryNext = owner.request(intent(), generation, async () => { throw new Error('strict successor'); });
  next.resolve(); await ordinary;
  await expect(strictNext).resolves.toBe('strict successor'); await expect(ordinaryNext).resolves.toBeUndefined();
  await owner.request(intent(), generation, execute); expect(execute).toHaveBeenCalledTimes(3);
});

it.each(['abort', 'connection', 'clear'] as const)('retires active and pending ownership on %s, including late failure', async reason => {
  const owner = new SessionRefreshOwner(); const controller = new AbortController(); const old = deferred(); const generation = scope(1, controller);
  let owns!: () => boolean;
  const execute = vi.fn(async (_intent: SessionRefreshIntent, isCurrent: () => boolean) => { owns = isCurrent; await old.promise; });
  const first = owner.request(intent(), generation, execute); const pending = owner.request(intent(), generation, execute);
  const fresh = vi.fn(async () => {});
  if (reason === 'abort') controller.abort(); else if (reason === 'clear') owner.clear();
  else await owner.request(intent(), scope(2), fresh);
  expect(owns()).toBe(false); await Promise.all([first, pending]);
  old.reject(new Error('retired failure')); await drain(); expect(execute).toHaveBeenCalledOnce();
  await owner.request(intent(), scope(3), fresh); expect(fresh).toHaveBeenCalledTimes(reason === 'connection' ? 2 : 1);
});

it('does not retain forced history intents for disposed routes or superseded generations', async () => {
  const owner = new SessionRefreshOwner(); const active = deferred(); const generation = scope();
  const execute = vi.fn().mockImplementationOnce(() => active.promise).mockResolvedValue(undefined);
  void owner.request(intent(), generation, execute);
  void owner.request(intent({ requiredHistory: new Map([['a', 'a-generation'], ['gone', 'gone-generation']]) }), generation, execute);
  void owner.request(intent({ requiredHistory: new Map([['a', 'a-successor']]) }), { ...generation, historyGeneration: key => key === 'a' ? 'a-successor' : undefined }, execute);
  active.resolve(); await drain();
  expect(execute.mock.calls[1]![0].requiredHistory).toEqual(new Map([['a', 'a-successor']]));
});

it.each(['active', 'pending'] as const)('rejects a strict %s batch on retirement instead of manufacturing authoritative success', async position => {
  const owner = new SessionRefreshOwner(); const old = deferred(); const generation = scope();
  const execute = vi.fn(() => old.promise);
  let cancelled: Promise<unknown>;
  if (position === 'active') cancelled = owner.request(intent({ requireRegistry: true }), generation, execute).catch(error => error.message);
  else {
    void owner.request(intent(), generation, execute);
    cancelled = owner.request(intent({ requireRegistry: true }), generation, execute).catch(error => error.message);
  }
  const ordinary = owner.request(intent(), generation, execute);
  owner.clear(); await expect(cancelled).resolves.toBe('Project refresh retired before completion');
  await expect(ordinary).resolves.toBeUndefined(); old.resolve(); await drain(); expect(execute).toHaveBeenCalledOnce();
});
