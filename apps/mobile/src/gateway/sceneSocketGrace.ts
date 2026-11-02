type GraceClient = { status: string; connectionRevision: number; catalogEventRevision: number };
export type SceneSocketResume = { kept: false } | { kept: true; catalogChanged: boolean };

export const SCENE_SOCKET_GRACE_MS = 30_000;

/**
 * iOS reports `inactive` for Control Center, notifications, the app switcher
 * and banners. Publication still suspends at that boundary, but the socket is
 * kept briefly so a transient interruption does not cost a full reconnect and
 * rehydration. `background`, grace expiry or any socket replacement releases it.
 */
export class SceneSocketGrace {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private kept: { revision: number; catalog: number; disconnect: () => void } | null = null;

  suspend(state: string, client: GraceClient, disconnect: () => void, graceMs = SCENE_SOCKET_GRACE_MS) {
    this.release();
    if (state !== 'inactive' || client.status !== 'connected') { disconnect(); return; }
    this.kept = { revision: client.connectionRevision, catalog: client.catalogEventRevision, disconnect };
    this.timer = setTimeout(() => this.release(), graceMs);
  }

  /** Disconnects a kept socket now; a no-op when nothing is kept. */
  release() {
    const kept = this.kept; this.forget();
    kept?.disconnect();
  }

  resume(client: GraceClient): SceneSocketResume {
    const kept = this.kept; this.forget();
    return kept && client.status === 'connected' && client.connectionRevision === kept.revision
      ? { kept: true, catalogChanged: client.catalogEventRevision !== kept.catalog }
      : { kept: false };
  }

  private forget() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null; this.kept = null;
  }
}
