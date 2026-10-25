import type { WorkspaceMessage } from '../workspace/workspaceTypes';
import { convergedLiveMessage } from './liveMessageConvergence';
import { upsertLiveMessage } from './gatewayEventProjection';
import { latestPresentationWindow, MAX_VISIBLE_HISTORY_ROWS } from './historyWindow';
import { launchGuardedBackgroundTask } from '../async/guardedBackgroundTask';

export const LIVE_MESSAGE_PUBLICATION_INTERVAL_MS = 180;
export const RICH_LIVE_MESSAGE_PUBLICATION_INTERVAL_MS = 500;
const MAX_PENDING_SESSIONS = 64;

/**
 * Gateway chat/tool frames are cumulative and can arrive far faster than an
 * iPad should redraw a rich transcript. Keep the latest value for each stable
 * row identity while retaining first-seen order, then publish one batch.
 */
export class LiveMessagePublicationBuffer {
  private static readonly MAX_SEEN_IDENTITIES = 2_048;
  private static readonly MAX_PENDING_IDENTITIES_PER_SESSION = MAX_VISIBLE_HISTORY_ROWS;
  private messages = new Map<string, WorkspaceMessage>();
  private pendingIdentitiesBySession = new Map<string, Set<string>>();
  private seen = new Set<string>();

  enqueue(message: WorkspaceMessage) {
    const identity = bufferedMessageIdentity(message);
    const first = !this.seen.has(identity);
    this.seen.add(identity);
    if (this.seen.size > LiveMessagePublicationBuffer.MAX_SEEN_IDENTITIES) this.seen.delete(this.seen.values().next().value ?? '');
    const previous = this.messages.get(identity);
    if (!previous) {
      const sessionKey = message.sessionKey ?? '';
      const pendingIdentities = this.pendingIdentitiesBySession.get(sessionKey) ?? new Set<string>();
      pendingIdentities.add(identity);
      this.pendingIdentitiesBySession.delete(sessionKey);
      this.pendingIdentitiesBySession.set(sessionKey, pendingIdentities);
      // A synchronous Gateway backlog can deliver thousands of distinct tool
      // rows before the 180/500 ms clock gets a turn. The eventual latest
      // presentation can expose at most this many one-row identities, so keep
      // that newest per-session suffix here instead of allocating rows that
      // the very next publication must discard. Other sessions retain their
      // own independent suffix and cumulative identities still converge.
      if (pendingIdentities.size > LiveMessagePublicationBuffer.MAX_PENDING_IDENTITIES_PER_SESSION) {
        const oldest = pendingIdentities.values().next().value;
        if (oldest !== undefined) {
          pendingIdentities.delete(oldest);
          this.messages.delete(oldest);
        }
      }
      // Global subscriptions may synchronously deliver one row for many
      // sessions before any per-session clock runs. Match the other process
      // transcript caches: older parked sessions fall back to canonical
      // history instead of retaining every live batch for the process burst.
      while (this.pendingIdentitiesBySession.size > MAX_PENDING_SESSIONS) {
        const oldestSessionKey = this.pendingIdentitiesBySession.keys().next().value;
        if (oldestSessionKey === undefined) break;
        const evicted = this.pendingIdentitiesBySession.get(oldestSessionKey);
        if (evicted) for (const evictedIdentity of evicted) this.messages.delete(evictedIdentity);
        this.pendingIdentitiesBySession.delete(oldestSessionKey);
      }
    } else {
      const sessionKey = message.sessionKey ?? '';
      const pendingIdentities = this.pendingIdentitiesBySession.get(sessionKey);
      if (pendingIdentities) {
        this.pendingIdentitiesBySession.delete(sessionKey);
        this.pendingIdentitiesBySession.set(sessionKey, pendingIdentities);
      }
    }
    this.messages.set(identity, previous ? convergedLiveMessage(previous, message) : message);
    return first;
  }
  drain() {
    const pending = [...this.messages.values()];
    this.messages.clear();
    this.pendingIdentitiesBySession.clear();
    return pending;
  }
  drainSession(sessionKey: string) {
    const pending: WorkspaceMessage[] = [];
    const identities = this.pendingIdentitiesBySession.get(sessionKey);
    if (!identities) return pending;
    for (const identity of identities) {
      const message = this.messages.get(identity);
      if (message) pending.push(message);
      this.messages.delete(identity);
    }
    this.pendingIdentitiesBySession.delete(sessionKey);
    return pending;
  }
  clear() { this.messages.clear(); this.pendingIdentitiesBySession.clear(); this.seen.clear(); }
  get size() { return this.messages.size; }
}

