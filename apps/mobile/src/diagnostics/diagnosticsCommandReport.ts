import { latestFatalDiagnostic, recentViewportDiagnostics } from '../../modules/vimicate-diagnostics';
import type { WorkspaceMessage } from '../workspace/workspaceTypes';
import { latestFatalDiagnosticText } from './latestFatalDiagnostic';
import { transcriptRowDiagnosticsText } from './transcriptRowDiagnostics';
import { runtimeEventLines, runtimeEventText } from './runtimeEventLedger';

/** `:diagnostics` output. Running identity loads on demand to keep native Expo modules out of import graphs. */
export async function diagnosticsCommandReport(messages: readonly WorkspaceMessage[], sessionKey: string) {
  const fatal = latestFatalDiagnostic(); const viewport = recentViewportDiagnostics();
  const running = (await import('./runningDiagnosticIdentity')).runningDiagnosticIdentity();
  const events = runtimeEventText(await runtimeEventLines());
  return `${latestFatalDiagnosticText(fatal, viewport, running)}\n${events}\n${transcriptRowDiagnosticsText(messages, sessionKey)}`;
}
