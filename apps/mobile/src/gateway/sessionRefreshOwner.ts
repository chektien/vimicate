export type SessionRefreshIntent = {
  refreshRegistry: boolean;
  requireRegistry: boolean;
  preferredKey: string;
  selectionKey: string;
  hydrateSelected: boolean;
  requiredHistory: Map<string, string>;
};
type Scope = { connection: number; signal: AbortSignal; historyGeneration: (key: string) => string | undefined };
type Batch = {
  intent: SessionRefreshIntent;
  promise: Promise<void>;
  resolve: () => void;
  reject: (error: unknown) => void;
  execute: (intent: SessionRefreshIntent, owns: () => boolean) => Promise<void>;
};

/** One running refresh and one merged successor, never a lifetime request queue. */
export class SessionRefreshOwner {
  private scope: Scope | null = null;
  private active: Batch | null = null;
  private pending: Batch | null = null;
  private detach: (() => void) | null = null;

  request(intent: SessionRefreshIntent, scope: Scope, execute: Batch['execute']) {
    if (scope.signal.aborted) return intent.requireRegistry ? Promise.reject(new Error('Project refresh retired before completion')) : Promise.resolve();
    if (this.scope?.connection !== scope.connection || this.scope?.signal !== scope.signal) {
      this.clear(); this.scope = scope;
      const abort = () => this.clear();
      scope.signal.addEventListener('abort', abort, { once: true });
      this.detach = () => scope.signal.removeEventListener('abort', abort);
    }
    let batch = this.pending;
    if (batch) {
      // Retain only currently registered generations. The one successor holds
      // at most one intent per rail session, not every route ever visited.
      for (const [key, generation] of batch.intent.requiredHistory) {
        if (scope.historyGeneration(key) !== generation) batch.intent.requiredHistory.delete(key);
      }
      batch.intent.refreshRegistry ||= intent.refreshRegistry;
      batch.intent.requireRegistry ||= intent.requireRegistry;
      batch.intent.hydrateSelected ||= intent.hydrateSelected;
      for (const [key, generation] of intent.requiredHistory) batch.intent.requiredHistory.set(key, generation);
      if (intent.preferredKey) {
        batch.intent.preferredKey = intent.preferredKey;
        batch.intent.selectionKey = intent.selectionKey;
      }
      batch.execute = execute;
    } else {
      let resolve!: () => void; let reject!: (error: unknown) => void;
      const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
      batch = { intent, promise, resolve, reject, execute };
      if (this.active) this.pending = batch;
      else this.start(batch);
    }
    // Strict registry callers retain their failure contract. Event/read-ack
    // callers must not acquire an unhandled rejection by joining that work.
    return intent.requireRegistry ? batch.promise : batch.promise.catch(() => undefined);
  }

  clear() {
    this.detach?.(); this.detach = null;
    this.scope = null;
    for (const batch of [this.active, this.pending]) {
      if (batch?.intent.requireRegistry) batch.reject(new Error('Project refresh retired before completion'));
      else batch?.resolve();
    }
    this.active = null; this.pending = null;
  }

  private start(batch: Batch) {
    this.active = batch;
    const owns = () => this.active === batch && !this.scope?.signal.aborted;
    void (async () => {
      try { await batch.execute(batch.intent, owns); batch.resolve(); }
      catch (error) { batch.reject(error); }
      finally {
        if (this.active === batch) {
          this.active = null;
          const next = this.pending; this.pending = null;
          if (next) this.start(next);
        }
      }
    })();
  }
}
