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

describe('retained fatal provenance', () => {
  const breadcrumb = 'at=1791513191294 build=0.1.1(202610051327) fatal.native Unhandled JS Exception';
  it('dates an old breadcrumb in SGT and flags that it predates the running build', () => {
    const text = latestFatalDiagnosticText(breadcrumb, [], { nowMs: 1791513191294 + 23 * 86_400_000, build: '0.1.1(202610261033)', updateId: '01a18d31' });
    expect(text.split('\n')[0]).toBe(':diagnostics — retained fatal breadcrumb from 2026-10-09 10:33:11 SGT (23 days ago), older build 0.1.1(202610051327), not running build');
    expect(text).toContain('last recorded JS fatal only; native crashes and OS terminations are not captured');
    expect(text).toContain('running build 0.1.1(202610261033), update 01a18d31');
    expect(text).toContain('recent viewport since this launch (UTC, oldest to newest)');
  });
  it('reports a recent same-build breadcrumb in minutes', () => {
    const text = latestFatalDiagnosticText(breadcrumb, [], { nowMs: 1791513191294 + 5 * 60_000, build: '0.1.1(202610051327)' });
    expect(text.split('\n')[0]).toBe(':diagnostics — retained fatal breadcrumb from 2026-10-09 10:33:11 SGT (5 min ago), same build as running');
    expect(text).toContain('update unknown');
  });
  it('keeps the no-breadcrumb case truthful about its scope', () => {
    const text = latestFatalDiagnosticText(null, [], { nowMs: 0 });
    expect(text.split('\n').slice(0, 2)).toEqual([':diagnostics — no retained fatal breadcrumb', 'last recorded JS fatal only; native crashes and OS terminations are not captured']);
  });
});
