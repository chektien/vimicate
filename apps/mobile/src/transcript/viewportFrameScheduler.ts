type PendingFrame = { callback: () => void; platformFrame: number | null };

/** Resource lifetime only; the viewport's existing slots own navigation policy. */
export class ViewportFrameScheduler {
  private readonly pending = new Map<number, PendingFrame>();
  private next = 1;
  private epoch = 0;
  private closed = false;

  constructor(
    private active: boolean,
    private readonly schedule = (callback: () => void) => requestAnimationFrame(callback),
    private readonly cancelPlatform = (frame: number) => cancelAnimationFrame(frame),
  ) {}

  get isActive() { return this.active && !this.closed; }

  request = (callback: () => void): number | null => {
    if (this.closed) return null;
    const id = this.next++;
    const frame = { callback, platformFrame: null };
    this.pending.set(id, frame);
    if (this.active) this.arm(id, frame);
    return id;
  };

  cancel = (id: number) => {
    const frame = this.pending.get(id);
    if (frame?.platformFrame !== null && frame?.platformFrame !== undefined) this.cancelPlatform(frame.platformFrame);
    this.pending.delete(id);
  };

  cancelSlot(slot: { current: number | null }) {
    if (slot.current === null) return;
    this.cancel(slot.current);
    slot.current = null;
  }

  setActive(active: boolean) {
    if (this.closed || this.active === active) return;
    this.active = active; this.epoch += 1;
    for (const [id, frame] of this.pending) {
      if (active) this.arm(id, frame);
      else {
        if (frame.platformFrame !== null) this.cancelPlatform(frame.platformFrame);
        frame.platformFrame = null;
      }
    }
  }

  /** React effect replay starts a fresh lifetime, never reviving disposed work. */
  attach(active: boolean) { this.closed = false; this.setActive(active); }

  dispose() {
    this.setActive(false); this.closed = true; this.epoch += 1;
    this.pending.clear();
  }

  private arm(id: number, frame: PendingFrame) {
    const epoch = this.epoch;
    frame.platformFrame = this.schedule(() => {
      if (this.closed || !this.active || this.epoch !== epoch || this.pending.get(id) !== frame) return;
      this.pending.delete(id);
      frame.callback();
    });
  }
}
