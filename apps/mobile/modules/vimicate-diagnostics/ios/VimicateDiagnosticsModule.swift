import ExpoModulesCore
import Foundation
import React

public final class VimicateDiagnosticsModule: Module {
    private static let latestFatalKey = "org.vimicate.rn.latest-fatal-diagnostic"
    private static let fatalCaptureLock = NSLock()
    private static let preFatalContextLock = NSLock()
    private static var fatalCaptureInstalled = false
    private static var preFatalContext: [String] = []
    private static var pendingOrigin: VimicateFatalOrigin?

    private static func rememberPreFatalContext(_ message: String) {
        let bounded = VimicateFatalDiagnostic.bounded(message, limit: 300)
        guard !bounded.isEmpty else { return }
        let epochMilliseconds = Int64(Date().timeIntervalSince1970 * 1_000)
        preFatalContextLock.lock()
        preFatalContext.append("at=\(epochMilliseconds) \(bounded)")
        if preFatalContext.count > 8 {
            preFatalContext.removeFirst(preFatalContext.count - 8)
        }
        preFatalContextLock.unlock()
    }

    private static func fatalContext(_ message: String, at timestamp: Int64) -> (breadcrumbs: [String], origin: [String]) {
        preFatalContextLock.lock()
        defer { preFatalContextLock.unlock() }
        let origin = pendingOrigin?.matchingFrames(message, at: timestamp) ?? []
        pendingOrigin = nil
        return (preFatalContext, origin)
    }

    private static func persistFatal(_ message: String) {
        let info = Bundle.main.infoDictionary
        let version = info?["CFBundleShortVersionString"] as? String ?? "unknown"
        let build = info?["CFBundleVersion"] as? String ?? "unknown"
        let epochMilliseconds = Int64(Date().timeIntervalSince1970 * 1_000)
        let context = fatalContext(message, at: epochMilliseconds)
        let recovered = VimicateFatalDiagnostic.retained(
            message,
            at: epochMilliseconds,
            version: version,
            build: build,
            preFatalContext: context.breadcrumbs,
            originatingStack: context.origin
        )
        UserDefaults.standard.set(recovered, forKey: latestFatalKey)
        UserDefaults.standard.synchronize()
        NSLog("[vimicate.gateway] %@", String(recovered.prefix(380)))
    }

    private static func installFatalCapture() {
        fatalCaptureLock.lock()
        defer { fatalCaptureLock.unlock() }
        guard !fatalCaptureInstalled else { return }
        fatalCaptureInstalled = true

        // Expo restores its saved fatal handler after the startup window. Observe
        // React's synchronous pre-handler fatal log instead of replacing that
        // handler: persistence survives the restore without changing recovery or
        // exception propagation. RCTAddLogFunction preserves the existing logger.
        RCTAddLogFunction { level, _, _, _, message in
            if level == .warning,
               message?.contains("Exceeded max renders without commit.") == true {
                rememberPreFatalContext("flashlist-render-cap reached")
                return
            }
            guard level == .fatal else { return }
            persistFatal(message ?? "unknown React Native fatal")
        }
    }

    public func definition() -> ModuleDefinition {
        Name("VimicateDiagnostics")

        Function("installFatalCapture") {
            Self.installFatalCapture()
        }

        Function("record") { (message: String) in
            if message.hasPrefix("fatal.") {
                Self.persistFatal(message)
                return
            }
            let bounded = VimicateFatalDiagnostic.bounded(message, limit: 300)
            if message.hasPrefix("viewport.") {
                Self.rememberPreFatalContext(bounded)
            }
            NSLog("[vimicate.gateway] %@", bounded)
        }

        Function("recordReactFatal") { (summary: String, frames: [String]) in
            let origin = VimicateFatalOrigin(summary: summary, frames: frames,
                at: Int64(Date().timeIntervalSince1970 * 1_000))
            Self.preFatalContextLock.lock()
            Self.pendingOrigin = origin
            Self.preFatalContextLock.unlock()
        }

        Function("replayLatestFatal") {
            guard let recovered = UserDefaults.standard.string(forKey: Self.latestFatalKey) else {
                return
            }
            NSLog("[vimicate.gateway] recovered.%@", String(recovered.prefix(380)))
        }

        Function("latestFatalDiagnostic") {
            UserDefaults.standard.string(forKey: Self.latestFatalKey)
        }
    }
}
