export type OlderHistoryRequestTicket = Readonly<{
  sessionKey: string;
  revision: number;
  serial: number;
}>;

export class OlderHistoryRequestAuthority {
  private current: OlderHistoryRequestTicket | null = null;
  private serial = 0;

  begin(sessionKey: string, revision: number) {
    if (!sessionKey || this.current) return null;
    const ticket = Object.freeze({ sessionKey, revision, serial: ++this.serial });
    this.current = ticket;
    return ticket;
  }

  isActive() { return this.current !== null; }

  owns(ticket: OlderHistoryRequestTicket, selectedSessionKey: string, revision: number) {
    return this.current === ticket
      && ticket.sessionKey === selectedSessionKey
      && ticket.revision === revision;
  }

  finish(ticket: OlderHistoryRequestTicket) {
    if (this.current !== ticket) return false;
    this.current = null;
    return true;
  }

  retire() { this.current = null; }
}
