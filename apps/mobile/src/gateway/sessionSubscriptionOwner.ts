type Subscription = { key?: string; approvalReplay?: unknown };
type Transport = {
  subscribe: (key: string) => Promise<Subscription>;
  unsubscribe: (key: string) => Promise<unknown>;
  accepted: (key: string, subscription: Subscription) => void;
};

/** One wire mutation at a time and one latest target, not a queue of visited projects. */
export class SessionSubscriptionOwner {
  private desired = '';
  private followed = '';
  private subscription = '';
  private active: { promise: Promise<void> } | null = null;

  constructor(private readonly transport: Transport) {}

  follow(sessionKey: string): Promise<void> {
    const key = sessionKey.trim();
    if (!key) return Promise.resolve();
    this.desired = key;
    if (this.active) return this.active.promise;
    if (this.followed === key) return Promise.resolve();
    const ticket = { promise: Promise.resolve() };
    this.active = ticket;
    ticket.promise = this.drain(ticket);
    return ticket.promise;
  }

  clear() {
    this.active = null;
    this.desired = this.followed = this.subscription = '';
  }

  private async drain(ticket: { promise: Promise<void> }) {
    const owns = () => this.active === ticket;
    try {
      while (owns() && this.desired !== this.followed) {
        if (this.subscription) {
          try { await this.transport.unsubscribe(this.subscription); }
          catch { /* A replaced or canonicalized session may already be unsubscribed. */ }
          if (!owns()) return;
          this.followed = this.subscription = '';
        }
        // Re-read after unsubscribe. Switches while it was pending need only
        // their final subscription, including switching back to the old key.
        const key = this.desired;
        let result: Subscription;
        try { result = await this.transport.subscribe(key); }
        catch (error) {
          if (!owns()) return;
          if (key !== this.desired) continue;
          throw error;
        }
        if (!owns()) return;
        this.followed = key;
        this.subscription = result.key?.trim() || key;
        if (key === this.desired) this.transport.accepted(key, result);
      }
    } finally {
      if (owns()) this.active = null;
    }
  }
}
