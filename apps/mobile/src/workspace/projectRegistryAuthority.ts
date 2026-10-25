export type ProjectRegistryAuthority<T> =
  | { ready: false; snapshot: null }
  | { ready: true; snapshot: T };

/**
 * Session discovery is transport data, not Vimicate project authority. A
 * successful typed registry read may replace the accepted snapshot; a failed
 * refresh may retain an already accepted snapshot; the first failed read must
 * leave startup visibly unready instead of promoting session-list guesses.
 */
export function resolveProjectRegistryAuthority<T>(accepted: T | null, candidate: T | null): ProjectRegistryAuthority<T> {
  const snapshot = candidate ?? accepted;
  return snapshot === null
    ? { ready: false, snapshot: null }
    : { ready: true, snapshot };
}
