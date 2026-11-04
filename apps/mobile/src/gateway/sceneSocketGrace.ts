type GraceClient = { status: string; connectionRevision: number };

export const SCENE_SOCKET_GRACE_MS = 30_000;

/**
 * iOS reports `inactive` for Control Center, notifications, the app switcher
 * and banners. Publication still suspends at that boundary, but the socket is
 * kept briefly so a transient interruption does not cost a full reconnect and
 * rehydration. `background`, grace expiry or any socket replacement releases it.
 * The caller still proves liveness and rehydrates dropped state on resume.
 */
export class SceneSocketGrace {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private kept: { revision: number; disconnect: () => void } | null = null;

  suspend(state: string, client: GraceClient, disconnect: () => void, graceMs = SCENE_SOCKET_GRACE_MS) {
    this.release();
    if (state !== 'inactive' || client.status !== 'connected') { disconnect(); return; }
    this.kept = { revision: client.connectionRevision, disconnect };
    this.timer = setTimeout(() => this.release(), graceMs);
  }

  /** Disconnects a kept socket now; a no-op when nothing is kept. */
  release() {
    const kept = this.kept; this.forget();
    kept?.disconnect();
  }

  /** True when the same socket is still reported connected; liveness is the caller's check. */
  resume(client: GraceClient) {
    const kept = this.kept; this.forget();
    return Boolean(kept && client.status === 'connected' && client.connectionRevision === kept.revision);
  }

  private forget() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null; this.kept = null;
  }
}
