const DEFAULT_SESSION_CACHE_LIMIT = 64;

/**
 * Small process-local LRU for session state whose durable authority lives
 * elsewhere or whose older value can safely fall back to a default.
 */
export class BoundedSessionCache<Value> {
  private readonly values = new Map<string, Value>();
  private readonly sessionLimit: number;

  constructor(sessionLimit = DEFAULT_SESSION_CACHE_LIMIT, private readonly onEvict?: (value: Value) => void) {
    this.sessionLimit = Math.max(1, Math.floor(sessionLimit));
  }

  store(sessionKey: string, value: Value) {
    if (!sessionKey) return;
    this.values.delete(sessionKey);
    this.values.set(sessionKey, value);
    let evictedSessionKey: string | undefined;
    while (this.values.size > this.sessionLimit) {
      const oldestSessionKey = this.values.keys().next().value;
      if (oldestSessionKey === undefined) break;
      this.onEvict?.(this.values.get(oldestSessionKey)!);
      this.values.delete(oldestSessionKey);
      evictedSessionKey = oldestSessionKey;
    }
    return evictedSessionKey;
  }

  restore(sessionKey: string) {
    if (!sessionKey) return undefined;
    const value = this.values.get(sessionKey);
    if (value === undefined) return undefined;
    this.values.delete(sessionKey);
    this.values.set(sessionKey, value);
    return value;
  }

  delete(sessionKey: string) {
    if (!sessionKey) return false;
    return this.values.delete(sessionKey);
  }

  hasEntries() { return this.values.size > 0; }

  clear() {
    if (this.onEvict) for (const value of this.values.values()) this.onEvict(value);
    this.values.clear();
  }
}
