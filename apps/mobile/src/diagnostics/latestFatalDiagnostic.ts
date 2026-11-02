export type RunningDiagnosticIdentity = { nowMs: number; build?: string; updateId?: string };

/**
 * The native owner keeps only the last recorded JS fatal, possibly from an old
 * build weeks earlier. Native crashes and OS terminations never appear here.
 * Date it and compare builds so a stale breadcrumb cannot pass as today's crash.
 */
export function latestFatalDiagnosticText(diagnostic: string | null | undefined, viewport: readonly string[] = [], running?: RunningDiagnosticIdentity) {
  const retained = diagnostic?.trim();
  const fatal = retained
    ? `:diagnostics — retained fatal breadcrumb${running ? ` ${breadcrumbProvenance(retained, running)}` : ''}\n${retained}`
    : ':diagnostics — no retained fatal breadcrumb';
  const scope = running ? `\nlast recorded JS fatal only; native crashes and OS terminations are not captured\nrunning build ${running.build || 'unknown'}, update ${running.updateId || 'unknown'}` : '';
  const heading = running ? 'recent viewport since this launch (UTC, oldest to newest)' : 'recent viewport (oldest to newest)';
  return `${fatal}${scope}\n${heading}\n${viewport.length ? viewport.join('\n') : '(none)'}`;
}

function breadcrumbProvenance(breadcrumb: string, running: RunningDiagnosticIdentity) {
  const at = Number(/(?:^|\s)at=(\d{10,})/.exec(breadcrumb)?.[1]);
  const build = /(?:^|\s)build=(\S+)/.exec(breadcrumb)?.[1];
  const parts = [Number.isFinite(at) ? `from ${sgtTimestamp(at)} (${age(running.nowMs - at)})` : 'with unknown time'];
  if (build && running.build) parts.push(build === running.build ? 'same build as running' : `older build ${build}, not running build`);
  return parts.join(', ');
}

export function sgtTimestamp(ms: number) {
  return `${new Date(ms + 8 * 3_600_000).toISOString().slice(0, 19).replace('T', ' ')} SGT`;
}

function age(ms: number) {
  if (ms < 0) return 'time ahead of this device clock';
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  return hours < 48 ? `${hours} h ago` : `${Math.floor(hours / 24)} days ago`;
}
