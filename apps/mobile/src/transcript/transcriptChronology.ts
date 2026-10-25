import type { WorkspaceMessage } from '../workspace/workspaceTypes';

export type TranscriptChronology = {
  dividerLabel?: string;
  timeLabel?: string;
  focusedTimeLabel?: string;
};

export function transcriptChronology(messages: WorkspaceMessage[], now = new Date()): TranscriptChronology[] {
  let previousDay = '';
  return messages.map((message) => {
    const date = transcriptTimestamp(message.timestamp);
    if (!date) return {};
    const day = localDayKey(date);
    const dividerLabel = day !== previousDay ? transcriptDayLabel(date, now) : undefined;
    previousDay = day;
    return {
      ...(dividerLabel ? { dividerLabel } : {}),
      timeLabel: transcriptTimeLabel(date),
      focusedTimeLabel: `${monthDayLabel(date)}, ${transcriptTimeLabel(date)}`,
    };
  });
}

export function transcriptTimestamp(value: string | undefined) {
  if (!value) return null;
  const numeric = Number(value);
  const date = Number.isFinite(numeric)
    ? new Date(Math.abs(numeric) < 100_000_000_000 ? numeric * 1000 : numeric)
    : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function transcriptDayLabel(date: Date, now: Date) {
  const delta = dayOrdinal(now) - dayOrdinal(date);
  if (delta === 0) return 'Today';
  if (delta === 1) return 'Yesterday';
  const sameYear = date.getFullYear() === now.getFullYear();
  return `${date.toLocaleDateString(undefined, { ...(sameYear ? { weekday: 'short' as const } : {}), month: 'short', day: 'numeric' })}${sameYear ? '' : `, ${date.getFullYear()}`}`;
}

function transcriptTimeLabel(date: Date) { return `${two(date.getHours())}:${two(date.getMinutes())}`; }
function monthDayLabel(date: Date) { return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }); }
function localDayKey(date: Date) { return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`; }
function dayOrdinal(date: Date) { return Math.floor(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86_400_000); }
function two(value: number) { return String(value).padStart(2, '0'); }
