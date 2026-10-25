export function latestFatalDiagnosticText(diagnostic: string | null | undefined, viewport: readonly string[] = []) {
  const retained = diagnostic?.trim();
  const fatal = retained
    ? `:diagnostics — retained fatal breadcrumb\n${retained}`
    : ':diagnostics — no retained fatal breadcrumb';
  return `${fatal}\nrecent viewport (oldest to newest)\n${viewport.length ? viewport.join('\n') : '(none)'}`;
}
