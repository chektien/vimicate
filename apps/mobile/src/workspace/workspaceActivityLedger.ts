import type { WorkspaceProject } from './workspaceTypes';

const MAX_ACTIVITY_KEYS = 1_000;
// Only explicit conversation/local clocks participate in the proven maximum.
type Activity = { timestamp: number; fallbackTimestamp?: number };

export class WorkspaceActivityLedger {
  private timestamps = new Map<string, Activity>();

  restore(raw: string | null) {
    this.timestamps.clear(); if (!raw) return;
    try {
      const value: unknown = JSON.parse(raw);
      const legacy = Array.isArray(value);
      const envelope = value as { version?: unknown; entries?: unknown } | null;
      const entries = legacy ? value : envelope?.version === 1 ? envelope.entries : null;
      if (!Array.isArray(entries)) return;
      for (const entry of entries.slice(-MAX_ACTIVITY_KEYS)) {
        if (!Array.isArray(entry) || typeof entry[0] !== 'string') continue;
        if (legacy && validTimestamp(entry[1])) this.timestamps.set(entry[0], { timestamp: 0, fallbackTimestamp: entry[1] });
        else if (!legacy && (entry[2] === null || validTimestamp(entry[2])) && validClock(entry[1])) {
          this.timestamps.set(entry[0], { timestamp: entry[1], ...(entry[1] > 0 || entry[2] === null ? {} : { fallbackTimestamp: entry[2] }) });
        }
      }
    } catch { /* Invalid local presentation state is ignored. */ }
  }

  reconcile(projects: WorkspaceProject[], source: 'server' | 'compatibility' | 'presentation' = 'server'): WorkspaceProject[] {
    return projects.map((project) => {
      if (source === 'server' && validClock(project.updatedAt)) {
        this.retain(project.sessionKey, { timestamp: Math.max(this.timestamps.get(project.sessionKey)?.timestamp ?? 0, project.updatedAt) });
      } else if (source === 'compatibility' && validTimestamp(project.updatedAt)) this.recordCompatibility(project.sessionKey, project.updatedAt);
      const activity = this.timestamps.get(project.sessionKey);
      if (!activity) return project;
      const retained = activity.fallbackTimestamp ?? activity.timestamp;
      const updatedAt = retained || undefined;
      if (updatedAt === project.updatedAt) return project;
      const { updatedAt: _previousClock, ...stableProject } = project;
      return updatedAt === undefined ? stableProject : { ...stableProject, updatedAt };
    });
  }

  record(sessionKey: string, timestamp = Date.now()) {
    if (!sessionKey || !validTimestamp(timestamp)) return;
    const retained = Math.max(this.timestamps.get(sessionKey)?.timestamp ?? 0, timestamp);
    this.retain(sessionKey, { timestamp: retained });
    return retained;
  }

  recordCompatibility(sessionKey: string, timestamp: number) {
    if (!sessionKey || !validTimestamp(timestamp)) return;
    const previous = this.timestamps.get(sessionKey);
    if (previous && previous.fallbackTimestamp === undefined) return previous.timestamp;
    this.retain(sessionKey, { timestamp: 0, fallbackTimestamp: timestamp });
    return timestamp;
  }

  private retain(sessionKey: string, activity: Activity) {
    if (!sessionKey) return;
    this.timestamps.delete(sessionKey); this.timestamps.set(sessionKey, activity);
    while (this.timestamps.size > MAX_ACTIVITY_KEYS) this.timestamps.delete(this.timestamps.keys().next().value!);
  }

  serialized() { return JSON.stringify({ version: 1, entries: [...this.timestamps].map(([key, activity]) => [key, activity.timestamp, activity.fallbackTimestamp ?? null]) }); }
}

function validTimestamp(value: unknown): value is number { return typeof value === 'number' && Number.isFinite(value) && value > 0; }

function validClock(value: unknown): value is number { return typeof value === 'number' && Number.isFinite(value) && value >= 0; }
