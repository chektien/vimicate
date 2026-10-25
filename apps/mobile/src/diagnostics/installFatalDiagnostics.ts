import ExceptionsManager from 'react-native/Libraries/Core/ExceptionsManager';
import { installNativeFatalDiagnosticCapture, recordFatalDiagnostic, recordReactFatalDiagnostic, replayLatestFatalDiagnostic } from '../../modules/vimicate-diagnostics';
import { reactFatalDiagnostic } from './reactFatalDiagnostic';

type GlobalErrorHandler = (error: unknown, isFatal?: boolean) => void;
type ErrorUtilsLike = {
  getGlobalHandler?: () => GlobalErrorHandler;
  setGlobalHandler?: (handler: GlobalErrorHandler) => void;
};
type DiagnosticGlobal = typeof globalThis & {
  ErrorUtils?: ErrorUtilsLike;
  __vimicateFatalDiagnosticsInstalled?: boolean;
  __vimicateReactFatalDiagnosticsInstalled?: boolean;
};

function errorSummary(error: unknown) {
  if (error instanceof Error) return `${error.name}: ${error.message}\n${error.stack ?? 'stack unavailable'}`;
  return typeof error === 'string' ? error : 'unknown JavaScript fatal';
}

export function installFatalDiagnostics() {
  const diagnosticGlobal = globalThis as DiagnosticGlobal;
  if (diagnosticGlobal.__vimicateFatalDiagnosticsInstalled && diagnosticGlobal.__vimicateReactFatalDiagnosticsInstalled) return;
  // React can report a fatal directly through RCTFatal before ErrorUtils has
  // published (or while the JS runtime is already unwinding). Install the
  // synchronous native fatal-log observer first so the originating message
  // survives the process abort without replacing Expo's recovery handler.
  try { installNativeFatalDiagnosticCapture(); } catch { /* Diagnostics must never block application startup. */ }
  try { replayLatestFatalDiagnostic(); } catch { /* Diagnostics must never block application startup. */ }
  if (!diagnosticGlobal.__vimicateReactFatalDiagnosticsInstalled) {
    try {
      if (ExceptionsManager.unstable_setExceptionDecorator) {
        ExceptionsManager.unstable_setExceptionDecorator((data) => {
          try {
            const fatal = reactFatalDiagnostic(data);
            if (fatal) recordReactFatalDiagnostic(fatal.summary, fatal.frames);
          } catch { /* Preserve the original fatal even if capture fails. */ }
          return data;
        });
        diagnosticGlobal.__vimicateReactFatalDiagnosticsInstalled = true;
      }
    } catch { /* Version-coupled diagnostics must never block startup. */ }
  }
  if (diagnosticGlobal.__vimicateFatalDiagnosticsInstalled) return;
  const errorUtils = diagnosticGlobal.ErrorUtils;
  const previous = errorUtils?.getGlobalHandler?.();
  if (!errorUtils?.setGlobalHandler || !previous) return;
  diagnosticGlobal.__vimicateFatalDiagnosticsInstalled = true;
  errorUtils.setGlobalHandler((error, isFatal) => {
    // This slot is the last fatal, not the last error. A later recoverable
    // report must not erase the incident the user is trying to diagnose.
    if (isFatal !== false) {
      try { recordFatalDiagnostic(`fatal ${errorSummary(error)}`); } catch { /* Never mask the original fatal. */ }
    }
    previous(error, isFatal);
  });
}
