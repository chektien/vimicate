import { describe, expect, it } from 'vitest';
import { GatewayReconnectLadder, RECONNECT_STABLE_CONNECTION_MS, reconnectDelayMs, shouldReconnect } from './reconnectPolicy';

function ladderAt(clock: { now: number }) {
  return new GatewayReconnectLadder(() => clock.now);
}


describe('gateway reconnect policy', () => {
  it('backs off quickly and caps at thirty seconds', () => {
    expect([0, 1, 2, 3, 4, 5, 6, 20].map(reconnectDelayMs)).toEqual([500, 1_000, 2_000, 4_000, 8_000, 15_000, 30_000, 30_000]);
  });

  it('only retries a dropped or failed enabled profile while active', () => {
    expect(shouldReconnect('disconnected', true, true, true)).toBe(true);
    expect(shouldReconnect('error', true, true, true)).toBe(true);
    expect(shouldReconnect('connected', true, true, true)).toBe(false);
    expect(shouldReconnect('disconnected', false, true, true)).toBe(false);
    expect(shouldReconnect('disconnected', true, false, true)).toBe(false);
    expect(shouldReconnect('disconnected', true, true, false)).toBe(false);
  });

  it('escalates a connection that keeps dropping before it has held', () => {
    const clock = { now: 0 };
    const ladder = ladderAt(clock);
    const delays: number[] = [];
    for (let cycle = 0; cycle < 7; cycle += 1) {
      delays.push(ladder.delayMs() as number);
      ladder.attempted();
      ladder.connected();
      clock.now += 4_000;
      ladder.dropped();
    }
    expect(delays).toEqual([500, 1_000, 2_000, 4_000, 8_000, 15_000, 30_000]);
  });

  it('returns to the floor once a connection has held', () => {
    const clock = { now: 0 };
    const ladder = ladderAt(clock);
    ladder.attempted();
    ladder.attempted();
    ladder.attempted();
    ladder.connected();
    clock.now += RECONNECT_STABLE_CONNECTION_MS;
    ladder.dropped();
    expect(ladder.delayMs()).toBe(500);
  });

  it('does not credit a drop that never reached a connection', () => {
    const clock = { now: 0 };
    const ladder = ladderAt(clock);
    ladder.attempted();
    clock.now += RECONNECT_STABLE_CONNECTION_MS;
    ladder.dropped();
    expect(ladder.delayMs()).toBe(1_000);
  });

  it('restores the floor for deliberate operator intent', () => {
    const ladder = new GatewayReconnectLadder(() => 0);
    ladder.attempted(); ladder.attempted();
    ladder.reset();
    expect(ladder.delayMs()).toBe(500);
  });
});
