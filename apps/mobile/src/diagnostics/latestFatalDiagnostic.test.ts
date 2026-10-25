import { describe, expect, it } from 'vitest';
import { latestFatalDiagnosticText } from './latestFatalDiagnostic';

describe('retained fatal diagnostic command', () => {
  it('shows the exact privacy-bounded breadcrumb retained by the native owner', () => {
    expect(latestFatalDiagnosticText('at=123 build=0.1.1(7) fatal.native React error')).toBe(
      ':diagnostics — retained fatal breadcrumb\nat=123 build=0.1.1(7) fatal.native React error\nrecent viewport (oldest to newest)\n(none)',
    );
  });

  it('states truthfully when no native breadcrumb exists', () => {
    expect(latestFatalDiagnosticText(null)).toBe(':diagnostics — no retained fatal breadcrumb\nrecent viewport (oldest to newest)\n(none)');
    expect(latestFatalDiagnosticText('   ')).toBe(':diagnostics — no retained fatal breadcrumb\nrecent viewport (oldest to newest)\n(none)');
  });

  it('appends viewport history in recording order after the fatal section', () => {
    expect(latestFatalDiagnosticText('fatal.native', ['12:00:00.001 viewport.dataset ds=abcd', '12:00:00.002 viewport.visible v=none'])).toBe(
      ':diagnostics — retained fatal breadcrumb\nfatal.native\nrecent viewport (oldest to newest)\n12:00:00.001 viewport.dataset ds=abcd\n12:00:00.002 viewport.visible v=none',
    );
  });
});
