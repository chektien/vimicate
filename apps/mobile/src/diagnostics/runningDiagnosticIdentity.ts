import * as Application from 'expo-application';
import * as Updates from 'expo-updates';
import type { RunningDiagnosticIdentity } from './latestFatalDiagnostic';

/** Matches the native breadcrumb's `build=<version>(<build>)` form. */
export function runningDiagnosticIdentity(nowMs = Date.now()): RunningDiagnosticIdentity {
  const version = Application.nativeApplicationVersion?.trim(); const build = Application.nativeBuildVersion?.trim();
  return { nowMs, ...(version && build ? { build: `${version}(${build})` } : {}), ...(Updates.updateId ? { updateId: Updates.updateId.slice(0, 8) } : {}) };
}
