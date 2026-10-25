export const PROJECT_REGISTRY_RETRY_DELAYS_MS = [1_000, 2_000, 5_000, 10_000, 30_000, 60_000] as const;

/** One timer owner for transient first-registry-read recovery. */
export class ProjectRegistryRetryOwner {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private attempts = 0;

  get pending() { return this.timer !== null; }

  schedule(retry: () => void) {
    if (this.timer) return false;
    const delay = PROJECT_REGISTRY_RETRY_DELAYS_MS[Math.min(this.attempts, PROJECT_REGISTRY_RETRY_DELAYS_MS.length - 1)];
    this.attempts += 1;
    this.timer = setTimeout(() => {
      this.timer = null;
      retry();
    }, delay);
    return true;
  }

  acceptAuthority() {
    const recovered = this.attempts > 0;
    this.cancelTimer();
    this.attempts = 0;
    return recovered;
  }

  suspend() {
    this.cancelTimer();
    this.attempts = 0;
  }

  private cancelTimer() {
    if (!this.timer) return;
    clearTimeout(this.timer);
    this.timer = null;
  }
}
