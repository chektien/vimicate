import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { SceneSocketGrace } from './sceneSocketGrace';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());
const client = () => ({ status: 'connected', connectionRevision: 3, catalogEventRevision: 7 });

it('keeps the socket through a short inactive interruption and reports missed catalog changes', () => {
  const grace = new SceneSocketGrace(); const disconnect = vi.fn(); const live = client();
  grace.suspend('inactive', live, disconnect);
  vi.advanceTimersByTime(29_000);
  expect(disconnect).not.toHaveBeenCalled();
  expect(grace.resume(live)).toEqual({ kept: true, catalogChanged: false });
  vi.advanceTimersByTime(60_000); expect(disconnect).not.toHaveBeenCalled();
  grace.suspend('inactive', live, disconnect); live.catalogEventRevision = 8;
  expect(grace.resume(live)).toEqual({ kept: true, catalogChanged: true });
});

it('disconnects at grace expiry, on background, and immediately for non-inactive or unconnected suspension', () => {
  const grace = new SceneSocketGrace(); const disconnect = vi.fn();
  grace.suspend('inactive', client(), disconnect);
  vi.advanceTimersByTime(30_000); expect(disconnect).toHaveBeenCalledOnce();
  expect(grace.resume(client())).toEqual({ kept: false });
  grace.suspend('inactive', client(), disconnect); grace.release(); expect(disconnect).toHaveBeenCalledTimes(2);
  grace.suspend('background', client(), disconnect); expect(disconnect).toHaveBeenCalledTimes(3);
  grace.suspend('inactive', { ...client(), status: 'disconnected' }, disconnect); expect(disconnect).toHaveBeenCalledTimes(4);
  grace.release(); expect(disconnect).toHaveBeenCalledTimes(4);
});

it('requires a fresh connection when the socket was replaced or dropped during the grace period', () => {
  const grace = new SceneSocketGrace(); const disconnect = vi.fn(); const live = client();
  grace.suspend('inactive', live, disconnect); live.connectionRevision = 4;
  expect(grace.resume(live)).toEqual({ kept: false });
  grace.suspend('inactive', client(), disconnect);
  expect(grace.resume({ ...client(), status: 'disconnected' })).toEqual({ kept: false });
  expect(disconnect).not.toHaveBeenCalled();
});
