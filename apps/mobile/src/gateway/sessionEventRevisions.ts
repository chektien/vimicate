import { gatewayFrameSessionKey } from './gatewayEvents';

const SESSION_LIMIT = 2048;

/**
 * Counts Gateway events per session. The
 * transport notes every frame, including frames the workspace drops while the
 * scene is inactive, so later readers can tell whether anything was missed.
 */
export class SessionEventRevisions {
  private revisions = new Map<string, number>();
  private epoch = 0;
  private counter = 0;

  note(frame: Record<string, unknown>) {
    if (frame.type !== 'event') return;
    const key = gatewayFrameSessionKey(frame);
    if (!key) return;
    if (this.revisions.size >= SESSION_LIMIT && !this.revisions.has(key)) { this.revisions.clear(); this.epoch += 1; }
    this.revisions.set(key, ++this.counter);
  }

  /** Opaque; changes whenever an event names this session. */
  revision(sessionKey: string) { return `${this.epoch}:${this.revisions.get(sessionKey) ?? 0}`; }

}
