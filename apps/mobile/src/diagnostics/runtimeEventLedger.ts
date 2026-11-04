import { sgtTimestamp } from './latestFatalDiagnostic';

const KEY = 'diagnostics.runtimeEvents.v1';
const LIMIT = 40;

/**
 * Process-wide owner of the persisted runtime breadcrumbs. Events recorded
 * before storage is readable, or while a load or save fails, wait in a bounded
 * pending buffer and are merged on the next successful write.
 */
class RuntimeEventLedger {
  private lines: string[] | null = null;
  private loading: Promise<string[]> | null = null;
  private pending: string[] = [];
  private inFlight: string[] = [];
  private writing: Promise<void> = Promise.resolve();
  private storeModule: Promise<typeof import('../storage/workspaceStore')> | null = null;

  // Storage loads on demand so recording never adds SQLite to an import graph.
  // Workspace writes are held while the scene is inactive, so background-only
  // events persist when the app returns to the foreground, not before.
  private store() {
    return this.storeModule ??= import('../storage/workspaceStore').catch((error: unknown) => { this.storeModule = null; throw error; });
  }

  private loaded(persistence: Awaited<ReturnType<RuntimeEventLedger['store']>>) {
    if (this.lines) return Promise.resolve(this.lines);
    this.loading ??= persistence.loadValue(KEY).then(
      (value) => { this.lines ??= parsed(value); return this.lines; },
      (error: unknown) => { this.loading = null; throw error; },
    );
    return this.loading;
  }

  record(line: string) {
    this.pending.push(line);
    if (this.pending.length > LIMIT) this.pending.splice(0, this.pending.length - LIMIT);
    this.writing = this.writing.then(() => this.flush()).catch(() => undefined);
  }

  private async flush() {
    if (!this.pending.length) return;
    const persistence = await this.store();
    const current = await this.loaded(persistence);
    // Detach the batch so bounding new events cannot shift its acknowledgement.
    const batch = this.pending;
    this.pending = [];
    this.inFlight = batch;
    const merged = [...current, ...batch].slice(-LIMIT);
    try {
      await persistence.saveValue(KEY, JSON.stringify(merged));
      this.lines = merged;
    } catch (error) {
      this.pending = [...batch, ...this.pending].slice(-LIMIT);
      throw error;
    } finally { this.inFlight = []; }
  }

  async snapshot() {
    try {
      await this.loaded(await this.store());
      return [...(this.lines ?? []), ...this.inFlight, ...this.pending].slice(-LIMIT);
    }
    catch { return [...this.inFlight, ...this.pending].slice(-LIMIT); }
  }
}

const ledger = new RuntimeEventLedger();

/** Bounded launch/lifecycle/connection/memory breadcrumbs that survive a kill. */
export function recordRuntimeEvent(kind: string, detail = '', at = Date.now()) {
  ledger.record(`${at} ${kind}${detail ? ` ${bounded(detail)}` : ''}`);
}

export async function runtimeEventLines() {
  return ledger.snapshot();
}

export function runtimeEventText(events: readonly string[]) {
  const formatted = events.flatMap((line) => {
    const match = /^(\d{10,}) (.+)$/.exec(line);
    return match ? [`${sgtTimestamp(Number(match[1]))} ${match[2]}`] : [];
  });
  return `runtime events (persisted across launches, SGT, oldest to newest)\n${formatted.length ? formatted.join('\n') : '(none)'}`;
}

function parsed(value: string | null) {
  try {
    const decoded: unknown = value ? JSON.parse(value) : [];
    return Array.isArray(decoded) ? decoded.filter((line): line is string => typeof line === 'string').slice(-LIMIT) : [];
  } catch { return []; }
}

function bounded(detail: string) {
  return detail
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '<email>')
    .replace(/\/Users\/[^/\s]+\//g, '/Users/<redacted>/')
    .replace(/[A-Za-z0-9_-]{40,}/g, '<redacted>')
    .replace(/\s+/g, ' ')
    .slice(0, 160);
}
