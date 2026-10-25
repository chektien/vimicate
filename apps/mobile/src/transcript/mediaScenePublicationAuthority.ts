type ResumeSubscriber = () => void;

/**
 * Owns React/Fabric publication from asynchronous transcript-media work.
 *
 * The Gateway lifecycle is the sole scene-state writer. Suspension invalidates
 * every captured revision without notifying React; resume alone wakes mounted
 * media leaves whose result was discarded while iOS was inactive.
 */
export class MediaScenePublicationAuthority {
  private revision = 0;
  private subscribers = new Set<ResumeSubscriber>();

  constructor(private active = false) {}

  capture() { return this.active ? this.revision : null; }

  owns(revision: number | null) {
    return revision !== null && this.active && revision === this.revision;
  }

  suspend() {
    if (!this.active) return false;
    this.active = false;
    this.revision += 1;
    return true;
  }

  resume() {
    if (this.active) return false;
    this.active = true;
    for (const subscriber of this.subscribers) subscriber();
    return true;
  }

  subscribeResume(subscriber: ResumeSubscriber) {
    this.subscribers.add(subscriber);
    return () => { this.subscribers.delete(subscriber); };
  }
}

// Deliberately inactive until the existing root AppState owner synchronizes
// the actual mounted scene. Child effects therefore cannot treat an unresolved
// render-time AppState value as publication authority.
export const mediaScenePublicationAuthority = new MediaScenePublicationAuthority(false);
