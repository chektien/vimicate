import type { WorkspaceProject } from './workspaceTypes';

const MAX_ACTIVITY_KEYS = 1_000;

export class WorkspaceActivityLedger {
  private timestamps = new Map<string, number>();

  restore(raw: string | null) {
    this.timestamps.clear(); if (!raw) return;
    try {
      const value: unknown = JSON.parse(raw); if (!Array.isArray(value)) return;
      for (const entry of value.slice(-MAX_ACTIVITY_KEYS)) if (Array.isArray(entry) && typeof entry[0] === 'string' && validTimestamp(entry[1])) this.timestamps.set(entry[0], entry[1]);
    } catch { /* Invalid local presentation state is ignored. */ }
  }

  reconcile(projects: WorkspaceProject[]) {
    for (const project of projects) if (validTimestamp(project.updatedAt)) this.record(project.sessionKey, project.updatedAt);
    return projects.map((project) => {
      const retained = this.timestamps.get(project.sessionKey);
      return project.updatedAt || retained === undefined ? project : { ...project, updatedAt: retained };
    });
  }

  record(sessionKey: string, timestamp = Date.now()) {
    if (!sessionKey || !validTimestamp(timestamp)) return;
    const current = this.timestamps.get(sessionKey) ?? 0;
    this.timestamps.delete(sessionKey); this.timestamps.set(sessionKey, Math.max(current, timestamp));
    while (this.timestamps.size > MAX_ACTIVITY_KEYS) this.timestamps.delete(this.timestamps.keys().next().value!);
  }

  serialized() { return JSON.stringify([...this.timestamps.entries()]); }
}

function validTimestamp(value: unknown): value is number { return typeof value === 'number' && Number.isFinite(value) && value > 0; }
