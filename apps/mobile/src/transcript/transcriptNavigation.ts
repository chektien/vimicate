export function boundedTranscriptIndex(requestedIndex: number, messageCount: number): number | null {
  if (messageCount <= 0) return null;
  return Math.max(0, Math.min(requestedIndex, messageCount - 1));
}
