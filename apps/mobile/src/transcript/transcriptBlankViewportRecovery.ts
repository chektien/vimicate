type FrameScheduler = (callback: () => void) => number | null;
type FrameCanceller = (frame: number) => void;

const MAX_BLANK_RECOVERY_ATTEMPTS = 3;

/** Owns bounded, post-layout recovery for a recycler with no visible cells. */
export class TranscriptBlankViewportRecoveryOwner {
  private firstFrame: number | null = null;
  private confirmationFrame: number | null = null;
  private attempts = 0;
  private datasetKey: string | null = null;
  private generationKey: unknown = null;
  private attemptedGenerationKey: unknown = null;

  constructor(
    private readonly scheduleFrame: FrameScheduler = requestAnimationFrame,
    private readonly cancelFrame: FrameCanceller = cancelAnimationFrame,
  ) {}

  schedule(
    datasetKey: string,
    generationKey: unknown,
    ownsGeneration: (generationKey: unknown) => boolean,
    shouldRecover: () => boolean,
    recover: () => void,
  ) {
    if (this.datasetKey !== datasetKey) {
      this.cancelFrames();
      this.attempts = 0;
      this.datasetKey = datasetKey;
      this.generationKey = generationKey;
      this.attemptedGenerationKey = null;
    } else if (this.generationKey !== generationKey) {
      // A stream can publish a new revision before the recycler has mounted a
      // single cell. Retire the stale confirmation, but keep one bounded
      // recovery budget for that continuous blank episode. Visibility (or a
      // dataset change), not publication frequency, rearms the writer.
      this.cancelFrames();
      this.generationKey = generationKey;
    }
    if (this.firstFrame !== null || this.confirmationFrame !== null) return 'pending';
    if (this.attemptedGenerationKey === generationKey) return 'attempted';
    if (this.attempts >= MAX_BLANK_RECOVERY_ATTEMPTS) return 'exhausted';
    this.firstFrame = this.scheduleFrame(() => {
      this.firstFrame = null;
      this.confirmationFrame = this.scheduleFrame(() => {
        this.confirmationFrame = null;
        if (!ownsGeneration(generationKey) || !shouldRecover()) return;
        this.attempts += 1;
        this.attemptedGenerationKey = generationKey;
        recover();
      });
    });
    return this.firstFrame === null ? 'suspended' : 'queued';
  }

  settledVisible() { this.cancel(); }

  private cancelFrames() {
    if (this.firstFrame !== null) this.cancelFrame(this.firstFrame);
    if (this.confirmationFrame !== null) this.cancelFrame(this.confirmationFrame);
    this.firstFrame = null;
    this.confirmationFrame = null;
  }

  cancel() {
    this.cancelFrames();
    this.attempts = 0;
    this.datasetKey = null;
    this.generationKey = null;
    this.attemptedGenerationKey = null;
  }
}