/** One coalescing clock per session prevents a late frame in B cancelling A. */
export class LiveMessagePublicationTimers {
  private timers = new Map<string, ReturnType<typeof setTimeout>>();

  schedule(sessionKey: string, delayMs: number, publish: () => void, onFailure: (error: unknown) => void = () => undefined) {
    if (!sessionKey) return false;
    const existing = this.timers.get(sessionKey);
    if (existing) {
      // Refresh session recency without extending its first-frame deadline.
      this.timers.delete(sessionKey);
      this.timers.set(sessionKey, existing);
      return false;
    }
    const timer = setTimeout(() => {
      this.timers.delete(sessionKey);
      launchGuardedBackgroundTask(publish, onFailure);
    }, delayMs);
    this.timers.set(sessionKey, timer);
    while (this.timers.size > MAX_PENDING_SESSIONS) {
      const oldestSessionKey = this.timers.keys().next().value;
      if (oldestSessionKey === undefined) break;
      const oldestTimer = this.timers.get(oldestSessionKey);
      if (oldestTimer) clearTimeout(oldestTimer);
      this.timers.delete(oldestSessionKey);
    }
    return true;
  }

  cancel(sessionKey: string) {
    const timer = this.timers.get(sessionKey);
    if (!timer) return false;
    clearTimeout(timer);
    this.timers.delete(sessionKey);
    return true;
  }

  cancelAll() {
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
  }

  has(sessionKey: string) { return this.timers.has(sessionKey); }
}

export function flushBufferedLiveMessages(
  buffer: LiveMessagePublicationBuffer,
  publish: (sessionKey: string, action: (current: WorkspaceMessage[]) => WorkspaceMessage[]) => void,
) {
  const batches = new Map<string, WorkspaceMessage[]>();
  for (const message of buffer.drain()) {
    if (!message.sessionKey) continue;
    const batch = batches.get(message.sessionKey) ?? [];
    batch.push(message); batches.set(message.sessionKey, batch);
  }
  for (const [sessionKey, messages] of batches) {
    publish(sessionKey, (current) => latestPresentationWindow(messages.reduce(upsertLiveMessage, current)));
  }
}

/**
 * A scene transition must not publish React or persistence work. Canonical
 * history is the recovery authority after reconnect, so buffered frames are
 * discarded together with every clock that could publish them later.
 */
export function suspendLiveMessagePublication(
  liveTimers: LiveMessagePublicationTimers,
  narrationTimers: LiveMessagePublicationTimers,
  buffer: LiveMessagePublicationBuffer,
) {
  liveTimers.cancelAll();
  narrationTimers.cancelAll();
  buffer.clear();
}

export function requiresImmediateLivePublication(message: WorkspaceMessage) {
  return Boolean(message.asyncMessage || message.asyncQuestion) || message.role === 'approval' || message.role === 'error' || message.state === 'error';
}

export function liveMessagePublicationMode(message: WorkspaceMessage | null, terminal: boolean): 'flush' | 'schedule' | 'none' {
  if (terminal || (message && requiresImmediateLivePublication(message))) return 'flush';
  return message ? 'schedule' : 'none';
}

export function liveMessagePublicationDelayMs(message: WorkspaceMessage) {
  // Cumulative rich answers are expensive even when represented by one
  // top-level message. Their latest frame wins while prompt edits remain at
  // native-input priority.
  return message.text.length >= 16_000 || countNewlinesUpTo(message.text, 240) >= 240
    ? RICH_LIVE_MESSAGE_PUBLICATION_INTERVAL_MS
    : LIVE_MESSAGE_PUBLICATION_INTERVAL_MS;
}

function countNewlinesUpTo(value: string, limit: number) {
  let count = 0;
  for (let index = 0; index < value.length && count < limit; index += 1) if (value.charCodeAt(index) === 10) count += 1;
  return count;
}

function bufferedMessageIdentity(message: WorkspaceMessage) {
  return `${message.sessionKey ?? ''}\u0000${message.id}`;
}
