type MonitorOwner = {
  runId: string;
  token: symbol;
  dispose: () => void;
  wait?: { promise: Promise<void>; finish: () => void };
};

export class SessionRunMonitorOwners {
  private readonly owners = new Map<string, MonitorOwner>();

  claim(sessionKey: string, runId: string, signal?: AbortSignal) {
    if (!sessionKey || !runId || signal?.aborted) return null;
    const current = this.owners.get(sessionKey);
    if (current?.runId === runId) return null;
    if (current) this.release(sessionKey, current.token);
    const token = Symbol(`${sessionKey}:${runId}`);
    const abort = () => { this.release(sessionKey, token); };
    this.owners.set(sessionKey, { runId, token, dispose: () => signal?.removeEventListener('abort', abort) });
    signal?.addEventListener('abort', abort, { once: true });
    return token;
  }

  release(sessionKey: string, token: symbol) {
    const current = this.owners.get(sessionKey);
    if (current?.token !== token) return false;
    this.owners.delete(sessionKey);
    current.wait?.finish(); current.dispose();
    return true;
  }

  // A cancelled wait wakes the poller so its authority check can terminate it.
  // The ticket, its single timer and its scene subscription share one lifetime.
  wait(sessionKey: string, token: symbol, milliseconds: number): Promise<void> {
    const current = this.owners.get(sessionKey);
    if (current?.token !== token) return Promise.resolve();
    if (current.wait) return current.wait.promise;
    let finish!: () => void;
    const promise = new Promise<void>((resolve) => {
      finish = () => { clearTimeout(timer); delete current.wait; resolve(); };
      const timer = setTimeout(finish, milliseconds);
    });
    current.wait = { promise, finish };
    return promise;
  }

  owns(sessionKey: string, token: symbol) { return this.owners.get(sessionKey)?.token === token; }

  runFor(sessionKey: string) { return this.owners.get(sessionKey)?.runId ?? ''; }
  clear() { for (const [key, owner] of this.owners) this.release(key, owner.token); }
}
