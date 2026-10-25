export function sessionOwnsVisiblePublication(publicationSessionKey: string, selectedSessionKey: string, historySessionKey: string) {
  return Boolean(publicationSessionKey)
    && publicationSessionKey === selectedSessionKey
    && publicationSessionKey === historySessionKey;
}

/** Session-scoped footer/status text follows the same owner as its operation. */
export function sessionOwnsDetailPublication(publicationSessionKey: string, selectedSessionKey: string) {
  return Boolean(publicationSessionKey) && publicationSessionKey === selectedSessionKey;
}
