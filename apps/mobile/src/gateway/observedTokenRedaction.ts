/** Recognize only the observed URL query token mask, not generic redaction or
 * URL normalization. Every byte outside token values must remain unchanged.
 * The returned full text contains only values already delivered to the client. */
export function restoreObservedTokenRedaction(masked: string, full: string): string | null {
  let maskedOffset = 0;
  let fullOffset = 0;
  let edits = 0;
  const values = masked.matchAll(/[?&]token=([A-Za-z0-9_-]{6})…([A-Za-z0-9_-]{4})(?=[&#\s`)\]>]|$)/g);
  for (const value of values) {
    const valueStart = value.index + '?token='.length;
    const url = masked.slice(0, valueStart).match(/https?:\/\/[^\s<>"`]*[?&]token=$/)?.[0];
    // Retention is for the observed user-facing password reset action, never
    // a generic bearer/auth query token or a newly broadened endpoint policy.
    if (!url) return null;
    try { if (new URL(url).pathname !== '/reset-password') return null; } catch { return null; }
    const unchanged = masked.slice(maskedOffset, valueStart);
    if (!full.startsWith(unchanged, fullOffset)) return null;
    fullOffset += unchanged.length;
    const unmasked = full.slice(fullOffset).match(/^[A-Za-z0-9_-]+/)?.[0];
    if (!unmasked || unmasked.length <= 10 || !unmasked.startsWith(value[1]!) || !unmasked.endsWith(value[2]!)) return null;
    fullOffset += unmasked.length;
    maskedOffset = valueStart + value[1]!.length + 1 + value[2]!.length;
    edits += 1;
  }
  return edits > 0 && masked.slice(maskedOffset) === full.slice(fullOffset) ? full : null;
}
