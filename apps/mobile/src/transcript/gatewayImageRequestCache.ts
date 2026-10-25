export type ImageNetworkSource = { uri: string; headers?: Record<string, string>; diagnostic?: string };
type Loader = (signal: AbortSignal) => Promise<ImageNetworkSource>;
type Request = { key: string; load: Loader; promise: Promise<ImageNetworkSource>; resolve: (source: ImageNetworkSource) => void };
type ActiveRequest = Request & { controller: AbortController; deadline: ReturnType<typeof setTimeout> };
const CACHE_LIMIT = 8;
const WAITING_LIMIT = 8;
const TRANSFER_TIMEOUT_MS = 30_000;
const failed = (diagnostic: string): ImageNetworkSource => ({ uri: '', diagnostic });

/** Owns shared image work: one transfer, bounded waiting demand and successful cache. */
export class GatewayImageRequestCache {
  private ready = new Map<string, Promise<ImageNetworkSource>>();
  private waiting = new Map<string, Request>();
  private active: ActiveRequest | null = null;

  get(key: string, load: Loader) {
    const cached = this.ready.get(key);
    if (cached) { this.ready.delete(key); this.ready.set(key, cached); return cached; }
    if (this.active?.key === key) return this.active.promise;
    const queued = this.waiting.get(key); if (queued) return queued.promise;
    let resolve!: Request['resolve'];
    const promise = new Promise<ImageNetworkSource>(yes => { resolve = yes; });
    const request = { key, load, promise, resolve };
    // Prefer current viewport demand without retaining evicted closures in a
    // promise chain. Displaced leaves get a settled, explicitly retryable miss.
    if (this.waiting.size >= WAITING_LIMIT) {
      const oldest = this.waiting.values().next().value;
      if (oldest) { this.waiting.delete(oldest.key); oldest.resolve(failed('media-queue-replaced')); }
    }
    this.waiting.set(key, request); this.startNext();
    return promise;
  }

  invalidate(key: string) {
    this.ready.delete(key);
    const queued = this.waiting.get(key);
    if (queued) { this.waiting.delete(key); queued.resolve(failed('media-request-cancelled')); }
    const active = this.active;
    if (active?.key === key) this.finish(active, failed('media-request-cancelled'), true);
  }

  private startNext() {
    if (this.active) return;
    const next = this.waiting.values().next().value; if (!next) return;
    this.waiting.delete(next.key);
    const controller = new AbortController();
    const active: ActiveRequest = { ...next, controller,
      deadline: setTimeout(() => this.finish(active, failed('media-request-timeout'), true), TRANSFER_TIMEOUT_MS) };
    this.active = active;
    void Promise.resolve().then(() => {
      if (this.active !== active) return failed('media-request-cancelled');
      return active.load(controller.signal);
    }).then(source => this.finish(active, source), () => this.finish(active, failed('media-request-failed')));
  }

  private finish(request: ActiveRequest, source: ImageNetworkSource, abort = false) {
    if (this.active !== request) return;
    clearTimeout(request.deadline); this.active = null;
    if (abort) request.controller.abort();
    if (source.uri) {
      this.ready.set(request.key, request.promise);
      if (this.ready.size > CACHE_LIMIT) this.ready.delete(this.ready.keys().next().value!);
    }
    request.resolve(source); this.startNext();
  }
}
