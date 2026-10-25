import type { WorkspaceProject } from '../workspace/workspaceTypes';

export type GatewaySessionGeneration = {
  sessionId: string;
  sessionStartedAtMs: number;
  /** Advertised by the compatible host adapter, never inferred from version. */
  historyModel?: 'sqlite-display-v1';
};

/**
 * Resolve the current immutable Gateway generation without inferring it from
 * selection. `sessions.list` is preferred; the registry binding is the
 * authoritative fallback for hosts that omit generation metadata there.
 */
export function gatewaySessionGeneration(
  project: WorkspaceProject | undefined,
  registry: Record<string, unknown> | null,
): GatewaySessionGeneration | null {
  if (!project) return null;
  const binding = registryBindingForSession(registry, project.sessionKey);
  const sessionId = isUUID(project.sessionId ?? '') ? project.sessionId!.toLowerCase() : binding.sessionId;
  const sessionStartedAtMs = positiveInteger(project.sessionStartedAtMs)
    || (sessionId === binding.sessionId ? binding.sessionStartedAtMs : 0);
  const historyModel = record(registry?.capabilities).sessionHistory === 'sqlite-display-v1' ? 'sqlite-display-v1' as const : undefined;
  return sessionId ? { sessionId, sessionStartedAtMs, ...(historyModel ? { historyModel } : {}) } : null;
}

/** Registry-only authority check after a raw history read, including same-ID resets. */
export function registrySessionGeneration(sessionKey: string, registry: Record<string, unknown> | null): GatewaySessionGeneration | null {
  const binding = registryBindingForSession(registry, sessionKey);
  if (!binding.sessionId) return null;
  return { ...binding, ...(record(registry?.capabilities).sessionHistory === 'sqlite-display-v1'
    ? { historyModel: 'sqlite-display-v1' as const } : {}) };
}

export function sameSessionGeneration(left: GatewaySessionGeneration | null, right: GatewaySessionGeneration | null) {
  if (!left || !right) return left === right;
  return left.sessionId === right.sessionId && left.sessionStartedAtMs === right.sessionStartedAtMs
    && left.historyModel === right.historyModel;
}

function registryBindingForSession(registry: Record<string, unknown> | null, sessionKey: string) {
  if (record(registry?.capabilities).sessionHistory === 'sqlite-display-v1') {
    const generation = record(record(registry?.currentSessionGenerations)[sessionKey]);
    const sessionId = text(generation.sessionId);
    const sessionStartedAtMs = positiveInteger(generation.sessionStartedAtMs);
    if (isUUID(sessionId) && sessionStartedAtMs) return { sessionId: sessionId.toLowerCase(), sessionStartedAtMs };
  }
  try {
    const encoded = text(record(registry?.threads).json);
    const parsed = record(JSON.parse(encoded));
    const threads = Array.isArray(parsed.threads) ? parsed.threads : [];
    for (const value of threads) {
      const binding = record(record(value).currentBinding);
      if (text(binding.stableSessionKey) !== sessionKey || text(binding.state) !== 'current') continue;
      const sessionId = text(binding.sessionID) || text(binding.sessionId);
      const seconds = finiteNumber(binding.sessionStartedAtSeconds);
      const milliseconds = finiteNumber(binding.sessionStartedAtMs);
      return {
        sessionId: isUUID(sessionId) ? sessionId.toLowerCase() : '',
        sessionStartedAtMs: positiveInteger(milliseconds) || Math.round(Math.max(0, seconds) * 1000),
      };
    }
  } catch { /* Invalid registry data fails closed. */ }
  return { sessionId: '', sessionStartedAtMs: 0 };
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function text(value: unknown) { return typeof value === 'string' ? value.trim() : ''; }
function finiteNumber(value: unknown) { return typeof value === 'number' && Number.isFinite(value) ? value : 0; }
function positiveInteger(value: unknown) { return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : 0; }
function isUUID(value: string) { return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value); }
