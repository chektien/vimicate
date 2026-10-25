/**
 * Owns asynchronous transcript/history publication across iOS scene changes.
 *
 * A request captures the current revision before awaiting native/network work.
 * Suspension advances that revision, so a result that began in the foreground
 * cannot publish React state or schedule persistence after the scene resigns
 * active. Its signal also releases scene-owned task tickets and timers before
 * resume can admit fresh work. Durable run/history facts are not discarded.
 */
export class HistoryPublicationAuthority {
  private revision = 0;
  private controller = new AbortController();

  constructor(private active = true) { if (!active) this.controller.abort(); }

  capture() { return this.revision; }

  owns(revision: number) { return this.active && revision === this.revision; }

  suspend() {
    if (!this.active) return false;
    this.active = false;
    this.revision += 1;
    this.controller.abort();
    return true;
  }

  resume() {
    if (!this.active) this.controller = new AbortController();
    this.active = true;
  }

  get isActive() { return this.active; }
  get signal() { return this.controller.signal; }
}
