import { transcriptDragWillMomentum, transcriptMomentumBelongsToUser } from './transcriptTailFollowPolicy';

/** One native drag/fling lifetime. Explicit navigation retires the lifetime;
 * a late end-drag or momentum callback cannot resurrect it without a new drag. */
export class TranscriptScrollGesture {
  active = false;
  private momentumExpected = false;

  begin() { this.active = true; this.momentumExpected = false; }
  retire() { this.active = false; this.momentumExpected = false; }

  /** True only when this owned gesture has ended without momentum. */
  endDrag(velocityY: number | undefined) {
    if (!this.active) return false;
    this.momentumExpected = transcriptDragWillMomentum(velocityY);
    return !this.momentumExpected;
  }

  beginMomentum() { if (transcriptMomentumBelongsToUser(this.momentumExpected)) this.active = true; }
  endMomentum() {
    if (!transcriptMomentumBelongsToUser(this.momentumExpected)) return false;
    this.momentumExpected = false;
    return true;
  }
}
