import type { GatewayRefreshIntent } from './gatewayEvents';
import { shouldRefreshCanonicalHistory } from './historyRefreshPolicy';

/** One bounded event batch; live traffic cannot erase input/terminal history authority. */
export class GatewayRefreshBatch {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private deadline = 0;
  private sessions = false;
  private registry = false;
  private history = new Set<string>();
  private requiredHistory = new Set<string>();

  /** `terminal` means the selected session's run ended; other sessions' ends are routine. */
  schedule(intent: GatewayRefreshIntent, selectedSessionKey: string, terminal: boolean, flush: () => void, selectedRunActive = false) {
    if (!intent.refreshHistory && !intent.refreshSessions && !(terminal && this.timer)) return;
    this.add(intent, selectedSessionKey, terminal);
    const urgent = terminal || intent.refreshRegistry || (intent.refreshDuringRun && !intent.throttleDuringRun);
    // Routine work uses a trailing window regardless of run state, because
    // background sessions keep emitting. History the flush will actually read
    // waits 2 s. A census of other sessions' rail state waits 5 s.
    const historyDue = intent.refreshHistory && (!selectedRunActive || Boolean(intent.refreshDuringRun));
    const deadline = Date.now() + (urgent ? 120 : historyDue ? 2000 : 5000);
    // Fixed trailing window, never a sliding debounce. Terminal/catalog/input
    // reconciliation promotes pending work without losing the accumulated census.
    if (this.timer && this.deadline <= deadline) return;
    if (this.timer) clearTimeout(this.timer);
    this.deadline = deadline;
    this.timer = setTimeout(() => { this.timer = null; this.deadline = 0; flush(); }, deadline - Date.now());
  }

  add(intent: GatewayRefreshIntent, selectedSessionKey: string, terminal: boolean) {
    this.sessions ||= intent.refreshSessions;
    this.registry ||= intent.refreshRegistry;
    if (intent.refreshHistory && selectedSessionKey) {
      this.history.add(selectedSessionKey);
      if (terminal || intent.refreshDuringRun) this.requiredHistory.add(selectedSessionKey);
    }
  }

  take(selectedSessionKey: string, runActive: boolean) {
    const required = this.requiredHistory.has(selectedSessionKey);
    const plan = {
      refreshSessions: this.sessions,
      refreshRegistry: this.registry,
      refreshHistory: this.history.has(selectedSessionKey) && shouldRefreshCanonicalHistory(runActive, required),
      // Carry the key through the asynchronous session census, not a global
      // force flag that could hydrate a different thread selected meanwhile.
      requiredHistorySessionKey: required ? selectedSessionKey : '',
    };
    this.clear();
    return plan;
  }

  clear() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.deadline = 0;
    this.sessions = false;
    this.registry = false;
    this.history.clear();
    this.requiredHistory.clear();
  }
}
