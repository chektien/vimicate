import type { WorkspaceMessage } from '../workspace/workspaceTypes';

/** Shared snapshots are session-wide; they are not a second pagination cursor. */
export function narrationInsideHistoryWindow(narration: WorkspaceMessage[], authority: WorkspaceMessage[]) {
  const floors = new Map<string, number>();
  const put = (key: string, time: number) => floors.set(key, Math.min(floors.get(key) ?? Infinity, time));
  for (const row of authority) {
    if (legacySharedNarration(row) || !(row.source === 'history' || row.source === 'local' && row.role === 'user')) continue;
    const time = milliseconds(row.timestamp); if (time === null) continue;
    const session = row.sessionKey ?? '';
    put(session + '\0all', time);
    put(session + '\0' + (row.transcriptSessionId ?? ''), time);
  }
  const retained = narration.filter(row => {
    const session = row.sessionKey ?? '';
    const floor = row.transcriptSessionId
      ? floors.get(session + '\0' + row.transcriptSessionId) ?? floors.get(session + '\0')
      : floors.get(session + '\0all');
    if (row.transcriptSessionId && floor === undefined && floors.has(session + '\0all')) return false;
    const time = milliseconds(row.timestamp);
    return floor === undefined || time === null || time >= floor;
  });
  return retained.length === narration.length ? narration : retained;
}

/** Repair prior cache pollution without deleting canonical or live message facts. */
export function sharedNarrationWindowCache(messages: WorkspaceMessage[], authority: WorkspaceMessage[]) {
  const shared = messages.filter(legacySharedNarration);
  const kept = new Set(narrationInsideHistoryWindow(shared, authority));
  if (kept.size === shared.length) return messages;
  return messages.filter(row => !legacySharedNarration(row) || kept.has(row));
}

function legacySharedNarration(row: WorkspaceMessage) {
  return row.role === 'narration' && row.source === 'history' && !row.displayPosition
    && Boolean(row.narrationItemId || row.id.startsWith('live-item-'));
}
function milliseconds(value: string | undefined) {
  if (!value) return null;
  const numeric = Number(value);
  const time = Number.isFinite(numeric) ? Math.abs(numeric) < 100_000_000_000 ? numeric * 1000 : numeric : Date.parse(value);
  return Number.isFinite(time) ? time : null;
}
