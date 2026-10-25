import type { WorkspaceMessage } from '../workspace/workspaceTypes';
import { claudeNativeLiveDiagnosis } from '../gateway/claudeNativeLiveConvergence';

const ROW_LIMIT = 14;
const LIVE_LIMIT = 8;

/** Structural tail of one session's published rows, for duplicate and order reports. */
export function transcriptRowDiagnosticsText(messages: readonly WorkspaceMessage[], sessionKey: string) {
  const rows = messages.filter(message => message.sessionKey === sessionKey).slice(-ROW_LIMIT);
  if (!rows.length) return 'transcript rows (oldest to newest)\n(none)';
  const scoped = messages.filter(message => message.sessionKey === sessionKey);
  const liveRows = scoped.filter(message => message.source === 'live' && message.role === 'assistant');
  const live = liveRows.slice(-LIVE_LIMIT).map(row =>
    `L ${row.state ?? '-'} id=${row.id.slice(-14)} at=${clock(row.timestamp, 12)} pos=${scoped.indexOf(row)}/${scoped.length} len=${row.text.length}`
    + ` nn=${row.text.split('\n\n').length - 1} n=${row.text.split('\n').length - 1} ${claudeNativeLiveDiagnosis(scoped, row)}`);
  const omitted = liveRows.length - live.length;
  const liveSection = ['live assistant rows', ...(omitted ? [`(${omitted} earlier omitted)`] : []), ...(live.length ? live : ['(none)'])].join('\n');
  return ['transcript rows (oldest to newest)', ...rows.map(row => [
    row.source === 'live' ? 'L' : row.source === 'history' ? 'H' : (row.source ?? '?').slice(0, 1).toUpperCase(),
    row.role,
    row.state ?? '-',
    `id=${row.id.slice(-14)}`,
    row.runId ? `run=${row.runId.slice(-6)}` : null,
    row.cliProvenance?.kind === 'claude-native' ? 'native' : null,
    row.displayPosition ? 'pos' : null,
    row.transcriptSessionId ? `ts=${row.transcriptSessionId.slice(0, 4)}` : null,
    `at=${clock(row.timestamp)}`,
    `len=${row.text.length}`,
    JSON.stringify(row.text.replace(/\s+/g, ' ').slice(0, 24)),
  ].filter(Boolean).join(' '))].join('\n') + `\n${liveSection}`;
}

function clock(timestamp: WorkspaceMessage['timestamp'], digits: 8 | 12 = 8) {
  if (!timestamp) return '-';
  const numeric = Number(timestamp);
  const date = new Date(Number.isFinite(numeric) ? numeric : Date.parse(String(timestamp)));
  return Number.isFinite(date.getTime()) ? date.toISOString().slice(11, 11 + digits) + 'Z' : '-';
}
