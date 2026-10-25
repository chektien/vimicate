import type { GatewayRefreshIntent } from './gatewayEvents';
import { shouldRefreshCanonicalHistory } from './historyRefreshPolicy';

/** One bounded event batch; live traffic cannot erase input/terminal history authority. */
export class GatewayRefreshBatch {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private sessions = false;
  private registry = false;
  private history = new Set<string>();
  private requiredHistory = new Set<string>();

  schedule(intent: GatewayRefreshIntent, selectedSessionKey: string, terminal: boolean, flush: () => void) {
    if (!intent.refreshHistory && !intent.refreshSessions) return;
    this.add(intent, selectedSessionKey, terminal);
    // Do not extend the deadline on each event: continuous traffic must not
    // indefinitely postpone the completed run's canonical reconciliation.
    if (!this.timer) this.timer = setTimeout(() => { this.timer = null; flush(); }, 120);
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
    this.sessions = false;
    this.registry = false;
    this.history.clear();
    this.requiredHistory.clear();
  }
}
