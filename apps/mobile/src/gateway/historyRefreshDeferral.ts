export class HistoryRefreshDeferral {
  private sessionKey = '';

  request(sessionKey: string) {
    if (sessionKey) this.sessionKey = sessionKey;
  }

  consume(selectedSessionKey: string) {
    const pending = this.sessionKey;
    this.sessionKey = '';
    return pending && pending === selectedSessionKey ? pending : '';
  }

  retire() { this.sessionKey = ''; }
}
