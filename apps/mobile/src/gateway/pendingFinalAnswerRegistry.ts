export type PendingFinalAnswer = { sessionKey: string; runId: string; registeredAtMs: number; exhausted?: boolean };

export class PendingFinalAnswerRegistry {
  private values = new Map<string, PendingFinalAnswer>();

  register(sessionKey: string, runId: string, registeredAtMs = Date.now()) {
    if (!sessionKey || !runId) return false;
    const key = identity(sessionKey, runId);
    if (this.values.has(key)) return false;
    this.values.set(key, { sessionKey, runId, registeredAtMs: validTime(registeredAtMs) ?? Date.now() }); return true;
  }
  settle(sessionKey: string, runId: string) { return this.values.delete(identity(sessionKey, runId)); }
  markExhausted(sessionKey: string, runId: string) {
    const key = identity(sessionKey, runId); const value = this.values.get(key); if (!value || value.exhausted) return false;
    this.values.set(key, { ...value, exhausted: true }); return true;
  }
  owns(sessionKey: string, runId: string) { return this.values.has(identity(sessionKey, runId)); }
  entries() { return [...this.values.values()]; }
  serialized() { return JSON.stringify(this.entries()); }
  restore(raw: string | null) {
    this.values.clear(); if (!raw) return;
    try {
      const parsed: unknown = JSON.parse(raw); if (!Array.isArray(parsed)) return;
      for (const value of parsed) {
        if (!isRecord(value)) continue;
        const sessionKey = text(value.sessionKey); const runId = text(value.runId); const registeredAtMs = validTime(value.registeredAtMs);
        if (!sessionKey || !runId || registeredAtMs === undefined || sessionKey.length > 1024 || runId.length > 256) continue;
        this.values.set(identity(sessionKey, runId), { sessionKey, runId, registeredAtMs, ...(value.exhausted === true ? { exhausted: true } : {}) });
      }
    } catch { /* Invalid local recovery metadata is ignored. */ }
  }
}

export const FINAL_ANSWER_RECOVERY_DELAYS_MS = [250, 750, 1_500, 3_000, 6_000, 12_000, 24_000] as const;
export const FINAL_ANSWER_STEADY_RECOVERY_DELAY_MS = 60_000;

function identity(sessionKey: string, runId: string) { return `${sessionKey}\u0000${runId}`; }
function validTime(value: unknown) { return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined; }
function text(value: unknown) { return typeof value === 'string' ? value : ''; }
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value); }
