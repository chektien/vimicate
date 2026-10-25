// swift-tools-version: 5.9
import PackageDescription

// Tests compile the same Foundation formatter used by the iOS fatal observer.
let package = Package(
    name: "VimicateFatalDiagnostics",
    platforms: [.macOS(.v13)],
    products: [.library(name: "VimicateFatalDiagnostics", targets: ["VimicateFatalDiagnostics"])],
    targets: [
        .target(name: "VimicateFatalDiagnostics", path: "ios",
                exclude: ["VimicateDiagnosticsModule.swift", "VimicateDiagnostics.podspec"],
                sources: ["VimicateFatalDiagnostic.swift"]),
        .testTarget(name: "VimicateFatalDiagnosticsTests", dependencies: ["VimicateFatalDiagnostics"], path: "tests")
    ]
)
