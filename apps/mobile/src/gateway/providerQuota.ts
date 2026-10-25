import type { GatewayStatus } from './OpenClawClient';
import type { WorkspaceProject } from '../workspace/workspaceTypes';

export type ProviderUsageSnapshot = {
  payload: Record<string, unknown>;
  receivedAt: number;
};

export type ProviderUsageState = {
  phase: 'idle' | 'loading' | 'ready' | 'error';
  snapshot: ProviderUsageSnapshot | null;
};

export type ProviderQuotaPresentation = {
  text: string;
  tone: 'normal' | 'warning' | 'unavailable';
  provider: string;
};

const SNAPSHOT_MAX_AGE_MS = 10 * 60 * 1000;
const NATIVE_CACHE_FRESH_MS = 60 * 1000;
/** A measured reading older than the 5h window it describes is not shown. */
const OBSERVED_MAX_AGE_MS = 5 * 60 * 60 * 1000;

export function providerQuotaForProject(state: ProviderUsageState, project: WorkspaceProject | undefined, now = Date.now(), connection: GatewayStatus = 'connected'): ProviderQuotaPresentation | null {
  const provider = providerKeyForProject(project);
  if (!provider) return null;
  if (connection === 'connecting') return unavailableQuota(provider, 'reconnecting…');
  if (connection !== 'connected') return unavailableQuota(provider, 'quota offline');
  const pending = state.phase === 'idle' || state.phase === 'loading';
  const missing = unavailableQuota(provider, pending ? 'loading quota…' : 'quota unavailable');
  const snapshot = state.snapshot;
  if (!snapshot || now - snapshot.receivedAt > SNAPSHOT_MAX_AGE_MS) return missing;
  // 9.4 may return a retained snapshot. Receiving it again does not refresh
  // the underlying quota reading. Older servers omit this timestamp.
  const sourceAt = finiteNumber(snapshot.payload.updatedAt);
  if (sourceAt !== null && (sourceAt <= 0 || sourceAt > now + NATIVE_CACHE_FRESH_MS)) return missing;
  const readingAge = now - Math.min(snapshot.receivedAt, sourceAt ?? snapshot.receivedAt);
  if (readingAge > SNAPSHOT_MAX_AGE_MS) return missing;
  const summary = providersFromPayload(snapshot.payload).find((candidate) => providerMatches(candidate, provider));
  if (!summary) return missing;
  if (typeof summary.error === 'string') return unavailableQuota(provider, /\b429\b|rate.?limit/i.test(summary.error) ? 'quota rate-limited' : 'quota unavailable');
  // A provider can report when its figures were measured (Claude quota comes
  // from the CLI's last turn). The Gateway refresh does not make that fresher.
  const observedAt = finiteNumber(summary.observedAt);
  if (observedAt !== null && (observedAt <= 0 || observedAt > now + NATIVE_CACHE_FRESH_MS || now - observedAt > OBSERVED_MAX_AGE_MS)) return missing;
  const age = observedAt === null ? readingAge : Math.max(readingAge, now - observedAt);
  const windows = array(summary.windows).flatMap((value) => quotaWindow(value, now));
  if (!windows.length) return missing;
  return {
    provider,
    text: `${age > NATIVE_CACHE_FRESH_MS ? `last known ${compactCountdown(age)} · ` : ''}${windows.map((window) => window.text).join(' · ')}`,
    tone: windows.some((window) => window.remainingPercent <= 15) ? 'warning' : 'normal',
  };
}

export function providerKeyForProject(project: WorkspaceProject | undefined) {
  const explicit = normalizedProvider(project?.modelProvider ?? '');
  if (explicit) return explicit;
  const model = project?.model ?? '';
  const modelPrefix = model.includes('/') ? normalizedProvider(model.slice(0, model.indexOf('/'))) : '';
  if (modelPrefix) return modelPrefix;
  const runtime = (project?.agentRuntime ?? '').trim().toLocaleLowerCase();
  if (runtime.includes('codex')) return 'openai';
  if (runtime.includes('claude')) return 'anthropic';
  return '';
}

function providersFromPayload(payload: Record<string, unknown>) {
  return array(payload.providers).filter(record);
}

function providerMatches(summary: Record<string, unknown>, provider: string) {
  const keys = [summary.provider, summary.displayName].filter((value): value is string => typeof value === 'string').map(normalizedProvider);
  return keys.includes(provider);
}

function quotaWindow(value: unknown, now: number) {
  if (!record(value)) return [];
  const used = finiteNumber(value.usedPercent);
  const suppliedRemaining = finiteNumber(value.percentLeft);
  const remainingPercent = suppliedRemaining === null ? used === null ? null : Math.round(100 - used) : Math.round(suppliedRemaining);
  const rawLabel = typeof value.label === 'string' ? value.label.trim() : '';
  // A window still named by its raw provider id (e.g. Claude's
  // `seven_day_overage_…`) has no reader-facing meaning in the status line.
  if (remainingPercent === null || !rawLabel || /^[a-z0-9]+(?:_[a-z0-9]+)+$/.test(rawLabel)) return [];
  const resetAt = finiteNumber(value.resetAt) ?? finiteNumber(value.resetAtMs);
  // A reading taken before its window reset no longer describes that window.
  // Say so instead of showing the old percentage with a 0m countdown.
  if (resetAt !== null && resetAt <= now) return [{ remainingPercent: 100, text: `${normalizedWindowLabel(rawLabel)} reset` }];
  const countdown = resetAt === null ? '' : compactCountdown(resetAt - now);
  return [{ remainingPercent: clamp(remainingPercent, 0, 100), text: `${normalizedWindowLabel(rawLabel)} ${clamp(remainingPercent, 0, 100)}%${countdown ? ` ${countdown}` : ''}` }];
}

export function normalizedWindowLabel(label: string) {
  const match = /^(\d+)h$/i.exec(label.trim());
  if (!match) return label;
  const hours = Number(match[1]);
  return hours > 0 && hours % 24 === 0 ? `${hours / 24}d` : label;
}

export function compactCountdown(milliseconds: number) {
  if (milliseconds <= 0) return '0m';
  const totalMinutes = Math.max(1, Math.floor(milliseconds / 60000));
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;
  if (days) return hours ? `${days}d${hours}h` : `${days}d`;
  if (hours) return minutes ? `${hours}h${minutes}m` : `${hours}h`;
  return `${minutes}m`;
}

function unavailableQuota(provider: string, text: string): ProviderQuotaPresentation { return { provider, text, tone: 'unavailable' }; }
function normalizedProvider(value: string) {
  const normalized = value.trim().toLocaleLowerCase();
  if (!normalized) return '';
  if (normalized === 'openai-codex' || normalized === 'codex') return 'openai';
  if (normalized === 'claude' || normalized === 'claude-code' || normalized === 'claude-cli') return 'anthropic';
  if (normalized === 'copilot' || normalized === 'github') return 'github-copilot';
  return normalized;
}
function record(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value); }
function array(value: unknown): unknown[] { return Array.isArray(value) ? value : []; }
function finiteNumber(value: unknown) { return typeof value === 'number' && Number.isFinite(value) ? value : null; }
function clamp(value: number, minimum: number, maximum: number) { return Math.min(maximum, Math.max(minimum, value)); }
