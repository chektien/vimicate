/** Conversation activity is distinct from the session metadata mutation clock.
 * OpenClaw read acknowledgements update updatedAt, but not these activity fields.
 * Retain the legacy clock only for backends/rows without activity timestamps.
 */
export function sessionActivityTimestamp(row: Record<string, unknown>): number | undefined {
  const metadata = record(row.metadata);
  const activity = [row.lastInteractionAt, row.lastActivityAt, metadata.lastInteractionAt, metadata.lastActivityAt].filter(validTimestamp);
  if (activity.length) return Math.max(...activity);
  return [row.updatedAt, row.updatedAtMs, metadata.updatedAt, metadata.updatedAtMs].find(validTimestamp);
}

function validTimestamp(value: unknown): value is number { return typeof value === 'number' && Number.isFinite(value) && value >= 0; }
function record(value: unknown): Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
