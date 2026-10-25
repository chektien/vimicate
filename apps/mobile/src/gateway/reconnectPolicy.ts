import type { GatewayStatus } from './OpenClawClient';

const DELAYS_MS = [500, 1_000, 2_000, 4_000, 8_000, 15_000, 30_000] as const;

/**
 * A connection that is admitted and then dropped again before it has held this
 * long never carried the session. Counting it as a successful attempt pins the
 * backoff at its floor, so a Gateway that completes the handshake but cannot
 * keep the socket is re-established forever at that cadence.
 */
export const RECONNECT_STABLE_CONNECTION_MS = 30_000;

export function reconnectDelayMs(attempt: number) {
  return DELAYS_MS[Math.min(Math.max(0, attempt), DELAYS_MS.length - 1)];
}

export function shouldReconnect(status: GatewayStatus, enabled: boolean, appActive: boolean, hasProfile: boolean) {
  return enabled && appActive && hasProfile && (status === 'disconnected' || status === 'error');
}

/**
 * Owns the retry cadence of one workspace's Gateway connection. Reaching
 * `connected` is not evidence that the endpoint is usable; only a connection
 * that held for `RECONNECT_STABLE_CONNECTION_MS` retires the attempts its
 * predecessors earned.
 */
export class GatewayReconnectLadder {
  private attempts = 0;
  private connectedAtMs: number | null = null;

  constructor(private readonly now: () => number = Date.now) {}

  delayMs() { return reconnectDelayMs(this.attempts); }

  attempted() { this.attempts += 1; }

  connected() { this.connectedAtMs = this.now(); }

  dropped() {
    const connectedAtMs = this.connectedAtMs;
    this.connectedAtMs = null;
    if (connectedAtMs !== null && this.now() - connectedAtMs >= RECONNECT_STABLE_CONNECTION_MS) this.attempts = 0;
  }

  /** Pairing and `:reconnect` are fresh operator intent, not another retry. */
  reset() { this.attempts = 0; this.connectedAtMs = null; }
}
