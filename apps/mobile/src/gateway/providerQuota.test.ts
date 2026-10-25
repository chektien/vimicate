import { describe, expect, it } from 'vitest';
import { compactCountdown, normalizedWindowLabel, providerQuotaForProject, type ProviderUsageState } from './providerQuota';

const now = Date.UTC(2026, 7, 26, 3, 0, 0);
const state = (payload: Record<string, unknown>, receivedAt = now): ProviderUsageState => ({ phase: 'ready', snapshot: { payload, receivedAt } });

describe('provider quota projection', () => {
  it('describes reconnect, loading and terminal absence without an indefinite loading label', () => {
    const project = { modelProvider: 'openai' } as never;
    const idle: ProviderUsageState = { phase: 'idle', snapshot: null };
    expect(providerQuotaForProject(idle, project, now, 'connecting')?.text).toBe('reconnecting…');
    expect(providerQuotaForProject(idle, project, now, 'disconnected')?.text).toBe('quota offline');
    expect(providerQuotaForProject(idle, project, now, 'error')?.text).toBe('quota offline');
    expect(providerQuotaForProject(idle, project, now, 'idle')?.text).toBe('quota offline');
    expect(providerQuotaForProject(idle, project, now, 'connected')?.text).toBe('loading quota…');
    expect(providerQuotaForProject({ phase: 'loading', snapshot: null }, project, now)?.text).toBe('loading quota…');
    expect(providerQuotaForProject({ phase: 'error', snapshot: null }, project, now)?.text).toBe('quota unavailable');
    expect(providerQuotaForProject(state({ providers: [] }), project, now)?.text).toBe('quota unavailable');
  });

  it('shows loading for expired readings during refresh, but retains usable figures', () => {
    const project = { modelProvider: 'openai' } as never;
    const payload = { updatedAt: now - 600001, providers: [{ provider: 'openai', windows: [{ label: '5h', usedPercent: 25 }] }] };
    const loading: ProviderUsageState = { ...state(payload), phase: 'loading' };
    expect(providerQuotaForProject(loading, project, now)?.text).toBe('loading quota…');
    expect(providerQuotaForProject(state(payload), project, now)?.text).toBe('quota unavailable');
    expect(providerQuotaForProject({ ...loading, snapshot: { payload, receivedAt: now - 600001 } }, project, now)?.text).toBe('loading quota…');
    const usable = { ...loading, snapshot: { payload: { ...payload, updatedAt: now }, receivedAt: now } };
    expect(providerQuotaForProject(usable, project, now)?.text).toBe('5h 75%');
    expect(providerQuotaForProject(usable, project, now, 'connecting')?.text).toBe('reconnecting…');
  });

  it('labels native cached figures by source age, not the latest network receipt', () => {
    const payload = { updatedAt: now - 180000, providers: [{ provider: 'anthropic', windows: [{ label: '5h', usedPercent: 35 }] }] };
    expect(providerQuotaForProject(state(payload), { modelProvider: 'claude-cli' } as never, now)?.text).toBe('last known 3m · 5h 65%');
    expect(providerQuotaForProject(state({ ...payload, updatedAt: now - 600001 }), { modelProvider: 'claude-cli' } as never, now)?.text).toBe('quota unavailable');
    expect(providerQuotaForProject(state({ ...payload, updatedAt: now + 120000 }), { modelProvider: 'claude-cli' } as never, now)?.text).toBe('quota unavailable');
  });

  it('ages a provider reading by when it was measured, not by the Gateway refresh', () => {
    const claude = { modelProvider: 'claude-cli' } as never;
    const observed = (observedAt: number) => state({ updatedAt: now, providers: [{
      provider: 'anthropic', source: 'cli-rate-limit-event', observedAt,
      windows: [{ label: '5h', usedPercent: 20, resetAt: now + 7200000 }, { label: 'Week', usedPercent: 2 }],
    }] });
    expect(providerQuotaForProject(observed(now - 30000), claude, now)?.text).toBe('5h 80% 2h · Week 98%');
    expect(providerQuotaForProject(observed(now - 2400000), claude, now)?.text).toBe('last known 40m · 5h 80% 2h · Week 98%');
    expect(providerQuotaForProject(observed(now - 4 * 3600000), claude, now)?.text).toBe('last known 4h · 5h 80% 2h · Week 98%');
    expect(providerQuotaForProject(observed(now - 5 * 3600000 - 1), claude, now)?.text).toBe('quota unavailable');
    expect(providerQuotaForProject(observed(now + 120000), claude, now)?.text).toBe('quota unavailable');
    expect(providerQuotaForProject(observed(0), claude, now)?.text).toBe('quota unavailable');
  });

  it('shows a window whose reset time has passed as reset, not its stale percentage', () => {
    const claude = { modelProvider: 'claude-cli' } as never;
    const quota = providerQuotaForProject(state({ updatedAt: now, providers: [{ provider: 'anthropic', observedAt: now - 34 * 60000,
      windows: [{ label: '5h', usedPercent: 99, resetAt: now - 60000 }, { label: 'Week', usedPercent: 36, resetAt: now + 2 * 86400000 + 2 * 3600000 }],
    }] }), claude, now);
    expect(quota?.text).toBe('last known 34m · 5h reset · Week 64% 2d2h');
    expect(quota?.tone).toBe('normal');
  });

  it('omits windows still labelled with a raw provider id', () => {
    const claude = { modelProvider: 'claude-cli' } as never;
    const quota = providerQuotaForProject(state({ updatedAt: now, providers: [{ provider: 'anthropic', observedAt: now,
      windows: [{ label: '5h', usedPercent: 20 }, { label: 'Week', usedPercent: 2 }, { label: 'seven_day_overage_included', usedPercent: 0 }],
    }] }), claude, now);
    expect(quota?.text).toBe('5h 80% · Week 98%');
  });

  it('distinguishes usable last-known data from pending and unavailable data after reconnect', () => {
    const project = { modelProvider: 'openai' } as never;
    const payload = { updatedAt: now - 120000, providers: [{ provider: 'openai', windows: [{ label: '5h', usedPercent: 25 }] }] };
    const snapshot = { payload, receivedAt: now };
    expect(providerQuotaForProject({ phase: 'loading', snapshot }, project, now)?.text).toBe('last known 2m · 5h 75%');
    expect(providerQuotaForProject({ phase: 'error', snapshot }, project, now)?.text).toBe('last known 2m · 5h 75%');
    expect(providerQuotaForProject({ phase: 'loading', snapshot: null }, project, now)?.text).toBe('loading quota…');
    expect(providerQuotaForProject({ phase: 'error', snapshot: null }, project, now)?.text).toBe('quota unavailable');
    expect(providerQuotaForProject({ phase: 'error', snapshot }, { modelProvider: 'anthropic' } as never, now)?.text).toBe('quota unavailable');
  });
  it('matches only the selected session provider and converts used percent to remaining quota', () => {
    const payload = { providers: [
      { provider: 'anthropic', windows: [{ label: '5h', usedPercent: 90 }] },
      { provider: 'openai', windows: [{ label: '168h', usedPercent: 12, resetAt: now + (6 * 86400000) + (7 * 3600000) }] },
    ] };
    expect(providerQuotaForProject(state(payload), { modelProvider: 'openai' } as never, now)).toEqual({ provider: 'openai', text: '7d 88% 6d7h', tone: 'normal' });
    expect(providerQuotaForProject(state(payload), { modelProvider: 'anthropic' } as never, now)).toEqual({ provider: 'anthropic', text: '5h 10%', tone: 'warning' });
  });

  it('does not reuse a stale or mismatched provider snapshot', () => {
    const payload = { providers: [{ provider: 'openai', windows: [{ label: '5h', usedPercent: 25 }] }] };
    expect(providerQuotaForProject(state(payload), { modelProvider: 'anthropic' } as never, now)?.text).toBe('quota unavailable');
    expect(providerQuotaForProject(state(payload, now - 10 * 60 * 1000 - 1), { modelProvider: 'openai' } as never, now)?.text).toBe('quota unavailable');
  });

  it.each([
    { modelProvider: 'claude-cli', model: 'claude-opus-5', agentRuntime: 'claude-cli' },
    { model: 'claude-cli/claude-opus-5', agentRuntime: 'claude-cli' },
    { model: 'claude-opus-5', agentRuntime: 'claude-cli' },
  ])('matches Claude CLI session metadata to Anthropic usage: %j', (project) => {
    const payload = { providers: [
      { provider: 'openai', windows: [{ label: '5h', usedPercent: 5 }] },
      { provider: 'anthropic', displayName: 'Claude', windows: [{ label: '5h', usedPercent: 35 }, { label: '168h', usedPercent: 60 }] },
    ] };
    expect(providerQuotaForProject(state(payload), project as never, now)).toEqual({ provider: 'anthropic', text: '5h 65% · 7d 40%', tone: 'normal' });
  });

  it('reports rate-limited Claude usage without substituting another provider or stale percentages', () => {
    const payload = { providers: [
      { provider: 'openai', windows: [{ label: '5h', usedPercent: 5 }] },
      { provider: 'anthropic', error: 'HTTP 429: Rate limited. Please try again later.', windows: [{ label: '5h', usedPercent: 0 }] },
    ] };
    const project = { modelProvider: 'claude-cli', agentRuntime: 'claude-cli' } as never;
    expect(providerQuotaForProject(state(payload), project, now)).toEqual({ provider: 'anthropic', text: 'quota rate-limited', tone: 'unavailable' });
    expect(providerQuotaForProject(state(payload, now - 600001), project, now)?.text).toBe('quota unavailable');
  });

  it('keeps an explicit provider authoritative over the runtime', () => {
    const payload = { providers: [{ provider: 'anthropic', windows: [{ label: '5h', usedPercent: 10 }] }] };
    expect(providerQuotaForProject(state(payload), { modelProvider: 'bedrock', agentRuntime: 'claude-cli' } as never, now)?.text).toBe('quota unavailable');
  });

  it('normalizes whole-day labels and emits compact reset clocks', () => {
    expect(normalizedWindowLabel('168h')).toBe('7d');
    expect(normalizedWindowLabel('5h')).toBe('5h');
    expect(compactCountdown((2 * 86400000) + (3 * 3600000) + (59 * 60000))).toBe('2d3h');
  });
});
