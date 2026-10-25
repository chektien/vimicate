type IntervalHandle = ReturnType<typeof setInterval>;

export type ActiveIntervalScheduler = {
  set: (callback: () => void, intervalMs: number) => IntervalHandle;
  clear: (handle: IntervalHandle) => void;
};

export type ActiveIntervalActivationScheduler = (callback: () => void) => void;

const defaultScheduler: ActiveIntervalScheduler = {
  set: (callback, intervalMs) => setInterval(callback, intervalMs),
  clear: (handle) => clearInterval(handle),
};
const immediateActivation: ActiveIntervalActivationScheduler = (callback) => callback();

/**
 * Owns one periodic task whose lifetime is strictly bounded by an active
 * scene. The React Native hook supplies scene changes; this pure owner keeps
 * timer admission deterministic and independently testable.
 */
export class ActiveIntervalController {
  private handle: IntervalHandle | null = null;
  private activationRevision = 0;

  constructor(
    private readonly callback: () => void,
    private readonly intervalMs: number,
    private readonly scheduler: ActiveIntervalScheduler = defaultScheduler,
    private readonly scheduleActivation: ActiveIntervalActivationScheduler = immediateActivation,
  ) {}

  sync(active: boolean, enabled: boolean, runOnActivation: boolean) {
    if (!active || !enabled) {
      this.stop();
      return;
    }
    if (this.handle !== null) return;
    const activationRevision = ++this.activationRevision;
    this.handle = this.scheduler.set(this.callback, this.intervalMs);
    if (runOnActivation) this.scheduleActivation(() => {
      if (this.handle !== null && this.activationRevision === activationRevision) this.callback();
    });
  }

  stop() {
    this.activationRevision += 1;
    if (this.handle === null) return;
    this.scheduler.clear(this.handle);
    this.handle = null;
  }

  dispose() {
    this.stop();
  }
}
