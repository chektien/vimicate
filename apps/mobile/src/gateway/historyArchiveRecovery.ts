/**
 * One obsolete archived-family request may overlap a stable-route generation
 * switch. Recovery belongs to the exact session key: the mounted review stays
 * visible until canonical latest history arrives, and only that publication
 * may consume the handoff and move the pane back to the live tail.
 */
export class HistoryArchiveRecovery {
  private sessionKey = '';

  request(sessionKey: string) {
    this.sessionKey = sessionKey;
  }

  pendingFor(sessionKey: string) {
    return Boolean(sessionKey) && this.sessionKey === sessionKey;
  }

  consume(sessionKey: string) {
    if (!this.pendingFor(sessionKey)) return false;
    this.sessionKey = '';
    return true;
  }

  retire() {
    this.sessionKey = '';
  }
}
