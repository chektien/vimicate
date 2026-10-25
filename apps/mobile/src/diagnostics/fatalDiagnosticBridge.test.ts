import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { record } = vi.hoisted(() => ({ record: vi.fn() }));
vi.mock('expo', () => ({ requireOptionalNativeModule: () => ({ record }) }));
import { recordFatalDiagnostic, recordReactFatalDiagnostic, recordGatewayDiagnostic, recordViewportDiagnostic, recentViewportDiagnostics } from '../../modules/vimicate-diagnostics';

describe('bounded fatal diagnostics native bridge', () => {
  beforeEach(() => { record.mockReset(); vi.spyOn(console, 'info').mockImplementation(() => {}); });
  afterEach(() => vi.restoreAllMocks());

  it('leaves older binaries without origin capture unchanged', () => {
    expect(() => recordReactFatalDiagnostic('Error: depth exceeded', ['at setter (main.jsbundle:1:100)'])).not.toThrow();
    expect(record).not.toHaveBeenCalled();
  });

  it('does not discard stack locations beyond the ordinary 300-character log budget', () => {
    recordFatalDiagnostic(`Error: ${'repeated update '.repeat(30)}\n    at render (address at index.bundle:1:342198)`);
    expect(record).toHaveBeenCalledWith(expect.stringContaining('index.bundle:1:342198'));
    expect(record.mock.calls[0]![0]).toMatch(/^fatal\./);
  });

  it('still bounds and redacts fatal input before crossing the native bridge', () => {
    recordFatalDiagnostic(`token=secret developer@example.com /Users/Person/ ${'x'.repeat(20_000)}`);
    const value = record.mock.calls[0]![0] as string;
    expect(value.length).toBeLessThanOrEqual(16_384);
    for (const secret of ['secret', 'developer@example.com', '/Users/Person/', 'x'.repeat(40)]) expect(value).not.toContain(secret);
  });

  it('mirrors only the bounded privacy-filtered viewport payload through the retained RN log route', () => {
    recordViewportDiagnostic(`key-input token=private developer@example.com /Users/Person/ ${'offset '.repeat(100)}`);
    const value = record.mock.calls[0]![0] as string;
    expect(console.info).toHaveBeenCalledExactlyOnceWith(`[vimicate.gateway] ${value}`);
    expect(value.length).toBeLessThanOrEqual(300);
    for (const secret of ['private', 'developer@example.com', '/Users/Person/']) expect(value).not.toContain(secret);
  });

  it('does not enlarge ordinary gateway or viewport log records', () => {
    recordGatewayDiagnostic('gateway '.repeat(100));
    recordViewportDiagnostic('offset '.repeat(100));
    expect(record.mock.calls.every(([value]) => value.length <= 300)).toBe(true);
  });

  it('keeps transcript key-result lines in the same viewport history', () => {
    recordViewportDiagnostic('key-result key=G before=4 after=90 handled=1');
    expect(recentViewportDiagnostics().at(-1)).toMatch(/ viewport\.key-result key=G before=4 after=90 handled=1$/);
  });

  it('retains the last 60 privacy-safe viewport lines in order with UTC times and suppresses consecutive duplicates', () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-09-24T12:34:56.789Z'));
      recordViewportDiagnostic('ring-start token=secret');
      recordViewportDiagnostic('ring-start token=secret');
      for (let index = 0; index < 61; index += 1) recordViewportDiagnostic(`ring-${index}`);
      const lines = recentViewportDiagnostics();
      expect(lines).toHaveLength(60);
      expect(lines[0]).toBe('12:34:56.789 viewport.ring-1');
      expect(lines.at(-1)).toBe('12:34:56.789 viewport.ring-60');
      expect(lines.some((line) => line.includes('secret'))).toBe(false);
      lines.pop();
      expect(recentViewportDiagnostics()).toHaveLength(60);
    } finally { vi.useRealTimers(); }
  });
});
