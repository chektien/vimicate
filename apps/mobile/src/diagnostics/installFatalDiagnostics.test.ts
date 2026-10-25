import { beforeEach, describe, expect, it, vi } from 'vitest';

const { installNativeFatalDiagnosticCapture, recordFatalDiagnostic, recordReactFatalDiagnostic, replayLatestFatalDiagnostic, setExceptionDecorator } = vi.hoisted(() => ({
  installNativeFatalDiagnosticCapture: vi.fn(),
  recordFatalDiagnostic: vi.fn(),
  recordReactFatalDiagnostic: vi.fn(),
  setExceptionDecorator: vi.fn(),
  replayLatestFatalDiagnostic: vi.fn(),
}));

vi.mock('../../modules/vimicate-diagnostics', () => ({
  installNativeFatalDiagnosticCapture,
  recordFatalDiagnostic,
  recordReactFatalDiagnostic,
  replayLatestFatalDiagnostic,
}));
vi.mock('react-native/Libraries/Core/ExceptionsManager', () => ({ default: { unstable_setExceptionDecorator: setExceptionDecorator } }));

import { installFatalDiagnostics } from './installFatalDiagnostics';

type Handler = (error: unknown, isFatal?: boolean) => void;
type DiagnosticGlobal = typeof globalThis & {
  ErrorUtils?: { getGlobalHandler: () => Handler; setGlobalHandler: (handler: Handler) => void };
  __vimicateFatalDiagnosticsInstalled?: boolean;
  __vimicateReactFatalDiagnosticsInstalled?: boolean;
};

describe('fatal diagnostics installation', () => {
  beforeEach(() => {
    installNativeFatalDiagnosticCapture.mockReset();
    recordFatalDiagnostic.mockReset();
    recordReactFatalDiagnostic.mockReset();
    setExceptionDecorator.mockReset();
    replayLatestFatalDiagnostic.mockReset();
    const diagnosticGlobal = globalThis as DiagnosticGlobal;
    delete diagnosticGlobal.__vimicateFatalDiagnosticsInstalled;
    delete diagnosticGlobal.__vimicateReactFatalDiagnosticsInstalled;
    delete diagnosticGlobal.ErrorUtils;
  });

  it('captures direct React fatal frames without relying on ErrorUtils or altering the exception', () => {
    installFatalDiagnostics();
    installFatalDiagnostics();
    expect(setExceptionDecorator).toHaveBeenCalledOnce();
    const decorate = setExceptionDecorator.mock.calls[0]![0];
    const fatal = { isFatal: true, message: 'Error: depth exceeded', stack: [
      { methodName: 'dispatchSetState', file: '/private/container/main.jsbundle', lineNumber: 1, column: 369587 },
      { methodName: 'anonymous', file: '/private/container/main.jsbundle', lineNumber: 1, column: 1028391 },
    ] };
    expect(decorate(fatal)).toBe(fatal);
    expect(recordReactFatalDiagnostic).toHaveBeenCalledWith('Error: depth exceeded', [
      'at dispatchSetState (main.jsbundle:1:369587)', 'at anonymous (main.jsbundle:1:1028391)',
    ]);
    recordReactFatalDiagnostic.mockImplementation(() => { throw new Error('unavailable'); });
    expect(decorate(fatal)).toBe(fatal);
    const soft = { ...fatal, isFatal: false };
    expect(decorate(soft)).toBe(soft);
    expect(recordReactFatalDiagnostic).toHaveBeenCalledTimes(2);
  });

  it('installs native capture before replaying a retained breadcrumb even when ErrorUtils is absent', () => {
    const order: string[] = [];
    installNativeFatalDiagnosticCapture.mockImplementation(() => order.push('native'));
    replayLatestFatalDiagnostic.mockImplementation(() => order.push('replay'));

    installFatalDiagnostics();

    expect(installNativeFatalDiagnosticCapture).toHaveBeenCalledOnce();
    expect(replayLatestFatalDiagnostic).toHaveBeenCalledOnce();
    expect(recordFatalDiagnostic).not.toHaveBeenCalled();
    expect(order).toEqual(['native', 'replay']);
  });

  it('never blocks replay when native fatal capture installation throws', () => {
    installNativeFatalDiagnosticCapture.mockImplementation(() => { throw new Error('native unavailable'); });

    installFatalDiagnostics();

    expect(replayLatestFatalDiagnostic).toHaveBeenCalledOnce();
  });

  it('records the fatal before delegating to React Native original handling', () => {
    const order: string[] = [];
    let installed: Handler | undefined;
    const previous = vi.fn(() => order.push('previous'));
    recordFatalDiagnostic.mockImplementation(() => order.push('record'));
    (globalThis as DiagnosticGlobal).ErrorUtils = {
      getGlobalHandler: () => previous,
      setGlobalHandler: (handler) => { installed = handler; },
    };

    installFatalDiagnostics();
    installed?.(new Error('viewport writer failed'), true);

    expect(replayLatestFatalDiagnostic).toHaveBeenCalledOnce();
    expect(recordFatalDiagnostic).toHaveBeenCalledWith(
      expect.stringContaining('fatal Error: viewport writer failed'),
    );
    expect(order).toEqual(['record', 'previous']);
  });

  it('never masks the original fatal when persistence itself throws', () => {
    let installed: Handler | undefined;
    const previous = vi.fn();
    recordFatalDiagnostic.mockImplementation(() => { throw new Error('diagnostics unavailable'); });
    (globalThis as DiagnosticGlobal).ErrorUtils = {
      getGlobalHandler: () => previous,
      setGlobalHandler: (handler) => { installed = handler; },
    };

    installFatalDiagnostics();
    const fatal = new Error('original');
    installed?.(fatal, true);

    expect(previous).toHaveBeenCalledWith(fatal, true);
  });

  it('does not replace a retained fatal with an explicitly nonfatal error', () => {
    let installed: Handler | undefined;
    const previous = vi.fn();
    (globalThis as DiagnosticGlobal).ErrorUtils = {
      getGlobalHandler: () => previous,
      setGlobalHandler: (handler) => { installed = handler; },
    };
    installFatalDiagnostics();
    const fatal = new Error('original fatal');
    const soft = new Error('later recoverable error');
    installed?.(fatal, true);
    installed?.(soft, false);

    expect(recordFatalDiagnostic).toHaveBeenCalledTimes(1);
    expect(recordFatalDiagnostic).toHaveBeenCalledWith(expect.stringContaining('original fatal'));
    expect(previous.mock.calls).toEqual([[fatal, true], [soft, false]]);
  });
});
