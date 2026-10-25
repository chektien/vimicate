export type WorkspacePersistenceTask = () => Promise<void>;
export type WorkspacePersistenceActivityRunner = (
  task: WorkspacePersistenceTask,
) => Promise<void>;

type PendingWrite = {
  task: WorkspacePersistenceTask;
  resolve: Array<() => void>;
  reject: Array<(error: unknown) => void>;
};

/**
 * One write owner for the small local workspace cache.
 *
 * Writes with the same key collapse to the newest value before they start.
 * Suspending the queue prevents new native SQLite calls while iOS is
 * inactive/backgrounded; the pending tail resumes when the app is active.
 */
export class WorkspacePersistenceQueue {
  private active: boolean;
  private running = false;
  private barrierSequence = 0;
  private readonly order: string[] = [];
  private readonly pending = new Map<string, PendingWrite>();

  constructor(
    private readonly runWithActivity: WorkspacePersistenceActivityRunner = (task) => task(),
    initiallyActive = true,
  ) { this.active = initiallyActive; }

  setActive(active: boolean) {
    this.active = active;
    if (active) void this.drain();
  }

  enqueue(key: string, task: WorkspacePersistenceTask) {
    return new Promise<void>((resolve, reject) => {
      const existing = this.pending.get(key);
      if (existing) {
        existing.task = task;
        existing.resolve.push(resolve);
        existing.reject.push(reject);
      } else {
        this.pending.set(key, { task, resolve: [resolve], reject: [reject] });
        this.order.push(key);
      }
      void this.drain();
    });
  }

  /** Resolve only after every write queued before this call has settled. */
  barrier() {
    this.barrierSequence += 1;
    return this.enqueue(`read-barrier:${this.barrierSequence}`, async () => undefined);
  }

  private async drain() {
    if (this.running || !this.active) return;
    this.running = true;
    try {
      while (this.active && this.order.length) {
        const key = this.order.shift();
        if (!key) continue;
        const write = this.pending.get(key);
        if (!write) continue;
        this.pending.delete(key);
        try {
          await this.runWithActivity(write.task);
          write.resolve.forEach((resolve) => resolve());
        } catch (error) {
          write.reject.forEach((reject) => reject(error));
        }
      }
    } finally {
      this.running = false;
      if (this.active && this.order.length) void this.drain();
    }
  }
}
