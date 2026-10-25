// @ts-expect-error Vitest's Node runtime provides this test-only module.
import { readFileSync } from 'node:fs';
// @ts-expect-error Vitest's Node runtime provides this test-only module.
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const nativeSource = readFileSync(
  resolve(root, 'modules/vimicate-diagnostics/ios/VimicateDiagnosticsModule.swift'),
  'utf8',
);

describe('native retained fatal diagnostic contract', () => {
  it('observes the fatal log without replacing Expo-owned fatal handlers', () => {
    const capture = nativeSource.slice(
      nativeSource.indexOf('private static func installFatalCapture()'),
      nativeSource.indexOf('public func definition()'),
    );
    expect(capture).toContain('RCTAddLogFunction');
    expect(capture).toContain('message?.contains("Exceeded max renders without commit.") == true');
    expect(capture).toContain('rememberPreFatalContext("flashlist-render-cap reached")');
    expect(capture).toContain('guard level == .fatal else { return }');
    expect(capture).toContain('persistFatal(');
    expect(capture).not.toContain('RCTSetFatalHandler');
    expect(capture).not.toContain('RCTGetFatalHandler');
    expect(capture).not.toContain('NSException(');
  });

  it('keeps one process-owned observer and preserves the existing bounded durable writer', () => {
    expect(nativeSource).toContain('guard !fatalCaptureInstalled else { return }');
    expect(nativeSource).toContain('fatalCaptureInstalled = true');
    expect(nativeSource).toContain('UserDefaults.standard.set(recovered, forKey: latestFatalKey)');
    expect(nativeSource).toContain('UserDefaults.standard.synchronize()');
    expect(nativeSource).toContain('let recovered = VimicateFatalDiagnostic.retained(');
    expect(nativeSource).toContain('preFatalContext: context.breadcrumbs');
    expect(nativeSource).toContain('originatingStack: context.origin');
    expect(nativeSource).toContain('pendingOrigin?.matchingFrames(message, at: timestamp)');
    expect(nativeSource).toContain('pendingOrigin = nil');
    expect(nativeSource).toContain('String(recovered.prefix(380))');
    const record = nativeSource.slice(nativeSource.indexOf('Function("record")'), nativeSource.indexOf('Function("replayLatestFatal")'));
    expect(record).toContain('Self.persistFatal(message)');
    expect(record).toContain('if message.hasPrefix("viewport.")');
    expect(record).toContain('Self.rememberPreFatalContext(bounded)');
    expect(record.indexOf('Self.persistFatal(message)')).toBeLessThan(record.indexOf('limit: 300'));
  });

  it('verifies the installed RN fatal boundary logs before consulting the replaceable handler', () => {
    const reactSource = readFileSync(resolve(root, 'node_modules/react-native/React/Base/RCTAssert.m'), 'utf8');
    const fatal = reactSource.slice(reactSource.indexOf('void RCTFatal(NSError *error)'), reactSource.indexOf('void RCTSetFatalHandler('));
    const log = fatal.indexOf('_RCTLogNativeInternal(RCTLogLevelFatal');
    const handler = fatal.indexOf('RCTGetFatalHandler()');
    expect(log).toBeGreaterThan(-1);
    expect(handler).toBeGreaterThan(log);
  });

  it('exposes the persisted breadcrumb without consuming or clearing it', () => {
    const getter = nativeSource.slice(nativeSource.indexOf('Function("latestFatalDiagnostic")'));
    expect(getter).toContain('UserDefaults.standard.string(forKey: Self.latestFatalKey)');
    expect(getter).not.toContain('removeObject');
    expect(getter).not.toContain('set(nil');
  });
});
