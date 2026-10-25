import { NativeModule, requireOptionalNativeModule } from 'expo';

declare class VimicateDiagnosticsModule extends NativeModule<{}> {
  installFatalCapture(): void;
  record(message: string): void;
  recordReactFatal?(summary: string, frames: string[]): void;
  replayLatestFatal(): void;
  latestFatalDiagnostic(): string | null;
}

const nativeModule = requireOptionalNativeModule<VimicateDiagnosticsModule>('VimicateDiagnostics');
const VIEWPORT_HISTORY_LIMIT = 60;
const viewportHistory: string[] = [];

function privacySafe(message: string, limit = 300) {
  return message
    .slice(0, 16_384)
    .replace(/(token|credential|signature)=\S+/gi, '$1=<redacted>')
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '<email>')
    .replace(/\/Users\/[^/\s]+\//g, '/Users/<redacted>/')
    .replace(/[A-Za-z0-9_-]{40,}/g, '<redacted>')
    .slice(0, limit);
}

export function installNativeFatalDiagnosticCapture() {
  nativeModule?.installFatalCapture();
}

export function recordGatewayDiagnostic(message: string) {
  nativeModule?.record(privacySafe(message));
}

export function recordViewportDiagnostic(message: string) {
  const bounded = privacySafe(`viewport.${message}`);
  const line = `${new Date().toISOString().slice(11, 23)} ${bounded}`;
  // Repeated native callbacks must not evict the preceding entry episode.
  if (viewportHistory[viewportHistory.length - 1]?.slice(13) !== bounded) {
    viewportHistory.push(line);
    if (viewportHistory.length > VIEWPORT_HISTORY_LIMIT) viewportHistory.shift();
  }
  nativeModule?.record(bounded);
  // XCTest's launched-product log archive retains RN console messages while
  // native NSLog viewport records may be absent. Keep the same bounded payload.
  console.info(`[vimicate.gateway] ${bounded}`);
}

export function recentViewportDiagnostics() {
  return [...viewportHistory];
}

export function recordFatalDiagnostic(message: string) {
  // The native owner retains only a short summary and parsed stack locations.
  // Older binaries still accept record(), with their older truncation limit.
  nativeModule?.record(privacySafe(`fatal.${message}`, 16_384));
}

export function recordReactFatalDiagnostic(summary: string, frames: string[]) {
  // Optional for OTA compatibility with binaries predating origin capture.
  nativeModule?.recordReactFatal?.(privacySafe(summary, 220), frames.slice(0, 16));
}

export function replayLatestFatalDiagnostic() {
  nativeModule?.replayLatestFatal();
}

export function latestFatalDiagnostic() {
  return nativeModule?.latestFatalDiagnostic?.() ?? null;
}
